/*
 * Metadados de fatiamento embutidos no 3MF.
 *
 * Um 3MF *fatiado* carrega o que mais importa para orçar: quantos gramas de
 * cada filamento a peça consome, quanto tempo leva e em que impressora foi
 * fatiada. Cada fatiador grava isso em um lugar diferente:
 *
 *  - Bambu Studio / Orca Slicer: `Metadata/slice_info.config` (XML) com um
 *    `<plate>` por mesa e um `<filament>` por bico, trazendo `used_g`,
 *    `used_m`, `type` e `color`; e `Metadata/project_settings.config` (JSON)
 *    com as cores e tipos configurados, além da matriz de purga.
 *  - PrusaSlicer: `Metadata/Slic3r_PE.config` (linhas `; chave = valor`), que
 *    traz as configurações, mas não o consumo — o consumo só existe no G-code.
 *
 * Quando não há nada disso (modelo não fatiado, o caso comum de um 3MF baixado
 * de um repositório), o peso é estimado pelo volume da malha em `parsers/index.js`.
 */

/** Normaliza `#RRGGBBAA`, `#RGB` ou `RRGGBB` para `#rrggbb`. */
export function normalizeHex(raw) {
  let value = String(raw || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(value)) value = value.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{8}$/i.test(value)) value = value.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(value)) return '';
  return `#${value.toLowerCase()}`;
}

const toNumber = (raw) => {
  const n = parseFloat(String(raw ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Pares `<metadata key=".." value=".."/>` de um nó, como objeto. */
function metadataMap(node) {
  const out = {};
  for (const meta of node.getElementsByTagNameNS('*', 'metadata')) {
    const key = meta.getAttribute('key') || meta.getAttribute('name');
    if (key) out[key] = meta.getAttribute('value') ?? meta.textContent ?? '';
  }
  return out;
}

async function readText(zip, name) {
  const entry = zip.find((e) => e.name.replace(/^\/+/, '').toLowerCase() === name.toLowerCase());
  if (!entry) return null;
  try { return await zip.readEntryText(entry); } catch { return null; }
}

/* ---------- Bambu Studio / Orca Slicer ---------- */

async function readBambuSliceInfo(zip) {
  const xml = await readText(zip, 'Metadata/slice_info.config');
  if (!xml) return null;

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror')[0]) return null;

  const header = metadataMap(doc.getElementsByTagNameNS('*', 'header')[0] || doc.documentElement);
  const plates = [];

  for (const plateNode of doc.getElementsByTagNameNS('*', 'plate')) {
    const meta = metadataMap(plateNode);
    const filaments = Array.from(plateNode.getElementsByTagNameNS('*', 'filament')).map((node) => ({
      id: node.getAttribute('id') || '',
      material: node.getAttribute('type') || '',
      color: normalizeHex(node.getAttribute('color')),
      grams: toNumber(node.getAttribute('used_g')),
      meters: toNumber(node.getAttribute('used_m')),
      trayId: node.getAttribute('tray_info_idx') || '',
    })).filter((f) => f.id || f.grams);

    plates.push({
      index: Number(meta.index) || plates.length + 1,
      printerModelId: meta.printer_model_id || '',
      nozzle: meta.nozzle_diameters || '',
      seconds: toNumber(meta.prediction),
      grams: toNumber(meta.weight),
      supportUsed: meta.support_used === 'true',
      outside: meta.outside === 'true',
      filaments,
    });
  }

  if (!plates.length) return null;
  return {
    slicer: (header['X-BBL-Client-Type'] ? 'Bambu Studio / Orca' : 'Bambu Studio / Orca'),
    version: header['X-BBL-Client-Version'] || '',
    plates,
  };
}

/** Cores e tipos configurados, mais a purga declarada pelo perfil. */
async function readBambuProjectSettings(zip) {
  const text = await readText(zip, 'Metadata/project_settings.config');
  if (!text) return null;
  let json;
  try { json = JSON.parse(text); } catch { return null; }

  const asArray = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
  return {
    printerModel: json.printer_model || json.printer_settings_id || '',
    nozzle: asArray(json.nozzle_diameter)[0] || '',
    colors: asArray(json.filament_colour).map(normalizeHex),
    materials: asArray(json.filament_type),
    names: asArray(json.filament_settings_id),
    /** Matriz de purga em mm³: [de][para] linearizada. */
    flushMatrix: asArray(json.flush_volumes_matrix).map(toNumber),
    flushMultiplier: toNumber(json.flush_multiplier) || 1,
    layerHeight: asArray(json.layer_height)[0] || '',
    infill: asArray(json.sparse_infill_density)[0] || '',
  };
}

/**
 * Mapa de extrusora por objeto, lido de `Metadata/model_settings.config`.
 *
 * É o que permite colorir a peça: o `.model` só traz geometria, e a associação
 * entre cada parte e o bico (logo, a cor) vive neste arquivo à parte.
 */
async function readBambuModelSettings(zip) {
  const xml = await readText(zip, 'Metadata/model_settings.config');
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror')[0]) return null;

  // Prato de cada objeto. Um projeto do Bambu guarda varias mesas no mesmo
  // arquivo, e cada mesa e uma impressao separada: o G-code fatia uma por vez.
  const plateOfObject = new Map();
  const plateIds = [];
  for (const plateNode of doc.getElementsByTagNameNS('*', 'plate')) {
    const meta = metadataMap(plateNode);
    const plateId = Number(meta.plater_id || meta.plate_id || 0);
    if (!Number.isFinite(plateId) || plateId <= 0) continue;
    plateIds.push(plateId);
    for (const inst of plateNode.getElementsByTagNameNS('*', 'model_instance')) {
      const objectId = metadataMap(inst).object_id;
      if (objectId) plateOfObject.set(String(objectId), plateId);
    }
  }

  const byObjectId = new Map();
  for (const objectNode of doc.getElementsByTagNameNS('*', 'object')) {
    const objectId = objectNode.getAttribute('id');
    const objectMeta = metadataMap(objectNode);
    if (objectId && objectMeta.extruder) byObjectId.set(String(objectId), Number(objectMeta.extruder));

    for (const partNode of objectNode.getElementsByTagNameNS('*', 'part')) {
      const partId = partNode.getAttribute('id');
      const partMeta = metadataMap(partNode);
      const extruder = Number(partMeta.extruder || objectMeta.extruder);
      if (partId && Number.isFinite(extruder) && extruder > 0) {
        byObjectId.set(String(partId), extruder);
      }
      // A peca herda o prato do objeto que a contem.
      const plate = plateOfObject.get(String(objectId));
      if (partId && plate) plateOfObject.set(String(partId), plate);
    }
  }
  if (!byObjectId.size && !plateOfObject.size) return null;
  return {
    extruderByObject: byObjectId.size ? byObjectId : null,
    plateOfObject: plateOfObject.size ? plateOfObject : null,
    plateIds: [...new Set(plateIds)].sort((a, b) => a - b),
  };
}

/* ---------- PrusaSlicer ---------- */

async function readPrusaConfig(zip) {
  const text = await readText(zip, 'Metadata/Slic3r_PE.config');
  if (!text) return null;

  const config = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^;?\s*([a-z0-9_]+)\s*=\s*(.*)$/i);
    if (match) config[match[1]] = match[2].trim();
  }
  if (!Object.keys(config).length) return null;

  const split = (value) => String(value || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  return {
    slicer: 'PrusaSlicer',
    printerModel: config.printer_model || '',
    colors: split(config.filament_colour).map(normalizeHex),
    materials: split(config.filament_type),
    layerHeight: config.layer_height || '',
    infill: config.fill_density || '',
    /** PrusaSlicer grava o consumo apenas no G-code, não no 3MF. */
    grams: 0,
  };
}

/* ---------- Purga ---------- */

/**
 * Estima a purga de uma impressão multicor.
 *
 * A matriz de purga do perfil diz quantos mm³ são descartados em cada troca
 * de cor. Sem saber o número real de trocas (isso está no G-code), usa-se a
 * média da matriz vezes o número de trocas mínimo para alternar entre todas as
 * cores uma vez por camada de interface — uma aproximação deliberadamente
 * conservadora, declarada como estimativa na interface.
 */
export function estimatePurge({ flushMatrix = [], flushMultiplier = 1, filamentCount = 1, density = 1.24, changes = 0 }) {
  if (filamentCount < 2) return { grams: 0, estimated: false, changes: 0 };

  const positive = flushMatrix.filter((v) => v > 0);
  const averageVolume = positive.length
    ? (positive.reduce((a, b) => a + b, 0) / positive.length) * (flushMultiplier || 1)
    : 280; // mm³ por troca, valor típico de perfil AMS quando a matriz não vem no arquivo

  const transitions = changes > 0 ? changes : (filamentCount - 1) * 2;
  const mm3 = averageVolume * transitions;
  return {
    grams: (mm3 / 1000) * density,
    estimated: true,
    changes: transitions,
    mm3PerChange: averageVolume,
  };
}

/* ---------- Entrada ---------- */

/**
 * Lê tudo o que o pacote souber dizer sobre o fatiamento.
 *
 * Devolve sempre o mesmo formato, com `sliced: false` quando o arquivo é só
 * geometria:
 * `{ sliced, slicer, version, printerModel, nozzle, layerHeight, infill,
 *    seconds, grams, filaments[], purge, extruderByObject, plateCount }`
 */
export async function readSliceInfo(zip) {
  const empty = {
    sliced: false,
    slicer: '',
    version: '',
    printerModel: '',
    nozzle: '',
    layerHeight: '',
    infill: '',
    seconds: 0,
    grams: 0,
    filaments: [],
    purge: { grams: 0, estimated: false, changes: 0 },
    extruderByObject: null,
    plateOfObject: null,
    plateIds: [],
    plateCount: 0,
    slicedPlateCount: 0,
    slicedPlateIds: [],
    measuredPlateId: 0,
  };

  const [bambu, project, settings, prusa] = await Promise.all([
    readBambuSliceInfo(zip).catch(() => null),
    readBambuProjectSettings(zip).catch(() => null),
    readBambuModelSettings(zip).catch(() => null),
    readPrusaConfig(zip).catch(() => null),
  ]);

  const modelSettings = settings?.extruderByObject || null;
  const plateOfObject = settings?.plateOfObject || null;
  const plateIds = settings?.plateIds || [];

  // Cores do perfil servem de reserva quando o slice_info não traz a cor.
  const profileColors = project?.colors || prusa?.colors || [];
  const profileMaterials = project?.materials || prusa?.materials || [];

  if (bambu) {
    // A mesa de maior consumo é a representativa do arquivo.
    const plate = bambu.plates.slice().sort((a, b) => b.grams - a.grams)[0];
    const filaments = plate.filaments.map((f, i) => {
      const slot = Number(f.id) - 1;
      return {
        ...f,
        slot: Number.isFinite(slot) && slot >= 0 ? slot : i,
        color: f.color || profileColors[Number(f.id) - 1] || '',
        material: f.material || profileMaterials[Number(f.id) - 1] || '',
      };
    });

    const grams = plate.grams || filaments.reduce((sum, f) => sum + f.grams, 0);
    return {
      ...empty,
      sliced: true,
      slicer: bambu.slicer,
      version: bambu.version,
      printerModel: project?.printerModel || plate.printerModelId || '',
      nozzle: plate.nozzle || project?.nozzle || '',
      layerHeight: project?.layerHeight || '',
      infill: project?.infill || '',
      seconds: plate.seconds,
      grams,
      filaments,
      purge: estimatePurge({
        flushMatrix: project?.flushMatrix,
        flushMultiplier: project?.flushMultiplier,
        filamentCount: filaments.length,
      }),
      extruderByObject: modelSettings,
      plateOfObject,
      plateIds,
      // O fatiamento cobre a mesa representativa; o projeto pode ter outras.
      plateCount: Math.max(bambu.plates.length, plateIds.length),
      slicedPlateCount: bambu.plates.length,
      /** Mesa a que o peso medido se refere, para não atribuí-lo a outra. */
      slicedPlateIds: bambu.plates.map((pl) => Number(pl.index) || 0).filter(Boolean),
      measuredPlateId: Number(plate.index) || 0,
    };
  }

  if (project || prusa) {
    const source = project || prusa;
    const filaments = profileColors.map((color, i) => ({
      id: String(i + 1),
      slot: i,
      color,
      material: profileMaterials[i] || '',
      grams: 0,
      meters: 0,
    }));
    return {
      ...empty,
      sliced: false,
      slicer: prusa?.slicer || 'Bambu Studio / Orca',
      printerModel: source.printerModel || '',
      nozzle: source.nozzle || '',
      layerHeight: source.layerHeight || '',
      infill: source.infill || '',
      filaments,
      extruderByObject: modelSettings,
      plateOfObject,
      plateIds,
      plateCount: plateIds.length,
    };
  }

  return { ...empty, extruderByObject: modelSettings, plateOfObject, plateIds,
    plateCount: plateIds.length };
}

export default readSliceInfo;
