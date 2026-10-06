/*
 * Estoque local: filamentos, insumos e produtos.
 *
 * Mesmo modelo do projeto original (coleção única com campo `type`), mas
 * persistido no navegador, já que o site é estático. Filamento é o registro
 * central: é dele que sai o preço por grama usado no custo de fabricação.
 */

import store from './store.js';
import { densityOf, normalizeMaterial, colorName } from './filaments.js';

const KEY = 'inventory';
const TYPES = ['filamento', 'insumo', 'produto'];

const read = () => {
  const raw = store.get(KEY, []);
  return Array.isArray(raw) ? raw : [];
};
const write = (items) => store.set(KEY, items);

const num = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

export { num };

/* ---------- Leitura ---------- */

export function list(type) {
  const items = read();
  return type ? items.filter((item) => item.type === type) : items;
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
  const items = read();
  const index = items.findIndex((item) => item.id === record.id);
  if (index >= 0) items[index] = record;
  else items.unshift(record);
  write(items);
  return record;
}

export function remove(id) {
  write(read().filter((item) => item.id !== id));
}

/** Desconta gramas do saldo de um filamento após uma impressão. */
export function consume(id, grams) {
  const item = getItem(id);
  if (!item || item.type !== 'filamento') return null;
  return save({ ...item, remaining: Math.max(0, item.remaining - Math.max(0, num(grams))) });
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

export default { list, save, remove, filaments, supplies, products };
