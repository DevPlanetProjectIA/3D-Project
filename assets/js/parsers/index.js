/* Despacho de formato e métricas derivadas da geometria. */

import { parseSTL } from './stl.js';
import { parse3MF } from './threemf.js';

export { parseSTL, parse3MF };

/** Deduz o formato pela extensão do nome do arquivo. */
export function formatOf(filename) {
  const ext = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === '3mf') return '3mf';
  if (ext === 'stl') return 'stl';
  return '';
}

/**
 * Deduz o formato pelo conteúdo. Um 3MF é um ZIP, portanto começa com "PK\x03\x04";
 * nenhum STL começa assim. Útil porque arquivos renomeados são comuns.
 */
export function sniffFormat(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return '';
  const head = new Uint8Array(arrayBuffer, 0, 4);
  const isZip = head[0] === 0x50 && head[1] === 0x4b
    && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
  return isZip ? '3mf' : 'stl';
}

/**
 * Interpreta um arquivo de modelo.
 * Devolve `{ positions, normals, triangles, bounds, format }`.
 *
 * O conteúdo tem precedência sobre a extensão: um `.stl` que é de fato um
 * container 3MF (ou o contrário) é interpretado pelo que realmente é.
 */
export async function parseModel(arrayBuffer, format, onProgress) {
  const sniffed = sniffFormat(arrayBuffer);
  const kind = sniffed || format || '';

  if (kind === '3mf') {
    const geometry = await parse3MF(arrayBuffer, onProgress);
    return { ...geometry, format: '3mf' };
  }
  if (kind === 'stl') {
    const geometry = parseSTL(arrayBuffer, onProgress);
    onProgress?.(1);
    return { ...geometry, format: 'stl', colors: null, palette: [], slice: null };
  }
  throw new Error('Formato não suportado. Use .stl ou .3mf.');
}

/**
 * Volume fechado da malha, em mm³.
 *
 * Soma o volume assinado dos tetraedros formados por cada triângulo e a
 * origem. Vale para malhas fechadas e orientadas; em malhas abertas o número
 * perde sentido, por isso o valor absoluto e a checagem de sanidade contra a
 * caixa envolvente em `estimateWeight`.
 */
export function volumeOf(geometry) {
  const p = geometry.positions;
  let total = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    total += ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx);
  }
  return Math.abs(total) / 6;
}

/**
 * Estima o peso impresso a partir do volume da malha.
 *
 * Só é usada quando o arquivo não traz os dados do fatiador. O fator sólido
 * aproxima paredes, topo e base somados ao preenchimento: a 100% de
 * preenchimento a peça é maciça; a 20%, cerca de 45% do volume vira material.
 * É uma heurística — a interface sempre rotula o resultado como estimativa.
 */
export function estimateWeight({ volumeMm3, boxVolumeMm3 = 0, density = 1.24, infillPercent = 20 }) {
  // Volume maior que a caixa envolvente denuncia malha aberta ou invertida.
  const sane = boxVolumeMm3 > 0 && volumeMm3 > boxVolumeMm3 * 1.02 ? 0 : volumeMm3;
  const volumeCm3 = sane / 1000;
  const infill = Math.min(100, Math.max(0, infillPercent)) / 100;
  const solidRatio = Math.min(1, infill + 0.25);
  return {
    volumeCm3,
    solidRatio,
    grams: volumeCm3 * density * solidRatio,
    reliable: sane > 0,
  };
}

/** Dimensões (mm), centro e volume da caixa envolvente. */
export function measure(geometry) {
  const { min, max } = geometry.bounds;
  const finite = min.every(Number.isFinite) && max.every(Number.isFinite);
  const size = finite ? [max[0] - min[0], max[1] - min[1], max[2] - min[2]] : [0, 0, 0];
  return {
    size: { x: size[0], y: size[1], z: size[2] },
    center: finite ? [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] : [0, 0, 0],
    radius: Math.hypot(size[0], size[1], size[2]) / 2 || 1,
    boxVolume: size[0] * size[1] * size[2],
  };
}
