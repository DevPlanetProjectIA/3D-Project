/*
 * Motor de custo e preço.
 *
 * A fórmula é a mesma da calculadora do projeto original, preservada campo a
 * campo para que os números batam com o que já era usado:
 *
 *   material      = (preço do quilo ÷ 1000) × gramas
 *   energia       = (watts ÷ 1000) × horas × preço do kWh
 *   máquina       = (valor da impressora ÷ vida útil em horas) × horas
 *   risco         = (material + energia + máquina) × taxa de falha
 *   custoProdução = material + energia + máquina + consumíveis + risco
 *   lucroMarkup   = custoProdução × markup
 *   mãoDeObra     = (minutos de pós-processamento ÷ 60) × valor hora
 *   artePintura   = horas de pintura × valor hora artística
 *   líquido       = custoProdução + lucroMarkup + mãoDeObra + artePintura
 *   bruto         = (líquido + taxa fixa) ÷ (1 − comissão)
 *
 * O markup incide apenas sobre a produção; mão de obra e pintura entram depois,
 * sem multiplicar. A comissão do marketplace é embutida no preço final (preço
 * de venda tal que, após a taxa, sobre o líquido desejado).
 */

import store from './store.js';
import { num } from './inventory.js';

const SETTINGS_KEY = 'costSettings';

/** Taxas dos canais de venda: [rótulo, comissão %, taxa fixa]. */
export const CHANNELS = [
  { id: 'direto', label: 'Venda direta / PIX (sem taxa)', commission: 0, fixedFee: 0 },
  { id: 'shopee', label: 'Shopee padrão (14% + R$ 3)', commission: 14, fixedFee: 3 },
  { id: 'shopee_fg', label: 'Shopee frete grátis (20% + R$ 3)', commission: 20, fixedFee: 3 },
  { id: 'ml_classico', label: 'Mercado Livre clássico (13% + R$ 6)', commission: 13, fixedFee: 6 },
  { id: 'ml_premium', label: 'Mercado Livre premium (18% + R$ 6)', commission: 18, fixedFee: 6 },
  { id: 'elo7', label: 'Elo7 (12%)', commission: 12, fixedFee: 0 },
  { id: 'custom', label: 'Personalizado', commission: 0, fixedFee: 0 },
];

export const getChannel = (id) => CHANNELS.find((c) => c.id === id) || CHANNELS[0];

/** Padrões do estúdio, editáveis em Configurações. */
export const DEFAULTS = {
  currency: 'BRL',
  kwhPrice: 0.92,
  watts: 150,
  laborRate: 30,
  artRate: 35,
  markup: 100,
  machineDepreciation: false,
  printerValue: 3500,
  printerLife: 3000,
  failureEnabled: true,
  failureRate: 10,
  /** Purga/troca de cor: percentual aplicado sobre o material em impressões multicor. */
  purgeRate: 12,
  postMinutes: 10,
  channel: 'direto',
  studioName: '',
  pix: '',
  phone: '',
};

export function getSettings() {
  return { ...DEFAULTS, ...(store.get(SETTINGS_KEY, {}) || {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  store.set(SETTINGS_KEY, next);
  return next;
}

export const formatMoney = (value, currency = getSettings().currency) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' })
    .format(Number.isFinite(value) ? value : 0);

export function formatHours(hours) {
  const total = Math.max(0, Math.round(num(hours) * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

/**
 * Calcula custo e preço.
 *
 * `input.materialCost` permite informar o custo de material já apurado
 * (soma por filamento vinda do estoque). Quando ausente, cai para
 * `pricePerKg × grams`.
 */
export function compute(input = {}) {
  const settings = getSettings();
  const cfg = { ...settings, ...input };

  const hours = num(cfg.hours) + num(cfg.minutes) / 60;
  const grams = num(cfg.grams);

  const materialBase = cfg.materialCost !== undefined && cfg.materialCost !== null
    ? num(cfg.materialCost)
    : (num(cfg.pricePerKg) / 1000) * grams;

  // Purga e troca de cor só existem a partir do segundo filamento.
  const purgeRate = num(cfg.purgeGrams) > 0 ? 0 : (num(cfg.filamentCount) > 1 ? num(cfg.purgeRate) : 0);
  const purgeFromRate = materialBase * (purgeRate / 100);
  const purgeFromGrams = num(cfg.purgeGrams) * (num(cfg.purgePricePerGram) || (materialBase && grams ? materialBase / grams : 0));
  const purge = purgeFromGrams || purgeFromRate;

  const material = materialBase + purge;
  const energy = (num(cfg.watts) / 1000) * hours * num(cfg.kwhPrice);
  const machine = cfg.machineDepreciation && num(cfg.printerLife) > 0
    ? (num(cfg.printerValue) / num(cfg.printerLife)) * hours
    : 0;

  const suppliesList = (cfg.supplies || []).reduce((sum, item) => sum + num(item.value ?? item.cost), 0);
  const risk = cfg.failureEnabled ? (material + energy + machine) * (num(cfg.failureRate) / 100) : 0;
  const suppliesAndRisk = suppliesList + risk;

  const production = material + energy + machine + suppliesAndRisk;
  const markupProfit = production * (num(cfg.markup) / 100);
  const labor = (num(cfg.postMinutes) / 60) * num(cfg.laborRate);
  const art = (num(cfg.artHours) + num(cfg.artMinutes) / 60) * num(cfg.artRate);

  const net = production + markupProfit + labor + art;

  const channel = cfg.channelOverride || getChannel(cfg.channel);
  const commission = Math.min(num(cfg.commission ?? channel.commission), 95);
  const fixedFee = num(cfg.fixedFee ?? channel.fixedFee);
  const hasFee = commission > 0 || fixedFee > 0;
  const gross = hasFee ? (net + fixedFee) / (1 - commission / 100) : net;
  const channelFee = gross - net;

  return {
    hours,
    grams,
    materialBase,
    purge,
    material,
    energy,
    machine,
    supplies: suppliesList,
    risk,
    suppliesAndRisk,
    production,
    markupProfit,
    labor,
    art,
    net,
    channelFee,
    hasFee,
    price: gross,
    profit: markupProfit + labor + art,
    /** Custo total desembolsado, sem lucro. */
    cost: production,
    margin: gross > 0 ? (gross - production - channelFee) / gross : 0,
  };
}

/** Partes do custo para o gráfico de composição. */
export function breakdown(result) {
  return [
    { label: 'Material', value: result.materialBase, color: '#3b82f6' },
    { label: 'Purga/troca', value: result.purge, color: '#0ea5e9' },
    { label: 'Energia', value: result.energy, color: '#06b6d4' },
    { label: 'Máquina', value: result.machine, color: '#a855f7' },
    { label: 'Consumíveis/risco', value: result.suppliesAndRisk, color: '#94a3b8' },
    { label: 'Mão de obra', value: result.labor, color: '#8b5cf6' },
    { label: 'Arte/pintura', value: result.art, color: '#ec4899' },
    { label: 'Lucro', value: result.markupProfit, color: '#22c55e' },
    { label: 'Taxa do canal', value: result.channelFee, color: '#f97316' },
  ].filter((part) => part.value > 0.0001);
}

/** Preços de referência da calculadora simples. */
export function quickPrices(pricePerKg, grams, handPainted = false) {
  const base = (num(pricePerKg) / 1000) * num(grams);
  return {
    base,
    retail: base * 3,
    consumer: base * 5,
    custom: base * (handPainted ? 20 : 10),
  };
}

export default compute;
