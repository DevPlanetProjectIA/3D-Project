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
  let kept = 0;
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
    kept++;
  }
  if (!kept) return null;

  return { vertices, indices: indices.subarray(0, kept * 3), triangleCount: kept };
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

    objects.set(String(id), { id: String(id), mesh: readMesh(node), components });
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
  const objectCache = new Map();
  const out = [];

  const objectsOf = async (partPath) => {
    const key = partPath.toLowerCase();
    if (objectCache.has(key)) return objectCache.get(key);
    const doc = await loadPart(zip, partPath, partCache);
    const map = doc ? readObjects(doc) : new Map();
    objectCache.set(key, map);
    return map;
  };

  const visit = async (partPath, objectId, transform, depth, chain) => {
    const key = `${partPath.toLowerCase()}#${objectId}`;
    if (depth > MAX_DEPTH || chain.has(key)) return;

    const objects = await objectsOf(partPath);
    const object = objects.get(String(objectId));
    if (!object) return;

    if (object.mesh) out.push({ mesh: object.mesh, transform });

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
    for (const object of readObjects(doc).values()) {
      if (object.mesh) out.push({ mesh: object.mesh, transform: null });
    }
  }
  return out;
}

/* ---------- Entrada ---------- */

/** Interpreta um ArrayBuffer de 3MF. Mesma forma de saída do leitor de STL. */
export async function parse3MF(arrayBuffer, onProgress) {
  const zip = openZip(arrayBuffer);
  const partCache = new Map();

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
    const parts = zip.entries.filter((e) => /\.model$/i.test(e.name)).length;
    const objects = readObjects(mainDoc).size;
    throw new Error(
      `3MF sem geometria utilizável: ${parts} parte(s) .model, ${objects} objeto(s) e `
      + `${items.length} item(ns) de montagem, nenhum com malha legível.`,
    );
  }

  const triangles = meshes.reduce((sum, m) => sum + m.mesh.triangleCount, 0);
  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

  let writeIndex = 0;
  for (const { mesh, transform } of meshes) {
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

      const o = writeIndex * 9;
      for (let k = 0; k < 3; k++) {
        positions[o + k * 3] = corners[k][0];
        positions[o + k * 3 + 1] = corners[k][1];
        positions[o + k * 3 + 2] = corners[k][2];
        normals[o + k * 3] = nx;
        normals[o + k * 3 + 1] = ny;
        normals[o + k * 3 + 2] = nz;

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
    triangles: writeIndex,
    bounds,
    unit,
  };
}

export default parse3MF;
