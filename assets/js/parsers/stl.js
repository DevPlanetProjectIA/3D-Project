/*
 * Leitor de STL — binário e ASCII.
 *
 * Devolve geometria pronta para o WebGL, com normais recalculadas a partir dos
 * vértices (as normais gravadas em arquivos STL são frequentemente nulas ou
 * inconsistentes, então são usadas apenas como último recurso).
 */

const HEADER_BYTES = 84;   // 80 de cabeçalho + 4 do contador de triângulos
const FACET_BYTES = 50;    // 12 floats + 2 de atributo

/** Heurística de formato: o tamanho exato bate com o contador declarado. */
export function isBinarySTL(buffer) {
  if (buffer.byteLength < HEADER_BYTES) return false;
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  if (HEADER_BYTES + count * FACET_BYTES === buffer.byteLength) return true;

  // Sem correspondência exata: decide pela presença de palavras-chave ASCII.
  const probe = new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength));
  const text = String.fromCharCode(...probe).toLowerCase();
  return !(text.includes('solid') && text.includes('facet'));
}

function emptyBounds() {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
}

function growBounds(bounds, x, y, z) {
  if (x < bounds.min[0]) bounds.min[0] = x;
  if (y < bounds.min[1]) bounds.min[1] = y;
  if (z < bounds.min[2]) bounds.min[2] = z;
  if (x > bounds.max[0]) bounds.max[0] = x;
  if (y > bounds.max[1]) bounds.max[1] = y;
  if (z > bounds.max[2]) bounds.max[2] = z;
}

/** Normal do plano do triângulo; `fallback` é usada em faces degeneradas. */
function faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz, fallback) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len > 1e-12) return [nx / len, ny / len, nz / len];

  const flen = Math.hypot(fallback[0], fallback[1], fallback[2]);
  if (flen > 1e-12) return [fallback[0] / flen, fallback[1] / flen, fallback[2] / flen];
  return [0, 0, 1];
}

function parseBinary(buffer, onProgress) {
  const view = new DataView(buffer);
  const declared = view.getUint32(80, true);
  const maxByLength = Math.floor((buffer.byteLength - HEADER_BYTES) / FACET_BYTES);
  const count = Math.max(0, Math.min(declared, maxByLength));
  if (!count) throw new Error('STL binário sem triângulos legíveis.');

  const positions = new Float32Array(count * 9);
  const normals = new Float32Array(count * 9);
  const bounds = emptyBounds();

  for (let i = 0; i < count; i++) {
    const base = HEADER_BYTES + i * FACET_BYTES;
    const fallback = [
      view.getFloat32(base, true),
      view.getFloat32(base + 4, true),
      view.getFloat32(base + 8, true),
    ];

    const v = new Float32Array(9);
    for (let k = 0; k < 9; k++) v[k] = view.getFloat32(base + 12 + k * 4, true);

    const n = faceNormal(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], fallback);

    const o = i * 9;
    positions.set(v, o);
    for (let c = 0; c < 3; c++) {
      normals[o + c * 3] = n[0];
      normals[o + c * 3 + 1] = n[1];
      normals[o + c * 3 + 2] = n[2];
      growBounds(bounds, v[c * 3], v[c * 3 + 1], v[c * 3 + 2]);
    }

    if (onProgress && (i & 0x3fff) === 0) onProgress(i / count);
  }

  return { positions, normals, triangles: count, bounds };
}

function parseAscii(text, onProgress) {
  const positions = [];
  const normals = [];
  const bounds = emptyBounds();

  // Varre por facetas: captura a normal declarada e os três vértices.
  const facetRe = /facet\s+normal\s+([^\n]*?)\s*outer\s+loop([\s\S]*?)endloop/gi;
  const numberRe = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;

  let match;
  let count = 0;
  while ((match = facetRe.exec(text)) !== null) {
    const fallbackNums = (match[1].match(numberRe) || []).map(Number);
    const vertexNums = (match[2].match(numberRe) || []).map(Number);
    if (vertexNums.length < 9) continue;

    const v = vertexNums.slice(0, 9);
    const fallback = fallbackNums.length >= 3 ? fallbackNums.slice(0, 3) : [0, 0, 0];
    const n = faceNormal(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], fallback);

    for (let c = 0; c < 3; c++) {
      positions.push(v[c * 3], v[c * 3 + 1], v[c * 3 + 2]);
      normals.push(n[0], n[1], n[2]);
      growBounds(bounds, v[c * 3], v[c * 3 + 1], v[c * 3 + 2]);
    }
    count++;
    if (onProgress && (count & 0x1fff) === 0) onProgress(Math.min(0.95, facetRe.lastIndex / text.length));
  }

  if (!count) throw new Error('STL ASCII sem triângulos legíveis.');
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    triangles: count,
    bounds,
  };
}

/**
 * Interpreta um ArrayBuffer de STL.
 *
 * A heurística binário/ASCII erra em arquivos reais: há exportadores que
 * escrevem "solid <nome>" nos 80 bytes de cabeçalho de um STL binário, e há
 * arquivos binários com bytes de contagem inconsistentes. Por isso, quando o
 * dialeto escolhido falha, o outro é tentado antes de desistir.
 */
export function parseSTL(buffer, onProgress) {
  if (!buffer || buffer.byteLength < 15) throw new Error('Arquivo STL vazio ou truncado.');

  const binaryFirst = isBinarySTL(buffer);
  const asText = () => new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const attempts = binaryFirst
    ? [['binário', () => parseBinary(buffer, onProgress)], ['ASCII', () => parseAscii(asText(), onProgress)]]
    : [['ASCII', () => parseAscii(asText(), onProgress)], ['binário', () => parseBinary(buffer, onProgress)]];

  const failures = [];
  for (const [label, run] of attempts) {
    try {
      return run();
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
    }
  }
  throw new Error(`Não foi possível interpretar o STL (${failures.join('; ')}).`);
}

export default parseSTL;
