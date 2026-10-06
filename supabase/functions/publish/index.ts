/*
 * Publicação de arquivos no repositório, em nome do grupo.
 *
 * Existe para que ninguém precise criar um token do GitHub. O token fica como
 * segredo desta função, no servidor, e **nunca** chega ao navegador: o site
 * manda o arquivo para cá, esta função confere quem está pedindo e só então
 * fala com o GitHub.
 *
 * Por que não colocar o token no site: o `config.js` é servido ao público. Um
 * token ali é lido por qualquer pessoa que abra o código-fonte, e o secret
 * scanning do GitHub o revoga em minutos — não é uma questão de disciplina,
 * simplesmente não funciona.
 *
 * O que esta função não resolve sozinha: com um token compartilhado, todo
 * commit sai com a identidade do dono do token. Por isso o e-mail de quem
 * publicou vai no corpo da mensagem de commit — é o que preserva a trilha de
 * autoria.
 *
 * Implantação e segredos: docs/PUBLICACAO.md
 */

const GITHUB_API = 'https://api.github.com';

/** Só estes caminhos podem ser escritos. Qualquer outro é recusado. */
const ALLOWED_PATH = /^(models\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.(stl|3mf|png)|data\/catalog\.json)$/;

/** Teto por arquivo. O corpo chega em base64, então +33% sobre isto. */
const MAX_BYTES = 45 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/**
 * Identifica quem está chamando.
 *
 * Repassa o token da sessão ao próprio Supabase em vez de validar a assinatura
 * aqui: quem emitiu o token é a autoridade sobre ele, e isso dispensa guardar
 * segredo de JWT nesta função.
 */
async function identifyCaller(authorization: string | null, supabaseUrl: string, anonKey: string) {
  if (!authorization) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? { id: user.id as string, email: (user.email ?? '') as string } : null;
}

/** Tamanho real de um conteúdo base64, sem decodificar. */
function base64Bytes(content: string) {
  const clean = content.replace(/\s/g, '');
  const padding = (clean.match(/=+$/) ?? [''])[0].length;
  return Math.floor((clean.length * 3) / 4) - padding;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const githubToken = Deno.env.get('GITHUB_TOKEN') ?? '';
  const owner = Deno.env.get('GITHUB_OWNER') ?? '';
  const repo = Deno.env.get('GITHUB_REPO') ?? '';
  const branch = Deno.env.get('GITHUB_BRANCH') ?? 'main';

  if (!githubToken || !owner || !repo) {
    return json({
      error: 'Função sem configuração: defina os segredos GITHUB_TOKEN, GITHUB_OWNER e GITHUB_REPO. '
        + 'Veja docs/PUBLICACAO.md.',
    }, 500);
  }

  const caller = await identifyCaller(request.headers.get('Authorization'), supabaseUrl, anonKey);
  if (!caller) return json({ error: 'Entre na sua conta para publicar.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Corpo inválido: esperado JSON.' }, 400);
  }

  const action = String(body.action ?? 'put');
  const path = String(body.path ?? '');
  const message = String(body.message ?? '').slice(0, 300) || 'chore: atualiza biblioteca';
  const sha = body.sha ? String(body.sha) : undefined;

  // Caminho é a fronteira de segurança desta função: um token compartilhado com
  // permissão de escrita no repositório não pode virar permissão de escrever
  // em qualquer arquivo dele, incluindo o código do próprio site.
  if (path.includes('..') || path.startsWith('/') || path.includes('\\') || !ALLOWED_PATH.test(path)) {
    return json({
      error: `Caminho não permitido: "${path}". Esta função só grava em models/<id>/<arquivo> `
        + '(.stl, .3mf, .png) e em data/catalog.json.',
    }, 403);
  }

  // A autoria real vai na mensagem: o commit em si sai com a identidade do
  // token, e sem isto a trilha de quem publicou o quê se perderia.
  const assinatura = `\n\nPublicado por ${caller.email || caller.id} pela 3D Library.`;

  const target = `${GITHUB_API}/repos/${owner}/${repo}/contents/${
    path.split('/').map(encodeURIComponent).join('/')
  }`;
  const headers = {
    Authorization: `Bearer ${githubToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': '3d-library-publish',
  };

  if (action === 'delete') {
    if (!sha) return json({ error: 'Remoção exige o sha do arquivo.' }, 400);
    const response = await fetch(target, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ message: message + assinatura, sha, branch }),
    });
    const payload = await response.json().catch(() => null);
    return json(response.ok ? payload : { error: payload?.message ?? 'Falha ao remover.' }, response.status);
  }

  if (action !== 'put') return json({ error: `Ação desconhecida: "${action}".` }, 400);

  const content = String(body.content ?? '');
  if (!content) return json({ error: 'Conteúdo vazio.' }, 400);
  if (!/^[A-Za-z0-9+/=\s]+$/.test(content)) return json({ error: 'Conteúdo deve ser base64.' }, 400);

  const bytes = base64Bytes(content);
  if (bytes > MAX_BYTES) {
    return json({ error: `Arquivo de ${(bytes / 1048576).toFixed(1)} MB excede o limite de ${MAX_BYTES / 1048576} MB.` }, 413);
  }

  const response = await fetch(target, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: message + assinatura,
      content: content.replace(/\s/g, ''),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return json({
      error: payload?.message ?? 'Falha ao gravar no GitHub.',
      status: response.status,
    }, response.status);
  }

  return json({
    ok: true,
    path,
    commit: payload?.commit?.sha ?? '',
    content: { sha: payload?.content?.sha ?? '' },
  });
});
