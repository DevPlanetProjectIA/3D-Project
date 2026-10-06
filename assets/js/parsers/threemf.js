/*
 * Leitor de 3MF (3D Manufacturing Format).
 *
 * Um .3mf é um container OPC (ZIP). O modelo principal costuma ser
 * `3D/3dmodel.model`, mas a forma como a geometria é guardada varia bastante
 * entre fatiadores, e este leitor cobre os três casos encontrados na prática:
 *
 *  1. Malha dentro do próprio `3dmodel.model` (PrusaSlicer simples, Cura).
 *  2. Malha em partes externas `3D/Objects/*.model`, referenciadas pelo
 *     atributo `path` da extensão de produção (Bambu Studio, Orca Slicer e
 *     PrusaSlicer com vários objetos). Sem seguir essas referências, o modelo
 *     principal contém apenas componentes e nenhuma geometria.
 *  3. Elementos do core com prefixo de namespace (`<m:object>`), o que torna
 *     a busca por nome qualificado inútil.
 *
 * Por isso toda consulta a elementos e atributos é feita por nome local,
 * ignorando prefixos e namespaces.
 */

import { openZip } from './zip.js';
import { readSliceInfo, normalizeHex } from './sliceinfo.js';

/** Fatores de conversão para milímetro, conforme o atributo `unit` do modelo. */
const UNIT_TO_MM = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

const MAX_DEPTH = 24;

/* ---------- Acesso ao XML, imune a prefixos ---------- */

/** Descendentes com este nome local, em qualquer namespace. */
const els = (root, local) => Array.from(root.getElementsByTagNameNS('*', local));

/** Primeiro descendente com este nome local. */
const el = (root, local) => root.getElementsByTagNameNS('*', local)[0] || null;

/** Atributo por nome local: resolve tanto `path` quanto `p:path`. */
function attr(node, local) {
  const direct = node.getAttribute(local);
  if (direct !== null) return direct;
  for (const candidate of node.attributes) {
    if (candidate.localName === local) return candidate.value;
  }
  return null;
}

/* ---------- Caminhos e partes ---------- */

/** Caminhos da extensão de produção são absolutos no pacote: `/3D/Objects/a.model`. */
const normalizePath = (path) => String(path || '').replace(/^\/+/, '');

/** Carrega e interpreta uma parte XML do pacote, com cache por caminho. */
async function loadPart(zip, path, cache) {
  const key = normalizePath(path).toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  const entry = zip.find((candidate) => normalizePath(candidate.name).toLowerCase() === key);
  let doc = null;
  if (entry) {
    try {
      const xml = await zip.readEntryText(entry);
      const parsed = new DOMParser().parseFromString(xml, 'application/xml');
      doc = parsed.getElementsByTagName('parsererror')[0] ? null : parsed;
    } catch {
      doc = null;
    }
  }
  cache.set(key, doc);
  return doc;
}

/** Descobre a parte principal via `_rels/.rels`, com fallback por convenção. */
async function locateModelPart(zip) {
  try {
    const relsText = await zip.text('_rels/.rels');
    const doc = new DOMParser().parseFromString(relsText, 'application/xml');
    for (const rel of els(doc, 'Relationship')) {
      const type = (attr(rel, 'Type') || '').toLowerCase();
      const target = normalizePath(attr(rel, 'Target'));
      if (type.endsWith('3dmodel') && target) return target;
    }
  } catch {
    // Sem .rels legível: cai no fallback por convenção.
  }

  const byConvention = zip.find((e) => /^3d\/3dmodel\.model$/i.test(normalizePath(e.name)))
    || zip.find((e) => /\.model$/i.test(e.name));
  if (!byConvention) throw new Error('Nenhuma parte de modelo (.model) encontrada dentro do 3MF.');
  return normalizePath(byConvention.name);
}

/* ---------- Transformações ---------- */

function parseTransform(value) {
  if (!value) return null;
  const nums = String(value).trim().split(/\s+/).map(Number);
  if (nums.length < 12 || nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

/** Compõe duas transformações 3MF (vetores-linha, 12 valores). */
function composeTransform(inner, outer) {
  if (!outer) return inner;
  if (!inner) return outer;
  const out = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = inner[r * 3] * outer[c]
        + inner[r * 3 + 1] * outer[3 + c]
        + inner[r * 3 + 2] * outer[6 + c];
    }
  }
  for (let c = 0; c < 3; c++) {
    out[9 + c] = inner[9] * outer[c]
      + inner[10] * outer[3 + c]
      + inner[11] * outer[6 + c]
      + outer[9 + c];
  }
  return out;
}

function applyTransform(t, x, y, z) {
  if (!t) return [x, y, z];
  return [
    x * t[0] + y * t[3] + z * t[6] + t[9],
    x * t[1] + y * t[4] + z * t[7] + t[10],
    x * t[2] + y * t[5] + z * t[8] + t[11],
  ];
}

/* ---------- Leitura de objetos ---------- */

function readMesh(objectNode) {
  const meshNode = el(objectNode, 'mesh');
  if (!meshNode) return null;

  const vertexNodes = els(meshNode, 'vertex');
  const triangleNodes = els(meshNode, 'triangle');
  if (!vertexNodes.length || !triangleNodes.length) return null;

  const vertices = new Float64Array(vertexNodes.length * 3);
  for (let i = 0; i < vertexNodes.length; i++) {
    const node = vertexNodes[i];
    vertices[i * 3] = Number(attr(node, 'x')) || 0;
    vertices[i * 3 + 1] = Number(attr(node, 'y')) || 0;
    vertices[i * 3 + 2] = Number(attr(node, 'z')) || 0;
  }

  const indices = new Uint32Array(triangleNodes.length * 3);
  // Material por triangulo: `pid` identifica o grupo e `p1` o indice dentro
  // dele. E assim que um 3MF multimaterial pinta faces individuais.
  const triPid = new Array(triangleNodes.length);
  const triIndex = new Int32Array(triangleNodes.length);
  let kept = 0;
  let hasTriangleMaterial = false;

  for (const node of triangleNodes) {
    const v1 = Number(attr(node, 'v1'));
    const v2 = Number(attr(node, 'v2'));
    const v3 = Number(attr(node, 'v3'));
    const limit = vertexNodes.length;
    if (!(Number.isInteger(v1) && Number.isInteger(v2) && Number.isInteger(v3))) continue;
    if (v1 < 0 || v2 < 0 || v3 < 0 || v1 >= limit || v2 >= limit || v3 >= limit) continue;
    indices[kept * 3] = v1;
    indices[kept * 3 + 1] = v2;
    indices[kept * 3 + 2] = v3;

    const pid = attr(node, 'pid');
    const p1 = attr(node, 'p1');
    triPid[kept] = pid || '';
    triIndex[kept] = p1 === null ? -1 : (Number(p1) || 0);
    if (pid || p1 !== null) hasTriangleMaterial = true;
    kept++;
  }
  if (!kept) return null;

  return {
    vertices,
    indices: indices.subarray(0, kept * 3),
    triangleCount: kept,
    triPid: hasTriangleMaterial ? triPid.slice(0, kept) : null,
    triIndex: hasTriangleMaterial ? triIndex.subarray(0, kept) : null,
  };
}

/**
 * Grupos de cor da parte, indexados por `pid`.
 *
 * O core define `<basematerials>` com `displaycolor`; a extensao de materiais
 * acrescenta `<colorgroup>` com `<color>`. Os dois aparecem em arquivos reais,
 * entao os dois sao lidos para a mesma tabela.
 */
function readColorGroups(doc) {
  const groups = new Map();
  const root = el(doc, 'resources') || doc;

  for (const node of els(root, 'basematerials')) {
    const id = attr(node, 'id');
    if (!id) continue;
    groups.set(String(id), els(node, 'base').map((base) => normalizeHex(attr(base, 'displaycolor'))));
  }
  for (const node of els(root, 'colorgroup')) {
    const id = attr(node, 'id');
    if (!id) continue;
    groups.set(String(id), els(node, 'color').map((color) => normalizeHex(attr(color, 'color'))));
  }
  return groups;
}

/** Objetos de uma parte, indexados por id. */
function readObjects(doc) {
  const objects = new Map();
  const resources = el(doc, 'resources') || doc;

  for (const node of els(resources, 'object')) {
    const id = attr(node, 'id');
    if (!id) continue;

    const components = [];
    const componentsNode = el(node, 'components');
    if (componentsNode) {
      for (const component of els(componentsNode, 'component')) {
        const objectId = attr(component, 'objectid');
        if (!objectId) continue;
        components.push({
          objectId,
          // `path` só existe na extensão de produção, e é o que aponta para
          // a parte externa onde a malha realmente está.
          path: normalizePath(attr(component, 'path')),
          transform: parseTransform(attr(component, 'transform')),
        });
      }
    }

    objects.set(String(id), {
      id: String(id),
      mesh: readMesh(node),
      components,
      pid: attr(node, 'pid') || '',
      pindex: Number(attr(node, 'pindex')) || 0,
    });
  }

  return objects;
}

/* ---------- Montagem ---------- */

/** Itens de `<build>` da parte principal. */
function readBuildItems(doc) {
  const buildNode = el(doc, 'build');
  if (!buildNode) return [];
  return els(buildNode, 'item')
    .map((item) => ({
      objectId: attr(item, 'objectid'),
      path: normalizePath(attr(item, 'path')),
      transform: parseTransform(attr(item, 'transform')),
    }))
    .filter((item) => item.objectId);
}

/**
 * Percorre a árvore de objetos acumulando transformações e atravessando
 * referências a partes externas.
 */
async function collectMeshes(zip, mainPart, items, partCache) {
  const partCacheByPath = new Map();
  const out = [];

  const partOf = async (partPath) => {
    const key = partPath.toLowerCase();
    if (partCacheByPath.has(key)) return partCacheByPath.get(key);
    const doc = await loadPart(zip, partPath, partCache);
    const entry = doc
      ? { objects: readObjects(doc), colors: readColorGroups(doc) }
      : { objects: new Map(), colors: new Map() };
    partCacheByPath.set(key, entry);
    return entry;
  };

  const visit = async (partPath, objectId, transform, depth, chain) => {
    const key = `${partPath.toLowerCase()}#${objectId}`;
    if (depth > MAX_DEPTH || chain.has(key)) return;

    const { objects, colors } = await partOf(partPath);
    const object = objects.get(String(objectId));
    if (!object) return;

    if (object.mesh) {
      out.push({
        mesh: object.mesh,
        transform,
        objectId: String(objectId),
        colorGroups: colors,
        pid: object.pid,
        pindex: object.pindex,
      });
    }

    if (object.components.length) {
      const nextChain = new Set(chain).add(key);
      for (const component of object.components) {
        await visit(
          component.path || partPath,
          component.objectId,
          composeTransform(component.transform, transform),
          depth + 1,
          nextChain,
        );
      }
    }
  };

  for (const item of items) {
    await visit(item.path || mainPart, item.objectId, item.transform, 0, new Set());
  }
  return out;
}

/**
 * Último recurso: varre todas as partes `.model` do pacote e aceita qualquer
 * malha encontrada, sem transformações. Cobre arquivos cuja lista de montagem
 * está ausente, vazia ou aponta para ids que não existem.
 */
async function collectEveryMesh(zip, partCache) {
  const out = [];
  for (const entry of zip.entries) {
    if (!/\.model$/i.test(entry.name)) continue;
    const doc = await loadPart(zip, entry.name, partCache);
    if (!doc) continue;
    const colorGroups = readColorGroups(doc);
    for (const object of readObjects(doc).values()) {
      if (object.mesh) {
        out.push({
          mesh: object.mesh,
          transform: null,
          objectId: object.id,
          colorGroups,
          pid: object.pid,
          pindex: object.pindex,
        });
      }
    }
  }
  return out;
}

/* ---------- Cores ---------- */

const DEFAULT_RGB = [0.56, 0.62, 0.78];

/** `#rrggbb` para um trio 0..1 em espaco linear aproximado. */
function hexToRgb(hex) {
  const value = normalizeHex(hex);
  if (!value) return null;
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
}

/**
 * Resolve a cor de cada malha e, quando houver, de cada triangulo.
 *
 * Tres fontes, em ordem de confianca:
 *  1. `pid`/`p1` do triangulo — pintura por face, do proprio padrao 3MF.
 *  2. `pid`/`pindex` do objeto — cor unica da parte.
 *  3. Extrusora da parte, lida de `model_settings.config`, cruzada com as
 *     cores dos filamentos do fatiador. E o unico caminho para um 3MF do
 *     Bambu Studio, que nao usa os grupos de cor do padrao.
 */
function resolveColors(meshes, slice) {
  const filamentColors = (slice?.filaments || []).map((f) => f.color);
  const extruderByObject = slice?.extruderByObject || null;
  const used = new Map();

  const register = (hex) => {
    const value = normalizeHex(hex);
    if (value) used.set(value, (used.get(value) || 0) + 1);
    return value;
  };

  const plans = meshes.map((entry) => {
    const groups = entry.colorGroups || new Map();
    const lookup = (pid, index) => {
      const list = groups.get(String(pid || ''));
      if (!list || !list.length) return '';
      return list[Math.max(0, Math.min(index, list.length - 1))] || '';
    };

    let objectHex = lookup(entry.pid, entry.pindex);

    if (!objectHex && extruderByObject) {
      const extruder = extruderByObject.get(entry.objectId);
      if (Number.isFinite(extruder) && extruder > 0) {
        objectHex = filamentColors[extruder - 1] || '';
      }
    }
    register(objectHex);

    const { triPid, triIndex, triangleCount } = entry.mesh;
    let triangleHex = null;
    if (triPid && triIndex) {
      triangleHex = new Array(triangleCount);
      let distinct = false;
      for (let t = 0; t < triangleCount; t++) {
        const pid = triPid[t] || entry.pid;
        const index = triIndex[t] >= 0 ? triIndex[t] : entry.pindex;
        const hex = lookup(pid, index) || objectHex;
        triangleHex[t] = hex;
        if (hex && hex !== objectHex) distinct = true;
        register(hex);
      }
      // Sem variacao real entre faces, a cor do objeto basta.
      if (!distinct) triangleHex = null;
    }

    return { objectHex, triangleHex };
  });

  const hasColor = [...used.keys()].length > 0;
  return { plans, hasColor, palette: [...used.keys()] };
}

/* ---------- Entrada ---------- */

/** Interpreta um ArrayBuffer de 3MF. Mesma forma de saída do leitor de STL. */
export async function parse3MF(arrayBuffer, onProgress) {
  const zip = openZip(arrayBuffer);
  const partCache = new Map();

  // Metadados do fatiador e geometria sao independentes: le os dois de uma vez.
  const slicePromise = readSliceInfo(zip).catch(() => null);

  const mainPart = await locateModelPart(zip);
  onProgress?.(0.15);

  const mainDoc = await loadPart(zip, mainPart, partCache);
  if (!mainDoc) throw new Error(`A parte "${mainPart}" não é um XML válido.`);
  onProgress?.(0.35);

  const modelNode = el(mainDoc, 'model');
  const unit = (attr(modelNode || mainDoc.documentElement, 'unit') || 'millimeter').toLowerCase();
  const scale = UNIT_TO_MM[unit] ?? 1;

  const items = readBuildItems(mainDoc);
  let meshes = await collectMeshes(zip, mainPart, items, partCache);
  onProgress?.(0.55);

  if (!meshes.length) {
    // A montagem não levou a nenhuma malha: tenta o pacote inteiro.
    meshes = await collectEveryMesh(zip, partCache);
  }

  if (!meshes.length) {
    // Um .gcode.3mf do Bambu é o projeto FATIADO: traz o G-code e, muitas vezes,
    // um modelo vazio. Reclamar de malha ilegível manda procurar no lugar errado.
    const hasGcode = zip.entries.some((e) => /\.(gcode|gco)$/i.test(e.name));
    if (hasGcode) {
      const error = new Error(
        'Este 3MF é a exportação fatiada: contém o G-code, não a geometria. '
        + 'Ele serve no campo "Dados do fatiamento", para medir peso e tempo. '
        + 'Para a biblioteca, envie o projeto 3MF salvo antes de fatiar.',
      );
      error.isSlicedFile = true;
      throw error;
    }

    const parts = zip.entries.filter((e) => /\.model$/i.test(e.name)).length;
    const objects = readObjects(mainDoc).size;
    throw new Error(
      `3MF sem geometria utilizável: ${parts} parte(s) .model, ${objects} objeto(s) e `
      + `${items.length} item(ns) de montagem, nenhum com malha legível.`,
    );
  }

  const slice = await slicePromise;
  const { plans, hasColor, palette } = resolveColors(meshes, slice);

  const triangles = meshes.reduce((sum, m) => sum + m.mesh.triangleCount, 0);
  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  const colors = hasColor ? new Float32Array(triangles * 9) : null;
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

  let writeIndex = 0;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
    const { mesh, transform } = meshes[meshIndex];
    const plan = plans[meshIndex];
    const objectRgb = hexToRgb(plan.objectHex) || DEFAULT_RGB;
    const { vertices, indices, triangleCount } = mesh;
    for (let t = 0; t < triangleCount; t++) {
      const corners = [];
      for (let c = 0; c < 3; c++) {
        const vi = indices[t * 3 + c] * 3;
        const [tx, ty, tz] = applyTransform(transform, vertices[vi], vertices[vi + 1], vertices[vi + 2]);
        corners.push([tx * scale, ty * scale, tz * scale]);
      }

      const [a, b, c] = corners;
      let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-12) { nx /= len; ny /= len; nz /= len; } else { nx = 0; ny = 0; nz = 1; }

      const rgb = colors
        ? (plan.triangleHex ? (hexToRgb(plan.triangleHex[t]) || objectRgb) : objectRgb)
        : null;

      const o = writeIndex * 9;
      for (let k = 0; k < 3; k++) {
        positions[o + k * 3] = corners[k][0];
        positions[o + k * 3 + 1] = corners[k][1];
        positions[o + k * 3 + 2] = corners[k][2];
        normals[o + k * 3] = nx;
        normals[o + k * 3 + 1] = ny;
        normals[o + k * 3 + 2] = nz;
        if (colors) {
          colors[o + k * 3] = rgb[0];
          colors[o + k * 3 + 1] = rgb[1];
          colors[o + k * 3 + 2] = rgb[2];
        }

        for (let axis = 0; axis < 3; axis++) {
          if (corners[k][axis] < bounds.min[axis]) bounds.min[axis] = corners[k][axis];
          if (corners[k][axis] > bounds.max[axis]) bounds.max[axis] = corners[k][axis];
        }
      }
      writeIndex++;
    }
    onProgress?.(0.55 + 0.45 * (writeIndex / triangles));
  }

  return {
    positions: positions.subarray(0, writeIndex * 9),
    normals: normals.subarray(0, writeIndex * 9),
    colors: colors ? colors.subarray(0, writeIndex * 9) : null,
    triangles: writeIndex,
    bounds,
    unit,
    palette,
    slice: slice || null,
  };
}

export default parse3MF;
