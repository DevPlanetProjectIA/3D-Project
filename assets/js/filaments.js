/*
 * Tabela de materiais de impressão.
 *
 * `density` em g/cm³ — é o que converte volume de malha em gramas quando o
 * arquivo não traz os dados do fatiador. `price` é uma referência em BRL por
 * quilo, usada apenas como sugestão no cadastro do estoque.
 */

export const MATERIALS = [
  { id: 'PLA', label: 'PLA', density: 1.24, price: 110, nozzle: 210, bed: 60 },
  { id: 'PLA-Silk', label: 'PLA Silk', density: 1.24, price: 140, nozzle: 215, bed: 60 },
  { id: 'PLA-CF', label: 'PLA-CF', density: 1.27, price: 230, nozzle: 230, bed: 60 },
  { id: 'PETG', label: 'PETG', density: 1.27, price: 130, nozzle: 240, bed: 80 },
  { id: 'PETG-CF', label: 'PETG-CF', density: 1.30, price: 260, nozzle: 250, bed: 80 },
  { id: 'ABS', label: 'ABS', density: 1.04, price: 120, nozzle: 250, bed: 95 },
  { id: 'ASA', label: 'ASA', density: 1.07, price: 180, nozzle: 260, bed: 100 },
  { id: 'TPU', label: 'TPU / Flex', density: 1.21, price: 190, nozzle: 230, bed: 45 },
  { id: 'PA', label: 'Nylon (PA)', density: 1.14, price: 320, nozzle: 280, bed: 90 },
  { id: 'PA-CF', label: 'Nylon-CF', density: 1.19, price: 420, nozzle: 290, bed: 90 },
  { id: 'PC', label: 'Policarbonato', density: 1.20, price: 300, nozzle: 280, bed: 110 },
  { id: 'HIPS', label: 'HIPS', density: 1.04, price: 140, nozzle: 240, bed: 100 },
  { id: 'PVA', label: 'PVA (solúvel)', density: 1.23, price: 480, nozzle: 215, bed: 60 },
  { id: 'PP', label: 'Polipropileno', density: 0.90, price: 280, nozzle: 250, bed: 90 },
  { id: 'OUTRO', label: 'Outro', density: 1.24, price: 0, nozzle: 210, bed: 60 },
];

const INDEX = new Map(MATERIALS.map((m) => [m.id, m]));

export const getMaterial = (id) => INDEX.get(String(id || '').toUpperCase()) || null;

/** Densidade do material, com o PLA como padrão seguro. */
export const densityOf = (id) => getMaterial(id)?.density ?? 1.24;

/**
 * Normaliza o nome de material vindo de um fatiador ("PLA Basic",
 * "Generic PETG", "PLA-CF") para um id da tabela.
 */
export function normalizeMaterial(raw) {
  const text = String(raw || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!text) return 'PLA';
  const ordered = ['PLA-CF', 'PETG-CF', 'PA-CF', 'PLA-SILK', 'PETG', 'PVA', 'HIPS', 'TPU', 'ASA', 'ABS', 'PA', 'PC', 'PP', 'PLA'];
  for (const id of ordered) {
    if (text.includes(id)) return id === 'PLA-SILK' ? 'PLA-Silk' : id;
  }
  if (text.includes('NYLON')) return 'PA';
  if (text.includes('FLEX') || text.includes('TPE')) return 'TPU';
  return 'OUTRO';
}

/** Paleta de cores usada no cadastro de filamento. */
export const PALETTE = [
  ['Branco', '#ffffff'], ['Preto', '#1f2937'], ['Cinza', '#6b7280'], ['Prata', '#d1d5db'],
  ['Vermelho', '#dc2626'], ['Laranja', '#f97316'], ['Amarelo', '#eab308'], ['Verde', '#16a34a'],
  ['Verde-água', '#14b8a6'], ['Azul', '#2563eb'], ['Azul-claro', '#38bdf8'], ['Roxo', '#9333ea'],
  ['Rosa', '#ec4899'], ['Marrom', '#92400e'], ['Bege', '#e7d3b1'], ['Dourado', '#c9a227'],
  ['Transparente', '#e5e7eb'], ['Natural', '#f3ead3'],
];

/** Nome aproximado de uma cor hex, para rotular filamentos lidos do arquivo. */
export function colorName(hex) {
  const value = String(hex || '').replace('#', '').slice(0, 6);
  if (value.length !== 6) return 'Cor';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  let best = 'Cor';
  let bestDistance = Infinity;
  for (const [name, swatch] of PALETTE) {
    const [sr, sg, sb] = [1, 3, 5].map((i) => parseInt(swatch.slice(i, i + 2), 16));
    const distance = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = name; }
  }
  return best;
}

export default MATERIALS;
