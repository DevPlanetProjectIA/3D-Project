/*
 * Contas locais.
 *
 * IMPORTANTE — modelo de segurança:
 * o site é estático e publicado pelo GitHub Pages; não existe servidor para
 * validar credenciais. As contas vivem no `localStorage` do navegador e a senha
 * é guardada como derivação PBKDF2-SHA256 (nunca em texto claro). Isso protege
 * a senha caso alguém leia o armazenamento do navegador, mas NÃO torna os
 * arquivos privados: todo o conteúdo de `models/` é público no repositório.
 * Trate o login como um controle de acesso da interface e das preferências
 * pessoais, não como uma barreira de confidencialidade.
 */

import CONFIG from '../../config.js';
import store from './store.js';
import { colorFor } from './util.js';

const USERS_KEY = 'users';
const SESSION_KEY = 'session';
const TOKEN_KEY = 'ghToken';

const enc = new TextEncoder();

/* ---------- Criptografia ---------- */

function toB64(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

function randomB64(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toB64(bytes);
}

async function derive(password, saltB64, iterations) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return toB64(bits);
}

/** Comparação em tempo constante de duas strings base64. */
function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- Força da senha ---------- */

const COMMON = ['123456', 'password', 'senha', 'qwerty', '111111', 'abc123', '12345678', 'admin', 'iloveyou', '3dprint'];

/** Devolve `{ score: 0..4, label, hints[] }`. */
export function passwordStrength(password) {
  const value = String(password || '');
  const hints = [];
  let score = 0;

  if (value.length >= CONFIG.password.minLength) score++;
  else hints.push(`Use ao menos ${CONFIG.password.minLength} caracteres`);

  if (value.length >= 12) score++;
  else if (value.length >= CONFIG.password.minLength) hints.push('12+ caracteres deixam a senha bem mais forte');

  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  else hints.push('Misture maiúsculas e minúsculas');

  if (/\d/.test(value) && /[^\w\s]/.test(value)) score++;
  else hints.push('Inclua números e símbolos');

  // Penaliza apenas quando a sequência comum domina a senha — "Senha!Forte#2026"
  // não deve ser reprovada por conter "senha" no meio de 16 caracteres.
  const core = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const dominated = COMMON.some((common) => core.includes(common) && common.length * 2 >= core.length);
  if (dominated) { score = Math.min(score, 1); hints.unshift('Evite senhas baseadas em sequências comuns'); }
  if (/^(.)\1+$/.test(value)) score = Math.min(score, 1);

  const labels = ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'];
  return { score: Math.max(0, Math.min(4, score)), label: labels[Math.max(0, Math.min(4, score))], hints };
}

/* ---------- Usuários ---------- */

const readUsers = () => store.get(USERS_KEY, []) || [];
const writeUsers = (users) => store.set(USERS_KEY, users);

/** Remove campos sensíveis antes de expor um usuário. */
function publicUser(user) {
  if (!user) return null;
  const { passHash, salt, iterations, ...rest } = user;
  return rest;
}

export function listUsers() {
  return readUsers().map(publicUser);
}

export function usersExist() {
  return readUsers().length > 0;
}

function findUser(identifier) {
  const needle = String(identifier || '').trim().toLowerCase();
  if (!needle) return null;
  return readUsers().find((u) => u.username.toLowerCase() === needle || u.email.toLowerCase() === needle) || null;
}

/* ---------- Validação ---------- */

const RE_USERNAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,23}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateSignup({ username, email, password, confirm }) {
  const errors = {};
  const user = String(username || '').trim();
  const mail = String(email || '').trim();

  if (!user) errors.username = 'Informe um nome de usuário.';
  else if (!RE_USERNAME.test(user)) errors.username = '3 a 24 caracteres: letras, números, ponto, hífen ou _.';
  else if (findUser(user)) errors.username = 'Este nome de usuário já existe.';

  if (!mail) errors.email = 'Informe um e-mail.';
  else if (!RE_EMAIL.test(mail)) errors.email = 'E-mail inválido.';
  else if (findUser(mail)) errors.email = 'Já existe uma conta com este e-mail.';

  if (!password) errors.password = 'Informe uma senha.';
  else if (password.length < CONFIG.password.minLength) errors.password = `Mínimo de ${CONFIG.password.minLength} caracteres.`;
  else if (passwordStrength(password).score < 2) errors.password = 'Senha muito fraca.';

  if (confirm !== undefined && password !== confirm) errors.confirm = 'As senhas não coincidem.';

  return { ok: Object.keys(errors).length === 0, errors };
}

/* ---------- Ciclo de vida da conta ---------- */

export async function signUp({ username, email, password, confirm }) {
  const { ok, errors } = validateSignup({ username, email, password, confirm });
  if (!ok) return { ok: false, errors };

  const salt = randomB64(16);
  const iterations = CONFIG.password.iterations;
  const user = {
    id: crypto.randomUUID(),
    username: String(username).trim(),
    email: String(email).trim(),
    passHash: await derive(password, salt, iterations),
    salt,
    iterations,
    bio: '',
    color: colorFor(String(username).trim()),
    favorites: [],
    /** O primeiro cadastro é marcado como mantenedor — apenas informativo. */
    role: usersExist() ? 'member' : 'owner',
    createdAt: new Date().toISOString(),
  };

  const users = readUsers();
  users.push(user);
  if (!writeUsers(users)) {
    return { ok: false, errors: { form: 'Não foi possível gravar os dados locais. Verifique se o navegador permite armazenamento neste site.' } };
  }
  startSession(user.id, true);
  return { ok: true, user: publicUser(user) };
}

export async function signIn({ identifier, password, remember = true }) {
  const user = findUser(identifier);
  // Deriva mesmo sem usuário, para não vazar a existência da conta pelo tempo de resposta.
  const salt = user?.salt || randomB64(16);
  const iterations = user?.iterations || CONFIG.password.iterations;
  const digest = await derive(String(password || ''), salt, iterations);

  if (!user || !sameDigest(digest, user.passHash)) {
    return { ok: false, errors: { form: 'Usuário ou senha incorretos.' } };
  }

  touch(user.id, { lastLoginAt: new Date().toISOString() });
  startSession(user.id, remember);
  return { ok: true, user: publicUser(user) };
}

export async function changePassword({ current, next, confirm }) {
  const raw = readUsers().find((u) => u.id === currentSessionId());
  if (!raw) return { ok: false, errors: { form: 'Sessão expirada.' } };

  const digest = await derive(String(current || ''), raw.salt, raw.iterations);
  if (!sameDigest(digest, raw.passHash)) return { ok: false, errors: { current: 'Senha atual incorreta.' } };
  if (!next || next.length < CONFIG.password.minLength) return { ok: false, errors: { next: `Mínimo de ${CONFIG.password.minLength} caracteres.` } };
  if (passwordStrength(next).score < 2) return { ok: false, errors: { next: 'Senha muito fraca.' } };
  if (next !== confirm) return { ok: false, errors: { confirm: 'As senhas não coincidem.' } };

  const salt = randomB64(16);
  const iterations = CONFIG.password.iterations;
  const passHash = await derive(next, salt, iterations);
  const users = readUsers().map((u) => (u.id === raw.id ? { ...u, salt, iterations, passHash } : u));
  writeUsers(users);
  return { ok: true };
}

export function updateProfile(patch) {
  const id = currentSessionId();
  if (!id) return null;
  const allowed = ['bio', 'email', 'color'];
  const clean = {};
  for (const key of allowed) if (key in patch) clean[key] = patch[key];
  if (clean.email && !RE_EMAIL.test(clean.email)) return null;
  return touch(id, clean);
}

export function deleteAccount() {
  const id = currentSessionId();
  if (!id) return false;
  writeUsers(readUsers().filter((u) => u.id !== id));
  signOut();
  return true;
}

function touch(id, patch) {
  let updated = null;
  const users = readUsers().map((u) => {
    if (u.id !== id) return u;
    updated = { ...u, ...patch };
    return updated;
  });
  writeUsers(users);
  return publicUser(updated);
}

/* ---------- Sessão ---------- */

function currentSessionId() {
  return store.get(SESSION_KEY)?.userId || store.session.get(SESSION_KEY)?.userId || null;
}

function startSession(userId, remember) {
  const payload = { userId, at: Date.now() };
  if (remember) { store.set(SESSION_KEY, payload); store.session.remove(SESSION_KEY); }
  else { store.session.set(SESSION_KEY, payload); store.remove(SESSION_KEY); }
}

/** Usuário autenticado, ou `null`. */
export function currentUser() {
  const id = currentSessionId();
  if (!id) return null;
  return publicUser(readUsers().find((u) => u.id === id) || null);
}

export function signOut() {
  store.remove(SESSION_KEY);
  store.session.remove(SESSION_KEY);
}

/** Navegação anônima: permitida por configuração e escolhida explicitamente. */
export function isGuest() {
  return !currentUser() && store.session.get('guest') === true;
}

export function enterAsGuest() {
  store.session.set('guest', true);
}

export function leaveGuest() {
  store.session.remove('guest');
}

/* ---------- Favoritos ---------- */

export function toggleFavorite(modelId) {
  const user = currentUser();
  if (!user) return null;
  const favorites = new Set(user.favorites || []);
  if (favorites.has(modelId)) favorites.delete(modelId);
  else favorites.add(modelId);
  return touch(user.id, { favorites: [...favorites] });
}

export function isFavorite(modelId) {
  return (currentUser()?.favorites || []).includes(modelId);
}

/* ---------- Token do GitHub ---------- */
/*
 * Necessário apenas para gravar (upload/remoção), porque a escrita usa a
 * API de conteúdo do GitHub. Fica no `localStorage` deste navegador e nunca
 * é enviado para outro destino além de api.github.com.
 */

export function getToken() {
  return store.get(TOKEN_KEY) || '';
}

export function setToken(token) {
  const value = String(token || '').trim();
  if (!value) { store.remove(TOKEN_KEY); return ''; }
  store.set(TOKEN_KEY, value);
  return value;
}

export function clearToken() {
  store.remove(TOKEN_KEY);
}

export function hasToken() {
  return !!getToken();
}
