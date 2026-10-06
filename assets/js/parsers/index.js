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
 * Interpreta um arquivo de modelo.
 * Devolve `{ positions, normals, triangles, bounds, format }`.
 */
export async function parseModel(arrayBuffer, format, onProgress) {
  const kind = format || '';
  if (kind === '3mf') {
    const geometry = await parse3MF(arrayBuffer, onProgress);
    return { ...geometry, format: '3mf' };
  }
  if (kind === 'stl') {
    const geometry = parseSTL(arrayBuffer, onProgress);
    onProgress?.(1);
    return { ...geometry, format: 'stl' };
  }
  throw new Error('Formato não suportado. Use .stl ou .3mf.');
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
