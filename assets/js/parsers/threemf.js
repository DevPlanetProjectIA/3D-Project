/*
 * Leitor de 3MF (3D Manufacturing Format).
 *
 * Um .3mf é um container OPC (ZIP) cujo modelo fica tipicamente em
 * `3D/3dmodel.model`, um XML com malhas, componentes e a lista de montagem
 * (`<build>`). Este leitor achata tudo em uma sopa de triângulos já
 * transformada, convertida para milímetros.
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

const REL_TYPE_MODEL = '3dmodel';

/** Descobre a parte principal via `_rels/.rels`, com fallback por convenção. */
async function locateModelPart(zip) {
  try {
    const relsText = await zip.text('_rels/.rels');
    const doc = new DOMParser().parseFromString(relsText, 'application/xml');
    for (const rel of doc.getElementsByTagName('Relationship')) {
      const type = (rel.getAttribute('Type') || '').toLowerCase();
      if (type.endsWith(REL_TYPE_MODEL)) {
        const target = (rel.getAttribute('Target') || '').replace(/^\/+/, '');
        if (target) return target;
      }
    }
  } catch {
    // Sem .rels legível: cai no fallback.
  }

  const byConvention = zip.find((e) => /^3d\/3dmodel\.model$/i.test(e.name))
    || zip.find((e) => /\.model$/i.test(e.name));
  if (!byConvention) throw new Error('Nenhuma parte de modelo encontrada no 3MF.');
  return byConvention.name;
}

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

/** Extrai malha e componentes de cada `<object>` do documento. */
function readObjects(doc) {
  const objects = new Map();

  for (const node of doc.getElementsByTagName('object')) {
    const id = node.getAttribute('id');
    if (!id) continue;

    const meshNode = node.getElementsByTagName('mesh')[0];
    let mesh = null;
    if (meshNode) {
      const vertexNodes = meshNode.getElementsByTagName('vertex');
      const triangleNodes = meshNode.getElementsByTagName('triangle');
      const vertices = new Float64Array(vertexNodes.length * 3);
      for (let i = 0; i < vertexNodes.length; i++) {
        const v = vertexNodes[i];
        vertices[i * 3] = Number(v.getAttribute('x')) || 0;
        vertices[i * 3 + 1] = Number(v.getAttribute('y')) || 0;
        vertices[i * 3 + 2] = Number(v.getAttribute('z')) || 0;
      }
      const indices = new Uint32Array(triangleNodes.length * 3);
      let kept = 0;
      for (let i = 0; i < triangleNodes.length; i++) {
        const t = triangleNodes[i];
        const v1 = Number(t.getAttribute('v1'));
        const v2 = Number(t.getAttribute('v2'));
        const v3 = Number(t.getAttribute('v3'));
        const limit = vertexNodes.length;
        if (!(v1 >= 0 && v2 >= 0 && v3 >= 0 && v1 < limit && v2 < limit && v3 < limit)) continue;
        indices[kept * 3] = v1;
        indices[kept * 3 + 1] = v2;
        indices[kept * 3 + 2] = v3;
        kept++;
      }
      mesh = { vertices, indices: indices.subarray(0, kept * 3), triangleCount: kept };
    }

    const components = [];
    const componentsNode = node.getElementsByTagName('components')[0];
    if (componentsNode) {
      for (const comp of componentsNode.getElementsByTagName('component')) {
        const objectId = comp.getAttribute('objectid');
        if (objectId) components.push({ objectId, transform: parseTransform(comp.getAttribute('transform')) });
      }
    }

    objects.set(id, { id, mesh, components });
  }

  return objects;
}

/** Itens de montagem; na ausência de `<build>`, usa todo objeto com malha. */
function readBuildItems(doc, objects) {
  const items = [];
  const buildNode = doc.getElementsByTagName('build')[0];
  if (buildNode) {
    for (const item of buildNode.getElementsByTagName('item')) {
      const objectId = item.getAttribute('objectid');
      if (objectId && objects.has(objectId)) {
        items.push({ objectId, transform: parseTransform(item.getAttribute('transform')) });
      }
    }
  }
  if (!items.length) {
    for (const [id, obj] of objects) {
      if (obj.mesh?.triangleCount) items.push({ objectId: id, transform: null });
    }
  }
  return items;
}

/** Percorre a árvore de objetos acumulando transformações. */
function collectMeshes(objects, items) {
  const out = [];
  const visit = (objectId, transform, depth, chain) => {
    if (depth > 24 || chain.has(objectId)) return;
    const obj = objects.get(objectId);
    if (!obj) return;
    if (obj.mesh?.triangleCount) out.push({ mesh: obj.mesh, transform });
    if (obj.components.length) {
      const nextChain = new Set(chain).add(objectId);
      for (const comp of obj.components) {
        visit(comp.objectId, composeTransform(comp.transform, transform), depth + 1, nextChain);
      }
    }
  };
  for (const item of items) visit(item.objectId, item.transform, 0, new Set());
  return out;
}

/** Interpreta um ArrayBuffer de 3MF. Mesma forma de saída do leitor de STL. */
export async function parse3MF(arrayBuffer, onProgress) {
  const zip = openZip(arrayBuffer);
  const partName = await locateModelPart(zip);
  onProgress?.(0.2);

  const xml = await zip.text(partName);
  onProgress?.(0.45);

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = doc.getElementsByTagName('parsererror')[0];
  if (parseError) throw new Error('XML do 3MF inválido.');

  const modelNode = doc.getElementsByTagName('model')[0];
  const unit = (modelNode?.getAttribute('unit') || 'millimeter').toLowerCase();
  const scale = UNIT_TO_MM[unit] ?? 1;

  const objects = readObjects(doc);
  if (!objects.size) throw new Error('3MF sem objetos.');

  const items = readBuildItems(doc, objects);
  const meshes = collectMeshes(objects, items);
  if (!meshes.length) throw new Error('3MF sem malhas na lista de montagem.');
  onProgress?.(0.6);

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

        if (corners[k][0] < bounds.min[0]) bounds.min[0] = corners[k][0];
        if (corners[k][1] < bounds.min[1]) bounds.min[1] = corners[k][1];
        if (corners[k][2] < bounds.min[2]) bounds.min[2] = corners[k][2];
        if (corners[k][0] > bounds.max[0]) bounds.max[0] = corners[k][0];
        if (corners[k][1] > bounds.max[1]) bounds.max[1] = corners[k][1];
        if (corners[k][2] > bounds.max[2]) bounds.max[2] = corners[k][2];
      }
      writeIndex++;
    }
    onProgress?.(0.6 + 0.4 * (writeIndex / triangles));
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
