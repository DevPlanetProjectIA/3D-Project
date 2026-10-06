/*
 * Cliente mínimo da API de conteúdo do GitHub.
 *
 * Leitura: feita por fetch relativo ao próprio site publicado (sem token e sem
 * consumir cota). Escrita: exige um token pessoal com permissão de conteúdo no
 * repositório — é o que cria os commits de upload.
 */

import CONFIG from '../../config.js';
import { getToken } from './auth.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, { status = 0, detail = '' } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.detail = detail;
  }
}

const repoSlug = () => `${CONFIG.owner}/${CONFIG.repo}`;

/* ---------- Base64 ---------- */

/** Codifica bytes em base64 sem estourar a pilha em arquivos grandes. */
export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const clean = String(b64).replace(/\s/g, '');
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

/* ---------- Requisições ---------- */

async function request(path, { method = 'GET', body, token = getToken(), raw = false } = {}) {
  const headers = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new GitHubError('Falha de rede ao contatar o GitHub. Verifique sua conexão.', { detail: String(cause) });
  }

  if (response.status === 204) return null;

  const payload = raw && response.ok
    ? await response.text()
    : await response.json().catch(() => null);

  if (response.ok) return payload;

  const apiMessage = payload?.message || response.statusText;
  const remaining = response.headers.get('x-ratelimit-remaining');

  if (response.status === 401) {
    throw new GitHubError('Token do GitHub inválido ou expirado.', { status: 401, detail: apiMessage });
  }
  if (response.status === 403 && remaining === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
    const when = reset ? new Date(reset).toLocaleTimeString('pt-BR') : 'em breve';
    throw new GitHubError(`Limite de requisições do GitHub atingido. Tente novamente após ${when}.`, { status: 403, detail: apiMessage });
  }
  if (response.status === 403) {
    throw new GitHubError('O token não tem permissão de escrita neste repositório.', { status: 403, detail: apiMessage });
  }
  if (response.status === 404) {
    throw new GitHubError('Recurso não encontrado no repositório.', { status: 404, detail: apiMessage });
  }
  if (response.status === 409) {
    throw new GitHubError('Conflito: o arquivo mudou no repositório desde a última leitura.', { status: 409, detail: apiMessage });
  }
  if (response.status === 422) {
    throw new GitHubError('O GitHub rejeitou o conteúdo enviado (arquivo muito grande ou caminho inválido).', { status: 422, detail: apiMessage });
  }
  throw new GitHubError(`Erro ${response.status} na API do GitHub.`, { status: response.status, detail: apiMessage });
}

/* ---------- Identidade e permissões ---------- */

/** Valida o token e confere se ele pode gravar no repositório configurado. */
export async function verifyToken(token) {
  const user = await request('/user', { token });
  let canWrite = false;
  let repo = null;
  try {
    repo = await request(`/repos/${repoSlug()}`, { token });
    canWrite = !!(repo?.permissions?.push || repo?.permissions?.maintain || repo?.permissions?.admin);
  } catch (err) {
    if (!(err instanceof GitHubError) || err.status !== 404) throw err;
  }
  return {
    login: user.login,
    name: user.name || user.login,
    avatarUrl: user.avatar_url,
    canWrite,
    repoFound: !!repo,
    defaultBranch: repo?.default_branch || CONFIG.branch,
  };
}

/* ---------- Arquivos ---------- */

/** Metadados de um arquivo (inclui o `sha` exigido para sobrescrever). */
export async function getFileMeta(path) {
  try {
    const data = await request(`/repos/${repoSlug()}/contents/${encodePath(path)}?ref=${encodeURIComponent(CONFIG.branch)}`);
    return Array.isArray(data) ? null : { sha: data.sha, size: data.size, content: data.content, encoding: data.encoding };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null;
    throw err;
  }
}

/** Cria ou atualiza um arquivo. `content` aceita string (UTF-8) ou bytes. */
export async function putFile({ path, content, message, sha }) {
  const base64 = typeof content === 'string' ? textToBase64(content) : bytesToBase64(content);
  return request(`/repos/${repoSlug()}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: {
      message,
      content: base64,
      branch: CONFIG.branch,
      ...(sha ? { sha } : {}),
    },
  });
}

export async function deleteFile({ path, sha, message }) {
  return request(`/repos/${repoSlug()}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    body: { message, sha, branch: CONFIG.branch },
  });
}

/** Lista o conteúdo de um diretório; devolve `[]` quando ele não existe. */
export async function listDir(path) {
  try {
    const data = await request(`/repos/${repoSlug()}/contents/${encodePath(path)}?ref=${encodeURIComponent(CONFIG.branch)}`);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return [];
    throw err;
  }
}

/** Grava um JSON com resolução automática de conflito (releitura + retry). */
export async function putJsonWithRetry({ path, build, message, attempts = 4 }) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const meta = await getFileMeta(path);
    const current = meta?.content
      ? JSON.parse(new TextDecoder().decode(base64ToBytes(meta.content)))
      : null;
    const next = await build(current);
    try {
      return await putFile({
        path,
        content: `${JSON.stringify(next, null, 2)}\n`,
        message,
        sha: meta?.sha,
      });
    } catch (err) {
      const conflict = err instanceof GitHubError && (err.status === 409 || err.status === 422);
      if (!conflict || attempt === attempts - 1) throw err;
      lastError = err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

function encodePath(path) {
  return String(path).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/* ---------- Links úteis ---------- */

export const links = {
  repo: () => `https://github.com/${repoSlug()}`,
  tree: (path) => `https://github.com/${repoSlug()}/blob/${CONFIG.branch}/${path}`,
  raw: (path) => `https://raw.githubusercontent.com/${repoSlug()}/${CONFIG.branch}/${path}`,
  newToken: () => 'https://github.com/settings/personal-access-tokens/new',
  commits: () => `https://github.com/${repoSlug()}/commits/${CONFIG.branch}`,
};
