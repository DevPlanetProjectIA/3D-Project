/*
 * Catálogo de modelos.
 *
 * A fonte da verdade é `data/catalog.json`, versionado no repositório. A leitura
 * usa o próprio site publicado (sem token, sem cota de API). A escrita passa
 * pela API de conteúdo do GitHub, em `github.js`.
 */

import CONFIG from '../../config.js';
import * as gh from './github.js';
import { slugify } from './util.js';

/** Base do site publicado — resolve corretamente em subdiretórios do Pages. */
export const BASE = new URL('.', document.baseURI).href;

/** URL pública de um arquivo do repositório servido pelo Pages. */
export const assetUrl = (path) => new URL(String(path).replace(/^\/+/, ''), BASE).href;

const EMPTY = { version: 1, updated: null, models: [] };

let cache = null;
let inFlight = null;

/* ---------- Normalização ---------- */

function normalizeModel(raw, index) {
  const id = String(raw.id || `modelo-${index}`);
  const format = String(raw.format || raw.file?.split('.').pop() || 'stl').toLowerCase();
  return {
    id,
    name: String(raw.name || id),
    description: String(raw.description || ''),
    format: format === '3mf' ? '3mf' : 'stl',
    file: String(raw.file || ''),
    thumb: raw.thumb ? String(raw.thumb) : '',
    size: Number(raw.size) || 0,
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    author: String(raw.author || 'desconhecido'),
    license: String(raw.license || 'Não especificada'),
    triangles: Number(raw.triangles) || 0,
    dimensions: {
      x: Number(raw.dimensions?.x) || 0,
      y: Number(raw.dimensions?.y) || 0,
      z: Number(raw.dimensions?.z) || 0,
    },
    print: {
      material: String(raw.print?.material || raw.printSettings?.material || ''),
      layerHeight: String(raw.print?.layerHeight || raw.printSettings?.layerHeight || ''),
      infill: String(raw.print?.infill || raw.printSettings?.infill || ''),
      supports: !!(raw.print?.supports ?? raw.printSettings?.supports),
      notes: String(raw.print?.notes || ''),
    },
    createdAt: raw.createdAt || null,
  };
}

function normalizeCatalog(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const models = Array.isArray(raw.models) ? raw.models.map(normalizeModel) : [];
  return { version: Number(raw.version) || 1, updated: raw.updated || null, models };
}

/* ---------- Leitura ---------- */

/** Carrega o catálogo (com cache em memória). `force` ignora o cache e o do HTTP. */
export async function load({ force = false } = {}) {
  if (cache && !force) return cache;
  if (inFlight && !force) return inFlight;

  const url = assetUrl(CONFIG.paths.catalog) + (force ? `?t=${Date.now()}` : '');
  inFlight = (async () => {
    try {
      const response = await fetch(url, { cache: force ? 'reload' : 'default' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      cache = normalizeCatalog(await response.json());
    } catch {
      // Catálogo ausente é um estado válido: repositório recém-criado.
      cache = { ...EMPTY };
    }
    return cache;
  })();

  try { return await inFlight; } finally { inFlight = null; }
}

export function peek() {
  return cache;
}

export function invalidate() {
  cache = null;
}

/** Acrescenta um modelo ao cache em memória (otimista, antes do Pages publicar). */
export function primeLocal(model) {
  if (!cache) cache = { ...EMPTY, models: [] };
  cache = { ...cache, models: [normalizeModel(model, 0), ...cache.models.filter((m) => m.id !== model.id)] };
  return cache;
}

export function dropLocal(id) {
  if (!cache) return;
  cache = { ...cache, models: cache.models.filter((m) => m.id !== id) };
}

export async function getById(id) {
  const { models } = await load();
  return models.find((m) => m.id === id) || null;
}

/* ---------- Consulta ---------- */

export const SORTS = {
  recent: { label: 'Mais recentes', fn: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') },
  name: { label: 'Nome (A–Z)', fn: (a, b) => a.name.localeCompare(b.name, 'pt-BR') },
  size: { label: 'Maiores arquivos', fn: (a, b) => b.size - a.size },
  complexity: { label: 'Mais triângulos', fn: (a, b) => b.triangles - a.triangles },
};

function haystack(model) {
  return [model.name, model.description, model.author, ...model.tags].join(' ').toLowerCase();
}

/** Filtra e ordena. Todos os critérios são opcionais. */
export function query(models, { search = '', tags = [], format = '', author = '', ids = null, sort = 'recent' } = {}) {
  const terms = String(search).toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = new Set(tags);
  const idSet = ids ? new Set(ids) : null;

  const filtered = models.filter((model) => {
    if (idSet && !idSet.has(model.id)) return false;
    if (format && model.format !== format) return false;
    if (author && model.author.toLowerCase() !== author.toLowerCase()) return false;
    if (wanted.size && !model.tags.some((t) => wanted.has(t))) return false;
    if (terms.length) {
      const text = haystack(model);
      if (!terms.every((term) => text.includes(term))) return false;
    }
    return true;
  });

  const sorter = (SORTS[sort] || SORTS.recent).fn;
  return filtered.sort(sorter);
}

/** Contagem de ocorrências por tag, em ordem decrescente. */
export function tagCounts(models) {
  const counts = new Map();
  for (const model of models) {
    for (const tag of model.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
}

export function authorCounts(models) {
  const counts = new Map();
  for (const model of models) counts.set(model.author, (counts.get(model.author) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/* ---------- Escrita ---------- */

/** Identificador único e estável, usado também como nome de diretório. */
export function makeId(name) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${slugify(name)}-${stamp}${rand}`;
}

export function modelDir(id) {
  return `${CONFIG.paths.models}/${id}`;
}

/**
 * Publica um modelo: grava o arquivo, a miniatura e atualiza o catálogo.
 * `onStep(key, status, extra)` reporta o progresso para a interface.
 */
export async function publish({ entry, fileBytes, thumbBytes }, onStep = () => {}) {
  const dir = modelDir(entry.id);
  const filePath = `${dir}/${entry.id}.${entry.format}`;
  const thumbPath = thumbBytes ? `${dir}/thumb.png` : '';

  onStep('file', 'active');
  await gh.putFile({
    path: filePath,
    content: fileBytes,
    message: `feat(biblioteca): adiciona modelo ${entry.name}`,
  });
  onStep('file', 'done');

  if (thumbBytes) {
    onStep('thumb', 'active');
    try {
      await gh.putFile({
        path: thumbPath,
        content: thumbBytes,
        message: `chore(biblioteca): miniatura de ${entry.name}`,
      });
      onStep('thumb', 'done');
    } catch {
      // A miniatura é opcional: segue sem ela.
      onStep('thumb', 'error');
    }
  }

  const record = { ...entry, file: filePath, thumb: thumbPath, createdAt: new Date().toISOString() };

  onStep('catalog', 'active');
  await gh.putJsonWithRetry({
    path: CONFIG.paths.catalog,
    message: `chore(catalogo): registra ${entry.name}`,
    build: (current) => {
      const base = normalizeCatalog(current);
      const models = [record, ...base.models.filter((m) => m.id !== record.id)];
      return { version: 1, updated: new Date().toISOString(), models };
    },
  });
  onStep('catalog', 'done');

  primeLocal(record);
  return record;
}

/** Remove um modelo do catálogo e apaga seus arquivos. */
export async function remove(model) {
  await gh.putJsonWithRetry({
    path: CONFIG.paths.catalog,
    message: `chore(catalogo): remove ${model.name}`,
    build: (current) => {
      const base = normalizeCatalog(current);
      return { version: 1, updated: new Date().toISOString(), models: base.models.filter((m) => m.id !== model.id) };
    },
  });

  for (const path of [model.file, model.thumb].filter(Boolean)) {
    try {
      const meta = await gh.getFileMeta(path);
      if (meta?.sha) await gh.deleteFile({ path, sha: meta.sha, message: `chore(biblioteca): remove ${path}` });
    } catch {
      // Arquivo já ausente: nada a fazer.
    }
  }

  dropLocal(model.id);
}
