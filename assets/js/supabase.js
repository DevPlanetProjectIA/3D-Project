/*
 * Cliente mínimo do Supabase, sem SDK.
 *
 * O projeto não usa npm nem CDN, então o acesso é por `fetch` direto nos
 * endpoints REST: `/auth/v1` para autenticação e `/rest/v1` (PostgREST) para
 * dados. São duas APIs HTTP estáveis e documentadas — o SDK oficial é
 * conveniência, não requisito.
 *
 * Segurança: a `anonKey` é pública por projeto. Quem protege os dados são as
 * políticas de RLS do banco (ver `supabase/schema.sql`), que amarram cada
 * linha ao `auth.uid()` do dono. Este arquivo nunca deve receber a chave
 * `service_role`.
 */

import CONFIG from '../../config.js';
import store from './store.js';

const SESSION_KEY = 'sbSession';
/** Margem para renovar o token antes de ele expirar de fato. */
const REFRESH_MARGIN_SECONDS = 90;

export class SupabaseError extends Error {
  constructor(message, { status = 0, code = '', detail = '' } = {}) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/*
 * Credenciais: `config.js` vale para todo mundo que abre o site; a conexão
 * salva pelo navegador vale só aqui. A segunda existe para quem ainda não quer
 * (ou não pode) editar o repositório conseguir testar o projeto na hora — e
 * tem precedência, porque é a escolha explícita de quem está na máquina.
 */
const OVERRIDE_KEY = 'supabaseConnection';

const override = () => {
  const saved = store.get(OVERRIDE_KEY, null);
  return saved?.url && saved?.anonKey ? saved : null;
};

/** De onde vêm as credenciais em uso: `'config'`, `'navegador'` ou `''`. */
export function credentialSource() {
  if (override()) return 'navegador';
  if (CONFIG.supabase?.url && CONFIG.supabase?.anonKey) return 'config';
  return '';
}

/** Guarda a conexão neste navegador. Passe `null` para descartar. */
export function setConnection(connection) {
  if (!connection) { store.remove(OVERRIDE_KEY); return null; }
  const url = String(connection.url || '').trim().replace(/\/+$/, '');
  const key = String(connection.anonKey || '').trim();
  if (!url || !key) return null;
  const saved = { url, anonKey: key };
  store.set(OVERRIDE_KEY, saved);
  return saved;
}

/** `true` quando o projeto está configurado; `false` mantém o modo local. */
export const isConfigured = () => !!credentialSource();

const baseUrl = () => String(override()?.url || CONFIG.supabase?.url || '').replace(/\/+$/, '');
const anonKey = () => String(override()?.anonKey || CONFIG.supabase?.anonKey || '');

/**
 * Valida um par URL + chave sem salvar nada.
 *
 * Checa a forma, depois bate no projeto de verdade: uma chave trocada ou um
 * schema ausente só aparecem na resposta do servidor.
 */
export async function testConnection({ url, anonKey: key }) {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  const cleanKey = String(key || '').trim();

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(cleanUrl)) {
    return { ok: false, error: 'A URL deve ser como https://seu-projeto.supabase.co (sem barra no fim).' };
  }
  if (cleanKey.length < 40) {
    return { ok: false, error: 'A chave parece curta demais. Copie a chave pública inteira (anon / publishable).' };
  }
  // Duas gerações de chave secreta: o JWT com role service_role e o formato
  // novo com prefixo sb_secret_. Nenhuma das duas pode chegar ao navegador.
  const isSecret = /^sb_secret_/i.test(cleanKey)
    || /service_role/.test(cleanKey)
    || /"role"\s*:\s*"service_role"/.test(safeDecodeJwt(cleanKey));
  if (isSecret) {
    return { ok: false, error: 'Esta é uma chave secreta (service_role / sb_secret_): ela ignora todas as políticas de segurança e não pode ir para o navegador. Use a chave pública (anon / sb_publishable_).' };
  }

  try {
    const response = await fetch(`${cleanUrl}/rest/v1/filaments?select=id&limit=1`, {
      headers: { apikey: cleanKey, Authorization: `Bearer ${cleanKey}` },
    });
    if (response.status === 401) return { ok: false, error: 'Chave recusada pelo projeto. Confirme que copiou a chave pública deste projeto.' };
    if (response.status === 404) return { ok: false, error: 'Projeto encontrado, mas a tabela "filaments" não existe. Rode supabase/schema.sql no editor SQL.' };
    if (!response.ok && response.status !== 200) {
      const body = await response.json().catch(() => null);
      return { ok: false, error: translate(body?.message || `HTTP ${response.status}`, response.status) };
    }
    return { ok: true, projectRef: new URL(cleanUrl).hostname.split('.')[0] };
  } catch (cause) {
    return { ok: false, error: `Não foi possível alcançar o projeto. Verifique a URL e sua conexão. (${cause})` };
  }
}

/** Payload de um JWT, sem validar assinatura — só para detectar service_role. */
function safeDecodeJwt(token) {
  try {
    return atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return '';
  }
}

/* ---------- Sessão ---------- */

const listeners = new Set();

function emit() {
  const session = getSession();
  for (const listener of listeners) {
    try { listener(session); } catch { /* um ouvinte com defeito não derruba os outros */ }
  }
}

/** Registra um ouvinte de mudança de sessão. Devolve a função de remoção. */
export function onAuthChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSession() {
  const session = store.get(SESSION_KEY, null);
  if (!session?.access_token) return null;
  return session;
}

function saveSession(raw) {
  if (!raw?.access_token) return null;
  const expiresAt = raw.expires_at
    ? Number(raw.expires_at)
    : Math.floor(Date.now() / 1000) + (Number(raw.expires_in) || 3600);
  const session = {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token || getSession()?.refresh_token || '',
    expires_at: expiresAt,
    user: raw.user || getSession()?.user || null,
  };
  store.set(SESSION_KEY, session);
  emit();
  return session;
}

export function clearSession() {
  store.remove(SESSION_KEY);
  emit();
}

/* ---------- Requisições ---------- */

async function request(path, { method = 'GET', body, headers = {}, auth = true, raw = false } = {}) {
  if (!isConfigured()) throw new SupabaseError('Supabase não está configurado neste site.');

  const token = auth ? (await freshAccessToken()) : '';
  const finalHeaders = {
    apikey: anonKey(),
    Authorization: `Bearer ${token || anonKey()}`,
    ...headers,
  };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new SupabaseError('Falha de rede ao contatar o Supabase. Verifique sua conexão.', { detail: String(cause) });
  }

  if (response.status === 204) return null;

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (response.ok) return raw ? text : payload;

  // 401 em requisição autenticada: a sessão morreu, não há como recuperar aqui.
  if (response.status === 401 && auth && getSession()) clearSession();

  const message = payload?.msg || payload?.message || payload?.error_description
    || payload?.error || response.statusText;
  throw new SupabaseError(translate(message, response.status), {
    status: response.status,
    code: payload?.error_code || payload?.code || '',
    detail: payload?.hint || payload?.details || '',
  });
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { message: text }; }
}

/** Mensagens do Supabase vêm em inglês; as mais comuns ganham tradução. */
function translate(message, status) {
  const text = String(message || '');
  const map = [
    [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/email not confirmed/i, 'Confirme o e-mail antes de entrar. Procure a mensagem do Supabase na sua caixa.'],
    [/user already registered|already been registered/i, 'Já existe uma conta com este e-mail.'],
    [/password should be at least (\d+)/i, 'A senha é curta demais para a política do projeto.'],
    [/for security purposes.*(\d+) seconds/i, 'Muitas tentativas seguidas. Aguarde alguns segundos.'],
    [/signups? not allowed|signup is disabled/i, 'O cadastro por e-mail está desativado neste projeto do Supabase.'],
    [/provider is not enabled/i, 'O provedor Google não está habilitado no projeto do Supabase.'],
    [/jwt expired/i, 'Sua sessão expirou. Entre novamente.'],
    [/row-level security|permission denied/i, 'Sem permissão para este dado. Confira as políticas de RLS do banco.'],
    [/relation .* does not exist/i, 'Tabela ausente no banco. Rode o schema.sql no editor SQL do Supabase.'],
  ];
  for (const [pattern, translated] of map) if (pattern.test(text)) return translated;
  if (status === 404) return 'Recurso não encontrado no Supabase.';
  return text || `Erro ${status} no Supabase.`;
}

/* ---------- Token ---------- */

let refreshing = null;

/** Devolve um access token válido, renovando-o quando estiver perto de expirar. */
async function freshAccessToken() {
  const session = getSession();
  if (!session) return '';

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - now > REFRESH_MARGIN_SECONDS) return session.access_token;
  if (!session.refresh_token) { clearSession(); return ''; }

  // Várias chamadas em paralelo não devem disparar vários refreshes.
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const data = await request('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          body: { refresh_token: session.refresh_token },
          auth: false,
        });
        return saveSession(data)?.access_token || '';
      } catch {
        clearSession();
        return '';
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/* ---------- Autenticação ---------- */

/**
 * Captura o retorno do provedor OAuth.
 *
 * O Supabase devolve os tokens no fragmento da URL, que é exatamente onde este
 * aplicativo guarda a rota (`#/biblioteca`). Esta função precisa rodar antes do
 * roteador: ela lê os tokens, grava a sessão e limpa o fragmento.
 *
 * Devolve `{ ok, error }` quando havia um retorno para tratar, ou `null`.
 */
export function captureOAuthRedirect() {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const query = location.search.startsWith('?') ? location.search.slice(1) : '';

  const fromHash = new URLSearchParams(hash);
  const fromQuery = new URLSearchParams(query);

  const accessToken = fromHash.get('access_token');
  const errorCode = fromHash.get('error') || fromQuery.get('error');
  const errorDescription = fromHash.get('error_description') || fromQuery.get('error_description');

  if (!accessToken && !errorCode) return null;

  // Tira os parâmetros do OAuth da barra de endereço em qualquer caso: eles não
  // devem sobreviver a um recarregamento nem vazar em um link compartilhado.
  const clean = () => history.replaceState(null, '', `${location.pathname}#/biblioteca`);

  if (errorCode) {
    clean();
    return { ok: false, error: translateOAuthError(errorCode, errorDescription) };
  }

  saveSession({
    access_token: accessToken,
    refresh_token: fromHash.get('refresh_token') || '',
    expires_in: Number(fromHash.get('expires_in')) || 3600,
  });
  clean();
  return { ok: true };
}

function translateOAuthError(code, description) {
  if (/access_denied/i.test(code)) return 'Entrada pelo Google cancelada.';
  if (/server_error/i.test(code)) return 'O Supabase recusou a resposta do Google. Confira o provedor no painel.';
  return description || `Falha na entrada pelo Google (${code}).`;
}

/** URL de retorno: a própria página, sem fragmento nem busca. */
const redirectTarget = () => `${location.origin}${location.pathname}`;

/**
 * URL de entrada por provedor externo.
 *
 * Separada da navegação para poder ser verificada sem sair da página.
 */
export function authorizeUrl(provider = 'google') {
  const params = new URLSearchParams({ provider, redirect_to: redirectTarget() });
  return `${baseUrl()}/auth/v1/authorize?${params}`;
}

/* ---------- Capacidades do projeto ---------- */

const SETTINGS_CACHE_KEY = 'authSettings';
let settingsPromise = null;

/**
 * O que este projeto aceita: provedores externos, e-mail, cadastro aberto e
 * confirmação de e-mail.
 *
 * Serve para a interface não oferecer o que não existe. Sem isso, um projeto
 * com o Google desligado manda a pessoa para uma página de JSON com
 * "provider is not enabled" — erro de configuração do dono do projeto
 * apresentado como se fosse falha de quem só quis entrar.
 *
 * A resposta é cacheada no navegador para a tela de login não esperar rede.
 */
export async function authSettings({ force = false } = {}) {
  const cached = store.get(SETTINGS_CACHE_KEY, null);
  if (cached && !force) {
    // Devolve o cache agora e revalida em segundo plano.
    if (!settingsPromise) settingsPromise = fetchAuthSettings().catch(() => null);
    return cached;
  }
  if (!settingsPromise || force) settingsPromise = fetchAuthSettings();
  try {
    return await settingsPromise;
  } catch {
    return cached;
  } finally {
    settingsPromise = null;
  }
}

async function fetchAuthSettings() {
  const data = await request('/auth/v1/settings', { auth: false });
  const external = data?.external || {};
  const settings = {
    providers: Object.entries(external)
      .filter(([, enabled]) => enabled === true)
      .map(([name]) => name),
    google: external.google === true,
    email: external.email === true,
    signupEnabled: data?.disable_signup !== true,
    /** `true` quando o projeto já considera o e-mail confirmado no cadastro. */
    autoConfirm: data?.mailer_autoconfirm === true,
    fetchedAt: Date.now(),
  };
  store.set(SETTINGS_CACHE_KEY, settings);
  return settings;
}

/** Leitura sincrona do cache, para a primeira pintura da tela. */
export const cachedAuthSettings = () => store.get(SETTINGS_CACHE_KEY, null);

/**
 * Redireciona para o Google.
 *
 * Confere o provedor antes de sair da página: é a diferença entre uma
 * explicação acionável e uma página de erro em JSON.
 */
export async function signInWithGoogle() {
  const settings = await authSettings();
  if (settings && !settings.google) {
    throw new SupabaseError(
      'O provedor Google não está habilitado neste projeto do Supabase.',
      { code: 'provider_disabled' },
    );
  }
  location.assign(authorizeUrl('google'));
}

export async function signUpWithPassword({ email, password, username }) {
  const data = await request('/auth/v1/signup', {
    method: 'POST',
    auth: false,
    body: {
      email,
      password,
      data: username ? { username } : undefined,
      options: { email_redirect_to: redirectTarget() },
    },
  });
  // Com confirmação de e-mail ligada, o Supabase devolve o usuário sem sessão.
  const session = data?.access_token ? saveSession(data) : null;
  return { session, user: data?.user || data, needsConfirmation: !session };
}

export async function signInWithPassword({ email, password }) {
  const data = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });
  return saveSession(data);
}

export async function sendPasswordReset(email) {
  await request('/auth/v1/recover', {
    method: 'POST',
    auth: false,
    body: { email, options: { redirect_to: redirectTarget() } },
  });
}

export async function signOut() {
  try {
    if (getSession()) await request('/auth/v1/logout', { method: 'POST' });
  } catch {
    // Sessão já inválida no servidor: encerrar localmente é o que importa.
  }
  clearSession();
}

/** Busca o usuário atual no servidor e atualiza a sessão guardada. */
export async function fetchUser() {
  const user = await request('/auth/v1/user');
  const session = getSession();
  if (session) { session.user = user; store.set(SESSION_KEY, session); emit(); }
  return user;
}

/** Usuário da sessão local, sem ida ao servidor. */
export const sessionUser = () => getSession()?.user || null;

export async function updateAuthUser(patch) {
  const user = await request('/auth/v1/user', { method: 'PUT', body: patch });
  const session = getSession();
  if (session) { session.user = user; store.set(SESSION_KEY, session); emit(); }
  return user;
}

/* ---------- Dados (PostgREST) ---------- */

/** Monta a query string de filtros no formato do PostgREST. */
function buildQuery({ select = '*', eq = {}, order = '', limit = 0, single = false } = {}) {
  const params = new URLSearchParams();
  params.set('select', select);
  for (const [column, value] of Object.entries(eq)) {
    if (value === undefined || value === null) continue;
    params.append(column, `eq.${value}`);
  }
  if (order) params.set('order', order);
  if (limit) params.set('limit', String(limit));
  void single;
  return params.toString();
}

export async function select(table, options = {}) {
  const rows = await request(`/rest/v1/${table}?${buildQuery(options)}`, {
    headers: options.single ? { Accept: 'application/vnd.pgrst.object+json' } : {},
  });
  return rows ?? (options.single ? null : []);
}

export async function insert(table, rows, { upsert = false, onConflict = '' } = {}) {
  const prefer = ['return=representation'];
  if (upsert) prefer.push('resolution=merge-duplicates');
  const suffix = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  return request(`/rest/v1/${table}${suffix}`, {
    method: 'POST',
    body: Array.isArray(rows) ? rows : [rows],
    headers: { Prefer: prefer.join(',') },
  });
}

export const upsert = (table, rows, onConflict = 'id') =>
  insert(table, rows, { upsert: true, onConflict });

export async function update(table, patch, { eq = {} } = {}) {
  return request(`/rest/v1/${table}?${buildQuery({ select: '*', eq })}`, {
    method: 'PATCH',
    body: patch,
    headers: { Prefer: 'return=representation' },
  });
}

export async function remove(table, { eq = {} } = {}) {
  await request(`/rest/v1/${table}?${buildQuery({ select: 'id', eq })}`, { method: 'DELETE' });
}

/**
 * Verifica se o projeto responde e se o schema foi aplicado.
 *
 * A sonda é uma tabela do schema, não a raiz `/rest/v1/`: no sistema novo de
 * chaves do Supabase, a raiz só aceita chave secreta, e usá-la aqui dava um
 * falso "projeto inacessível" em todo projeto com chave `sb_publishable_`.
 * O código de status distingue os três casos que interessam.
 */
export async function healthCheck() {
  const result = { reachable: false, schema: false, authenticated: !!getSession(), error: '' };
  try {
    await select('filaments', { select: 'id', limit: 1 });
    result.reachable = true;
    result.schema = true;
    return result;
  } catch (error) {
    const status = error instanceof SupabaseError ? error.status : 0;
    result.error = error.message;
    // Status HTTP qualquer significa que o projeto respondeu; só a ausência de
    // resposta (status 0) é de fato inacessível.
    result.reachable = status > 0;
    result.schema = false;
    if (status === 404) {
      result.error = 'O projeto responde, mas as tabelas não existem. Rode supabase/schema.sql no editor SQL.';
    }
    return result;
  }
}

export default {
  isConfigured, getSession, onAuthChange, captureOAuthRedirect,
  signInWithGoogle, signInWithPassword, signUpWithPassword, signOut,
  select, insert, upsert, update, remove,
};
