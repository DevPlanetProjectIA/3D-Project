/*
 * Acervo no Supabase Storage.
 *
 * Alternativa ao Git para os arquivos de modelo, e a razão de existir é
 * prática: publicar deixa de exigir token do GitHub, Edge Function ou CLI —
 * basta estar logado. O upload vai direto do navegador para o bucket, com a
 * sessão de quem está publicando.
 *
 * A troca não é só de conveniência. O Git guarda toda versão para sempre, o que
 * é virtude para código e defeito para binário: um modelo de 20 MB reenviado
 * cinco vezes ocupa 100 MB de histórico permanente. O Storage sobrescreve.
 *
 * O que se perde: histórico de versões dos arquivos. Quem quiser isso continua
 * podendo publicar no Git — as duas fontes convivem e a biblioteca mostra as
 * duas juntas.
 *
 * Caminho dos arquivos: `<id da conta>/<id do modelo>/<arquivo>`. A pasta por
 * conta não é organização, é a fronteira de permissão: as políticas do bucket
 * exigem que o primeiro nível seja o id de quem está enviando.
 */

import CONFIG from '../../config.js';
import * as sb from './supabase.js';

const BUCKET = 'modelos';

export class StorageError extends Error {
  constructor(message, { status = 0, detail = '' } = {}) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
    this.detail = detail;
  }
}

/** `true` quando dá para publicar pelo Storage: projeto configurado e sessão. */
export const isAvailable = () => sb.isConfigured() && !!sb.getSession();

const base = () => sb.projectUrl();

/** URL pública e permanente de um arquivo do bucket. */
export function publicUrl(path) {
  if (!path) return '';
  const clean = String(path).replace(/^\/+/, '');
  return `${base()}/storage/v1/object/public/${BUCKET}/${
    clean.split('/').map(encodeURIComponent).join('/')
  }`;
}

/** Pasta de um modelo, já com o id da conta no primeiro nível. */
export function modelFolder(modelId) {
  const user = sb.sessionUser();
  if (!user) throw new StorageError('Entre na sua conta para publicar.');
  return `${user.id}/${modelId}`;
}

/** Traduz as recusas mais comuns do Storage. */
function translate(message, status) {
  const text = String(message || '');
  if (/exceeded the maximum allowed size|payload too large/i.test(text) || status === 413) {
    return 'Arquivo maior que o limite do bucket (50 MB no plano gratuito do Supabase).';
  }
  if (/bucket not found/i.test(text)) {
    return 'O bucket "modelos" não existe neste projeto. Rode supabase/storage.sql no editor SQL.';
  }
  if (/new row violates row-level security|violates row-level security/i.test(text)) {
    return 'Permissão recusada pelo banco. Confirme que supabase/storage.sql foi aplicado por inteiro.';
  }
  if (/duplicate|already exists/i.test(text)) {
    return 'Já existe um arquivo com este nome. Tente publicar de novo.';
  }
  if (/jwt|unauthorized/i.test(text) || status === 401) {
    return 'Sessão expirada. Entre novamente.';
  }
  if (/quota|storage limit/i.test(text)) {
    return 'Cota de armazenamento do projeto esgotada (1 GB no plano gratuito).';
  }
  return text || `Erro ${status} no Storage.`;
}

async function withSession() {
  const session = sb.getSession();
  if (!session) throw new StorageError('Entre na sua conta para publicar.');
  // Força a renovação do token quando ele está perto de expirar: um upload de
  // 40 MB pode começar válido e terminar recusado.
  await sb.select('models', { select: 'id', limit: 1 }).catch(() => {});
  return sb.getSession() || session;
}

/**
 * Envia bytes para o bucket.
 *
 * `onProgress` recebe 0..1 quando o navegador reporta o andamento. Usa
 * XMLHttpRequest porque `fetch` ainda não expõe progresso de upload — e num
 * arquivo de dezenas de megabytes uma barra parada parece travamento.
 */
export async function upload({ path, bytes, contentType, onProgress }) {
  const session = await withSession();
  const url = `${base()}/storage/v1/object/${BUCKET}/${
    String(path).split('/').map(encodeURIComponent).join('/')
  }`;

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url, true);
    request.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    request.setRequestHeader('apikey', CONFIG.supabase.anonKey);
    request.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
    // Sobrescreve em vez de recusar: republicar o mesmo modelo é normal.
    request.setRequestHeader('x-upsert', 'true');

    if (onProgress) {
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
    }

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(1);
        resolve({ path, url: publicUrl(path) });
        return;
      }
      let payload = null;
      try { payload = JSON.parse(request.responseText); } catch { /* resposta não-JSON */ }
      reject(new StorageError(translate(payload?.message || payload?.error || request.statusText, request.status), {
        status: request.status,
        detail: request.responseText?.slice(0, 200) || '',
      }));
    });
    request.addEventListener('error', () => {
      reject(new StorageError('Falha de rede no envio para o Storage.'));
    });
    request.addEventListener('abort', () => {
      reject(new StorageError('Envio cancelado.'));
    });

    request.send(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  });
}

/** Remove um arquivo do bucket. Ausência não é erro. */
export async function remove(path) {
  const session = await withSession();
  const url = `${base()}/storage/v1/object/${BUCKET}/${
    String(path).split('/').map(encodeURIComponent).join('/')
  }`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: CONFIG.supabase.anonKey,
    },
  });
  if (!response.ok && response.status !== 404) {
    const payload = await response.json().catch(() => null);
    throw new StorageError(translate(payload?.message, response.status), { status: response.status });
  }
}

/** Confere se o bucket existe e responde. */
export async function healthCheck() {
  if (!sb.isConfigured()) return { ok: false, error: 'Supabase não configurado.' };
  try {
    const response = await fetch(
      `${base()}/storage/v1/object/list/${BUCKET}`,
      {
        method: 'POST',
        headers: {
          apikey: CONFIG.supabase.anonKey,
          Authorization: `Bearer ${sb.getSession()?.access_token || CONFIG.supabase.anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prefix: '', limit: 1 }),
      },
    );
    if (response.ok) return { ok: true };
    const payload = await response.json().catch(() => null);
    return { ok: false, error: translate(payload?.message, response.status) };
  } catch (cause) {
    return { ok: false, error: `Storage inacessível: ${cause}` };
  }
}

export default { isAvailable, upload, remove, publicUrl, modelFolder, healthCheck };
