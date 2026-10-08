/*
 * Estoque local: filamentos, insumos e produtos.
 *
 * Mesmo modelo do projeto original (coleção única com campo `type`), mas
 * persistido no navegador, já que o site é estático. Filamento é o registro
 * central: é dele que sai o preço por grama usado no custo de fabricação.
 *
 * Dois backends, uma API síncrona
 * -------------------------------
 * As telas chamam `filaments()`, `save()`, `available()` etc. de forma
 * síncrona, e isso não pode mudar. Então o Supabase entra por baixo:
 *
 *   - as leituras saem sempre de um cache em memória (hidratado do servidor)
 *     ou, no modo local, direto do `localStorage` como antes;
 *   - as escritas gravam em memória e no `localStorage` na hora, devolvem o
 *     registro imediatamente e só então disparam a ida ao servidor;
 *   - o que falhar na rede vai para uma fila persistida e é reenviado na
 *     próxima `hydrate()` ou `flush()`.
 *
 * Com `supabase.url` vazio no config nada disso roda: o caminho é o de sempre.
 */

import store from './store.js';
import { densityOf, normalizeMaterial, colorName } from './filaments.js';
import * as supabase from './supabase.js';

const KEY = 'inventory';
/* Cópia do estoque de antes da primeira hidratação, para o logout voltar a ele. */
const LOCAL_BACKUP_KEY = 'inventoryLocal';
const QUEUE_KEY = 'inventoryQueue';

const TYPES = ['filamento', 'insumo', 'produto'];
const TABLES = { filamento: 'filaments', insumo: 'supplies', produto: 'products' };

const readLocal = () => {
  const raw = store.get(KEY, []);
  return Array.isArray(raw) ? raw : [];
};

/* ---------- Estado de sincronização ---------- */

/** Cache em memória; `null` enquanto o modo local não precisou dele. */
let cache = null;
let hydrated = false;
let hydrating = null;
let syncError = '';

const listeners = new Set();

/** Avisa as telas para se redesenharem depois de hidratar ou sincronizar. */
export function onInventoryChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  const state = syncState();
  for (const listener of listeners) {
    try { listener(state); } catch { /* um ouvinte com defeito não derruba os outros */ }
  }
}

/** `true` quando há projeto configurado e sessão aberta. */
const cloudMode = () => supabase.isConfigured() && !!supabase.getSession();

export const lastSyncError = () => syncError;

export const syncState = () => ({
  mode: cloudMode() ? 'nuvem' : 'local',
  hydrated,
  pending: pendingCount(),
  error: syncError,
});

/*
 * No modo local o `localStorage` continua sendo a fonte de verdade lida a cada
 * chamada — é o comportamento que as telas (e os testes) já conhecem. O cache
 * em memória só assume depois de uma hidratação do servidor.
 */
const read = () => {
  if (hydrated && cache) return cache;
  return readLocal();
};

const write = (items) => {
  cache = items;
  store.set(KEY, items);
};

/* ---------- Fila de pendências ---------- */

const readQueue = () => {
  const raw = store.get(QUEUE_KEY, []);
  return Array.isArray(raw) ? raw : [];
};
const writeQueue = (queue) => store.set(QUEUE_KEY, queue);

export const pendingCount = () => (supabase.isConfigured() ? readQueue().length : 0);

/** Uma pendência por registro: a última operação vence. */
function enqueue(entry) {
  writeQueue([...readQueue().filter((e) => e.id !== entry.id), entry]);
}

async function sendEntry(entry) {
  const table = TABLES[entry.type];
  if (!table) return;
  if (entry.kind === 'remove') await supabase.remove(table, { eq: { id: entry.id } });
  else await supabase.upsert(table, [toRow(entry.item)], 'id');
}

/**
 * Dispara a escrita no servidor sem bloquear quem chamou.
 * Nunca rejeita: o erro vira pendência na fila e mensagem em `lastSyncError()`.
 */
function pushCloud(entry) {
  if (!cloudMode()) return;
  sendEntry(entry).then(
    () => {
      if (syncError) { syncError = ''; notify(); }
    },
    (error) => {
      syncError = error?.message || String(error);
      enqueue(entry);
      notify();
    },
  );
}

/** Reenvia as pendências. Devolve quantas continuam na fila. */
export async function flush() {
  if (!cloudMode()) return pendingCount();
  const queue = readQueue();
  if (!queue.length) return 0;

  const remaining = [];
  for (const entry of queue) {
    try { await sendEntry(entry); }
    catch (error) {
      syncError = error?.message || String(error);
      remaining.push(entry);
    }
  }
  writeQueue(remaining);
  if (!remaining.length) syncError = '';
  notify();
  return remaining.length;
}

/* ---------- Conversão de nomes (snake_case ↔ camelCase) ---------- */

function toRow(item) {
  const userId = supabase.sessionUser()?.id;
  // Sem usuário não há como satisfazer o RLS: melhor virar pendência.
  if (!userId) throw new Error('Sem usuário na sessão para gravar no Supabase.');

  const base = { id: item.id, user_id: userId, notes: String(item.notes || '') };

  if (item.type === 'filamento') {
    return {
      ...base,
      material: item.material,
      hex: item.hex,
      color_label: item.colorLabel,
      brand: item.brand,
      nickname: item.nickname,
      spools: item.spools,
      spool_weight: item.spoolWeight,
      spool_price: item.spoolPrice,
      remaining: item.remaining,
      density: item.density,
      name: item.name,
    };
  }

  if (item.type === 'insumo') {
    return {
      ...base,
      name: item.name,
      qty: item.qty,
      unit: item.unit,
      unit_price: item.unitPrice,
    };
  }

  return {
    ...base,
    name: item.name,
    qty: item.qty,
    unit: item.unit,
    cost: item.cost,
    price: item.price,
    weight: item.weight,
    print_hours: item.printHours,
    model_id: item.modelId || null,
  };
}

function fromRow(row, type) {
  const common = {
    id: row.id,
    type,
    notes: row.notes || '',
    createdAt: row.created_at || undefined,
  };

  let data;
  if (type === 'filamento') {
    data = {
      ...common,
      material: row.material,
      hex: row.hex,
      colorLabel: row.color_label,
      brand: row.brand,
      nickname: row.nickname,
      spools: row.spools,
      spoolWeight: row.spool_weight,
      spoolPrice: row.spool_price,
      remaining: row.remaining,
      density: row.density,
      name: row.name,
    };
  } else if (type === 'insumo') {
    data = {
      ...common,
      name: row.name,
      qty: row.qty,
      unit: row.unit,
      unitPrice: row.unit_price,
    };
  } else {
    data = {
      ...common,
      name: row.name,
      qty: row.qty,
      unit: row.unit,
      cost: row.cost,
      price: row.price,
      weight: row.weight,
      printHours: row.print_hours,
      modelId: row.model_id || '',
    };
  }

  const item = normalize(data);
  // `normalize` marca `updatedAt` como agora; o do servidor é mais fiel.
  if (row.updated_at) item.updatedAt = row.updated_at;
  return item;
}

/* ---------- Hidratação ---------- */

/**
 * Carrega o estoque da fonte certa. Segura para chamar várias vezes e nunca
 * lança: se a rede falhar, mantém o que havia no `localStorage` e registra o
 * motivo em `lastSyncError()`.
 */
export async function hydrate() {
  if (hydrating) return hydrating;

  hydrating = (async () => {
    if (!cloudMode()) {
      hydrated = false;
      cache = readLocal();
      notify();
      return list();
    }

    try {
      // As pendências vão antes, senão a leitura do servidor as sobrescreve.
      await flush();

      const [filamentRows, supplyRows, productRows] = await Promise.all([
        supabase.select('filaments'),
        supabase.select('supplies'),
        supabase.select('products'),
      ]);

      const items = [
        ...(filamentRows || []).map((row) => fromRow(row, 'filamento')),
        ...(supplyRows || []).map((row) => fromRow(row, 'insumo')),
        ...(productRows || []).map((row) => fromRow(row, 'produto')),
      ].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

      // Guarda o estoque puramente local uma única vez, para o logout voltar a ele.
      if (store.get(LOCAL_BACKUP_KEY, null) === null) store.set(LOCAL_BACKUP_KEY, readLocal());

      hydrated = true;
      syncError = '';
      write(items);
    } catch (error) {
      syncError = error?.message || String(error);
    }

    notify();
    return list();
  })().finally(() => { hydrating = null; });

  return hydrating;
}

/** Logout: descarta os dados do servidor e volta ao estoque local. */
function resetToLocal() {
  const backup = store.get(LOCAL_BACKUP_KEY, null);
  if (Array.isArray(backup)) {
    store.set(KEY, backup);
    store.remove(LOCAL_BACKUP_KEY);
  }
  hydrated = false;
  cache = readLocal();
  notify();
}

// Só observa a sessão quando o projeto existe: no modo local nada é registrado.
if (supabase.isConfigured()) {
  supabase.onAuthChange((session) => {
    if (session) hydrate();
    else resetToLocal();
  });
}

const num = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

export { num };

/* ---------- Leitura ---------- */

export function list(type) {
  const items = read();
  return type ? items.filter((item) => item.type === type) : items.slice();
}

export const filaments = () => list('filamento');
export const supplies = () => list('insumo');
export const products = () => list('produto');

export const getItem = (id) => read().find((item) => item.id === id) || null;

export function counts() {
  const items = read();
  return TYPES.reduce((acc, type) => {
    acc[type] = items.filter((item) => item.type === type).length;
    return acc;
  }, {});
}

/* ---------- Escrita ---------- */

function normalize(data) {
  const type = TYPES.includes(data.type) ? data.type : 'produto';
  const base = {
    id: data.id || crypto.randomUUID(),
    type,
    notes: String(data.notes || ''),
    updatedAt: new Date().toISOString(),
    createdAt: data.createdAt || new Date().toISOString(),
  };

  if (type === 'filamento') {
    const material = normalizeMaterial(data.material || data.ftype);
    const hex = /^#[0-9a-f]{6}$/i.test(data.hex || '') ? data.hex : '#ffffff';
    return {
      ...base,
      material,
      hex,
      colorLabel: String(data.colorLabel || colorName(hex)),
      brand: String(data.brand || ''),
      nickname: String(data.nickname || ''),
      spools: Math.max(0, num(data.spools)),
      spoolWeight: Math.max(1, num(data.spoolWeight) || 1000),
      spoolPrice: Math.max(0, num(data.spoolPrice)),
      remaining: Math.max(0, num(data.remaining)),
      density: num(data.density) || densityOf(material),
      name: String(data.nickname || `${data.colorLabel || colorName(hex)} ${material}`).trim(),
    };
  }

  if (type === 'insumo') {
    return {
      ...base,
      name: String(data.name || '').trim(),
      qty: num(data.qty),
      unit: String(data.unit || 'un'),
      unitPrice: num(data.unitPrice),
    };
  }

  return {
    ...base,
    name: String(data.name || '').trim(),
    qty: num(data.qty),
    unit: String(data.unit || 'un'),
    cost: num(data.cost),
    price: num(data.price),
    weight: num(data.weight),
    printHours: num(data.printHours),
    modelId: data.modelId || '',
  };
}

export function save(data) {
  const record = normalize(data);
  const items = read().slice();
  const index = items.findIndex((item) => item.id === record.id);
  if (index >= 0) items[index] = record;
  else items.unshift(record);
  write(items);
  pushCloud({ kind: 'save', id: record.id, type: record.type, item: record });
  return record;
}

export function remove(id) {
  const item = getItem(id);
  write(read().filter((entry) => entry.id !== id));
  if (item) pushCloud({ kind: 'remove', id, type: item.type });
}

/**
 * Desconta gramas do saldo de um filamento após uma impressão.
 *
 * O desconto sai de `available()`, não do campo `remaining` cru. Quem cadastra
 * um rolo deixa "saldo restante" em zero — é opcional — e o saldo real vem de
 * rolos × peso por rolo. Subtrair de zero dava `max(0, 0 - gramas) = 0`: o
 * estoque ficava intacto e a impressão não debitava nada, sem erro nenhum.
 *
 * Chegando a zero os rolos também zeram. Sem isso `available()` voltaria a
 * contar os rolos fechados e o saldo ressuscitaria no primeiro recarregamento.
 */
export function consume(id, grams) {
  const item = getItem(id);
  if (!item || item.type !== 'filamento') return null;

  const saida = Math.max(0, num(grams));
  if (!saida) return item;

  const saldo = Math.max(0, available(item) - saida);
  return save({ ...item, remaining: saldo, spools: saldo > 0 ? item.spools : 0 });
}

/* ---------- Derivados ---------- */

/** Preço por grama de um filamento. */
export const pricePerGram = (filament) =>
  filament && filament.spoolWeight > 0 ? filament.spoolPrice / filament.spoolWeight : 0;

/** Preço por quilo, para exibição. */
export const pricePerKg = (filament) => pricePerGram(filament) * 1000;

/** Gramas disponíveis: saldo informado, ou rolos fechados quando não houver. */
export function available(filament) {
  if (!filament) return 0;
  if (filament.remaining > 0) return filament.remaining;
  return filament.spools * filament.spoolWeight;
}

export const totalGrams = () => filaments().reduce((sum, f) => sum + available(f), 0);

export const inventoryValue = () =>
  filaments().reduce((sum, f) => sum + available(f) * pricePerGram(f), 0)
  + supplies().reduce((sum, s) => sum + s.qty * s.unitPrice, 0);

/* ---------- Correlação com o arquivo ---------- */

const hexToRgb = (hex) => {
  const value = String(hex || '').replace('#', '').slice(0, 6);
  if (value.length !== 6) return null;
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
};

/** Distância de cor simples, suficiente para casar swatches de filamento. */
function colorDistance(a, b) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return Infinity;
  return Math.sqrt((ra[0] - rb[0]) ** 2 + (ra[1] - rb[1]) ** 2 + (ra[2] - rb[2]) ** 2);
}

/**
 * Encontra no estoque o filamento mais próximo do que o arquivo declara.
 *
 * Pontua material igual acima de cor próxima: imprimir a cor errada é um
 * problema estético, o material errado não imprime. Devolve
 * `{ filament, score, exactMaterial, colorDelta }` ou `null`.
 */
export function matchFilament({ material, color }) {
  const pool = filaments();
  if (!pool.length) return null;

  const wanted = normalizeMaterial(material);
  let best = null;

  for (const filament of pool) {
    const exactMaterial = filament.material === wanted;
    const colorDelta = color ? colorDistance(filament.hex, color) : 0;
    // 441 é a distância máxima possível no cubo RGB.
    const colorScore = color ? 1 - Math.min(colorDelta, 441) / 441 : 0.5;
    const stockScore = available(filament) > 0 ? 1 : 0;
    const score = (exactMaterial ? 2 : 0) + colorScore + stockScore * 0.5;
    if (!best || score > best.score) best = { filament, score, exactMaterial, colorDelta };
  }

  return best;
}

/**
 * Casa a lista de filamentos de um arquivo com o estoque.
 * Devolve uma linha por filamento do arquivo, com a correspondência e o custo.
 */
export function matchUsage(usage = []) {
  return usage.map((entry) => {
    const match = matchFilament({ material: entry.material, color: entry.color });
    const filament = match?.filament || null;
    const grams = num(entry.grams);
    return {
      ...entry,
      grams,
      filament,
      exactMaterial: !!match?.exactMaterial,
      colorDelta: match?.colorDelta ?? null,
      pricePerGram: filament ? pricePerGram(filament) : 0,
      cost: filament ? grams * pricePerGram(filament) : 0,
      shortage: filament ? Math.max(0, grams - available(filament)) : grams,
    };
  });
}

export default {
  list, save, remove, filaments, supplies, products,
  hydrate, flush, pendingCount, syncState, lastSyncError, onInventoryChange,
};
