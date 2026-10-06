/*
 * Análise de produção de um arquivo.
 *
 * Junta o que o arquivo informa (gramas por filamento, tempo, purga) com o que
 * o estoque sabe (preço por grama, saldo) e devolve um resumo pronto para a
 * interface e para o motor de custo.
 *
 * A distinção que importa: dados vindos de um 3MF fatiado são **medidos** pelo
 * fatiador; os de um STL ou de um 3MF só com geometria são **estimados** a
 * partir do volume da malha. A interface precisa dizer qual é qual, porque
 * orçar sobre estimativa é outro nível de risco.
 */

import { measure, volumeOf, surfaceAreaOf, estimateWeight } from './parsers/index.js';
import { densityOf, normalizeMaterial, colorName } from './filaments.js';
import { matchUsage, available, pricePerGram, consume, num } from './inventory.js';
import { compute, getSettings } from './costing.js';
import { getPrinter } from './printers.js';

/**
 * Monta a análise.
 *
 * @param {object} geometry saída de `parseModel`
 * @param {object} opts `{ printerId, infillPercent, material, hours, minutes }`
 */
export function analyze(geometry, opts = {}) {
  const settings = getSettings();
  const metrics = measure(geometry);
  // `opts.slice` permite injetar o fatiamento vindo de um G-code enviado à
  // parte, que é mais preciso que o embutido no 3MF: inclui a purga real.
  const bruto = opts.slice || geometry.slice || null;
  // `excludeSlots` deixa a tela tirar um filamento do projeto à mão. A lista do
  // arquivo descreve o que está carregado na impressora; só quem está olhando a
  // peça sabe se um slot realmente entra nela.
  const excluidos = new Set((opts.excludeSlots || []).map(Number));
  const slice = bruto && excluidos.size && bruto.filaments?.length
    ? { ...bruto, filaments: bruto.filaments.filter((f) => !excluidos.has(Number(f.slot))) }
    : bruto;
  const sliced = !!slice?.sliced;

  /* ---------- Filamentos e gramas ---------- */

  let usage;
  let source;
  let estimate = null;

  if (sliced && slice.filaments.length) {
    source = slice.source === 'gcode' ? 'gcode' : 'fatiador';
    usage = slice.filaments.map((f) => ({
      slot: f.slot,
      material: normalizeMaterial(f.material),
      rawMaterial: f.material,
      color: f.color || '',
      colorLabel: f.color ? colorName(f.color) : '',
      grams: f.grams,
      meters: f.meters,
      measured: true,
    }));
  } else {
    source = 'estimativa';
    const volumeMm3 = volumeOf(geometry);
    const areaMm2 = surfaceAreaOf(geometry);
    const material = normalizeMaterial(opts.material || slice?.filaments?.[0]?.material || 'PLA');
    const infillPercent = num(opts.infillPercent) || num(slice?.infill) || 20;
    estimate = estimateWeight({
      volumeMm3,
      areaMm2,
      boxVolumeMm3: metrics.boxVolume,
      density: densityOf(material),
      infillPercent,
      wallThickness: num(opts.wallThickness) || 0.8,
    });
    // Cores do perfil sem consumo ainda ajudam: distribui o peso igualmente.
    const slots = slice?.filaments?.length || 1;
    usage = Array.from({ length: slots }, (_, i) => ({
      slot: slice?.filaments?.[i]?.slot ?? i,
      material,
      rawMaterial: slice?.filaments?.[i]?.material || material,
      color: slice?.filaments?.[i]?.color || (geometry.palette || [])[i] || '',
      colorLabel: '',
      grams: estimate.grams / slots,
      meters: 0,
      measured: false,
    }));
    usage.forEach((u) => { u.colorLabel = u.color ? colorName(u.color) : ''; });
  }

  const filamentCount = usage.filter((u) => u.grams > 0.01).length || usage.length;

  /* ---------- Purga ---------- */

  const purgeFromFile = sliced ? slice.purge : { grams: 0, estimated: true, changes: 0 };
  const purgeGrams = filamentCount > 1 ? purgeFromFile.grams : 0;

  /* ---------- Correlação com o estoque ---------- */

  const matched = matchUsage(usage);
  const missing = matched.filter((row) => !row.filament);
  const shortages = matched.filter((row) => row.filament && row.shortage > 0);
  const wrongMaterial = matched.filter((row) => row.filament && !row.exactMaterial);

  const partsGrams = matched.reduce((sum, row) => sum + row.grams, 0);
  const materialCost = matched.reduce((sum, row) => sum + row.cost, 0);

  // Purga sai do filamento mais caro envolvido na troca: é o pior caso real.
  const purgePricePerGram = matched
    .filter((row) => row.filament)
    .reduce((max, row) => Math.max(max, pricePerGram(row.filament)), 0);
  const purgeCost = purgeGrams * purgePricePerGram;

  const totalGrams = partsGrams + purgeGrams;

  /* ---------- Tempo ---------- */

  const secondsFromFile = sliced ? slice.seconds : 0;
  const hours = num(opts.hours) || (secondsFromFile ? secondsFromFile / 3600 : 0);
  const minutes = num(opts.minutes);

  /* ---------- Impressora ---------- */

  const printer = getPrinter(opts.printerId) || null;
  const watts = printer?.watts || settings.watts;

  /* ---------- Custo ---------- */

  const costInput = {
    grams: totalGrams,
    materialCost: materialCost + purgeCost,
    filamentCount,
    hours,
    minutes,
    watts,
    purgeGrams: 0,
    ...(printer && settings.machineDepreciation
      ? { printerValue: printer.price, printerLife: settings.printerLife }
      : {}),
    ...(opts.cost || {}),
  };
  const cost = compute(costInput);

  // Preenchimento vem como "15%" do fatiador e como 15 do formulário: a
  // interface precisa de um número, para não imprimir "15%%".
  const infillRaw = slice?.infill ?? opts.infillPercent ?? 20;
  const infillPercent = num(String(infillRaw).replace('%', '')) || 20;

  return {
    source,
    /** `true` quando peso e tempo foram medidos, não estimados. */
    measured: source !== 'estimativa',
    sliced,
    slicer: slice?.slicer || '',
    printerFromFile: slice?.printerModel || '',
    nozzle: slice?.nozzle || '',
    layerHeight: slice?.layerHeight || '',
    infill: infillPercent,
    plateCount: slice?.plateCount || 0,

    metrics,
    volumeCm3: estimate ? estimate.volumeCm3 : volumeOf(geometry) / 1000,
    estimateReliable: estimate ? estimate.reliable : true,
    /** Quanto do volume vira material, segundo o modelo de casca e núcleo. */
    solidRatio: estimate ? estimate.solidRatio : 1,
    shellCm3: estimate ? estimate.shellCm3 : 0,

    usage: matched,
    filamentCount,
    partsGrams,
    purgeGrams,
    purgeChanges: purgeFromFile.changes,
    purgeEstimated: !sliced || purgeFromFile.estimated,
    purgeCost,
    totalGrams,
    materialCost: materialCost + purgeCost,

    seconds: secondsFromFile,
    hours: hours + minutes / 60,

    printer,
    cost,

    /** Filamentos do arquivo, antes de qualquer exclusão da tela. */
    declaredFilaments: (bruto?.filaments || []).map((f) => ({
      slot: Number(f.slot),
      material: normalizeMaterial(f.material),
      color: f.color || '',
      grams: f.grams || 0,
    })),
    excludedSlots: [...excluidos],

    /** Pendências que impedem um custo confiável. */
    blockers: {
      noFilamentRegistered: matched.length > 0 && matched.every((row) => !row.filament),
      missing,
      shortages,
      wrongMaterial,
    },
  };
}

/**
 * Projeta uma impressão sem tocar no estoque: quanto sai de cada rolo.
 *
 * O rateio da purga segue a proporção de gramas de cada filamento, porque a
 * troca de cor descarta material dos dois lados e cobrar tudo de um só
 * distorceria o saldo.
 *
 * Serve para a tela mostrar o débito antes de confirmar.
 */
export function planPrint(analysis, { copies = 1 } = {}) {
  const vezes = Math.max(1, Math.floor(num(copies)) || 1);

  const comEstoque = (analysis.usage || []).filter((row) => row.filament);
  if (!comEstoque.length) {
    return {
      ok: false,
      copies: vezes,
      linhas: [],
      semSaldo: [],
      totalGrams: 0,
      custo: 0,
      error: 'Nenhum filamento desta peça está cadastrado no estoque.',
    };
  }

  const totalPecas = comEstoque.reduce((sum, row) => sum + row.grams, 0);
  const linhas = comEstoque.map((row) => {
    const purga = totalPecas > 0 ? analysis.purgeGrams * (row.grams / totalPecas) : 0;
    const gramas = (row.grams + purga) * vezes;
    const disponivel = available(row.filament);
    return {
      filament: row.filament,
      material: row.material,
      color: row.color,
      grams: gramas,
      purgeShare: purga * vezes,
      disponivel,
      falta: Math.max(0, gramas - disponivel),
      custo: gramas * pricePerGram(row.filament),
    };
  });

  const semSaldo = linhas.filter((l) => l.falta > 0.01);
  return {
    ok: !semSaldo.length,
    copies: vezes,
    linhas,
    semSaldo,
    totalGrams: linhas.reduce((sum, l) => sum + l.grams, 0),
    custo: linhas.reduce((sum, l) => sum + l.custo, 0),
    error: semSaldo.length
      ? `Saldo insuficiente em ${semSaldo.map((l) => l.filament.name).join(', ')}.`
      : '',
  };
}

/**
 * Registra a impressão: desconta do estoque o que a peça consome.
 *
 * Nada é descontado pela metade: se faltar saldo, recusa antes de mexer em
 * qualquer registro, a menos que `force`. Um estoque meio debitado é pior que
 * nenhum.
 */
export function registerPrint(analysis, { copies = 1, force = false } = {}) {
  const plano = planPrint(analysis, { copies });
  if (!plano.linhas.length) return { ...plano, ok: false };
  if (!plano.ok && !force) return plano;

  for (const linha of plano.linhas) consume(linha.filament.id, linha.grams);

  return { ...plano, ok: true, forced: !plano.ok };
}

/** Resumo de uma linha para gravar no catálogo, sem objetos pesados. */
export function toCatalogFields(analysis) {
  return {
    printerId: analysis.printer?.id || '',
    weightGrams: Number(analysis.totalGrams.toFixed(2)),
    purgeGrams: Number(analysis.purgeGrams.toFixed(2)),
    printSeconds: Math.round(analysis.seconds || analysis.hours * 3600),
    costBRL: Number(analysis.cost.production.toFixed(2)),
    priceBRL: Number(analysis.cost.price.toFixed(2)),
    weightSource: analysis.source,
    filaments: analysis.usage.map((row) => ({
      material: row.material,
      color: row.color,
      grams: Number(row.grams.toFixed(2)),
    })),
  };
}

export default analyze;
