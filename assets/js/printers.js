/*
 * Catálogo de impressoras.
 *
 * `bed` em mm, `watts` é a potência média de trabalho (usada no custo de
 * energia) e `price` é uma referência de mercado em BRL para o cálculo de
 * depreciação. Valores de referência: ajuste no estoque/configurações quando
 * souber os números da sua máquina.
 */

export const PRINTERS = [
  // ---------- Bambu Lab ----------
  { id: 'bambu_a1_mini', brand: 'Bambu Lab', model: 'A1 mini', bed: [180, 180, 180], watts: 110, price: 2200, ams: 'AMS lite' },
  { id: 'bambu_a1', brand: 'Bambu Lab', model: 'A1', bed: [256, 256, 256], watts: 140, price: 3200, ams: 'AMS lite' },
  { id: 'bambu_p1p', brand: 'Bambu Lab', model: 'P1P', bed: [256, 256, 256], watts: 150, price: 4000, ams: 'AMS' },
  { id: 'bambu_p1s', brand: 'Bambu Lab', model: 'P1S', bed: [256, 256, 256], watts: 150, price: 4800, ams: 'AMS' },
  { id: 'bambu_x1c', brand: 'Bambu Lab', model: 'X1 Carbon', bed: [256, 256, 256], watts: 160, price: 8500, ams: 'AMS' },
  { id: 'bambu_x1e', brand: 'Bambu Lab', model: 'X1E', bed: [256, 256, 256], watts: 180, price: 16000, ams: 'AMS' },
  { id: 'bambu_h2d', brand: 'Bambu Lab', model: 'H2D', bed: [350, 320, 325], watts: 220, price: 17000, ams: 'AMS 2 Pro' },
  { id: 'bambu_h2s', brand: 'Bambu Lab', model: 'H2S', bed: [350, 320, 325], watts: 220, price: 14000, ams: 'AMS 2 Pro' },

  // ---------- FlashForge ----------
  { id: 'ff_ad5m', brand: 'FlashForge', model: 'Adventurer 5M', bed: [220, 220, 220], watts: 120, price: 2000 },
  { id: 'ff_ad5m_pro', brand: 'FlashForge', model: 'Adventurer 5M Pro', bed: [220, 220, 220], watts: 140, price: 2800 },
  { id: 'ff_ad5x', brand: 'FlashForge', model: 'Adventurer 5X', bed: [220, 220, 220], watts: 150, price: 3600, ams: 'IFS' },
  { id: 'ff_ad4', brand: 'FlashForge', model: 'Adventurer 4', bed: [220, 200, 250], watts: 150, price: 3500 },
  { id: 'ff_creator4', brand: 'FlashForge', model: 'Creator 4', bed: [400, 350, 500], watts: 400, price: 30000 },
  { id: 'ff_guider3', brand: 'FlashForge', model: 'Guider 3', bed: [300, 250, 340], watts: 350, price: 18000 },

  // ---------- Creality ----------
  { id: 'creality_ender3', brand: 'Creality', model: 'Ender 3', bed: [220, 220, 250], watts: 120, price: 1200 },
  { id: 'creality_ender3_v3', brand: 'Creality', model: 'Ender 3 V3', bed: [220, 220, 250], watts: 150, price: 1900 },
  { id: 'creality_k1', brand: 'Creality', model: 'K1', bed: [220, 220, 250], watts: 180, price: 3000 },
  { id: 'creality_k1c', brand: 'Creality', model: 'K1C', bed: [220, 220, 250], watts: 190, price: 3500 },
  { id: 'creality_k2_plus', brand: 'Creality', model: 'K2 Plus', bed: [350, 350, 350], watts: 250, price: 9000, ams: 'CFS' },
  { id: 'creality_hi', brand: 'Creality', model: 'Hi', bed: [260, 260, 300], watts: 160, price: 2600, ams: 'CFS' },

  // ---------- Prusa ----------
  { id: 'prusa_mk4s', brand: 'Prusa', model: 'MK4S', bed: [250, 210, 220], watts: 120, price: 7500, ams: 'MMU3' },
  { id: 'prusa_mini', brand: 'Prusa', model: 'MINI+', bed: [180, 180, 180], watts: 100, price: 4000 },
  { id: 'prusa_xl', brand: 'Prusa', model: 'XL', bed: [360, 360, 360], watts: 250, price: 22000 },
  { id: 'prusa_core_one', brand: 'Prusa', model: 'CORE One', bed: [250, 220, 270], watts: 160, price: 11000 },

  // ---------- Elegoo ----------
  { id: 'elegoo_n4', brand: 'Elegoo', model: 'Neptune 4', bed: [225, 225, 265], watts: 150, price: 1700 },
  { id: 'elegoo_n4_pro', brand: 'Elegoo', model: 'Neptune 4 Pro', bed: [225, 225, 265], watts: 160, price: 2100 },
  { id: 'elegoo_n4_max', brand: 'Elegoo', model: 'Neptune 4 Max', bed: [420, 420, 480], watts: 300, price: 3600 },
  { id: 'elegoo_cc', brand: 'Elegoo', model: 'Centauri Carbon', bed: [256, 256, 256], watts: 160, price: 2400 },

  // ---------- Anycubic ----------
  { id: 'anycubic_kobra3', brand: 'Anycubic', model: 'Kobra 3', bed: [250, 250, 260], watts: 150, price: 2200, ams: 'ACE Pro' },
  { id: 'anycubic_kobra3_max', brand: 'Anycubic', model: 'Kobra 3 Max', bed: [420, 420, 500], watts: 300, price: 4500, ams: 'ACE Pro' },
  { id: 'anycubic_kobra2', brand: 'Anycubic', model: 'Kobra 2', bed: [220, 220, 250], watts: 140, price: 1500 },
  { id: 'anycubic_s1', brand: 'Anycubic', model: 'Kobra S1', bed: [250, 250, 250], watts: 160, price: 2900, ams: 'ACE Pro' },

  // ---------- Qidi ----------
  { id: 'qidi_x_plus3', brand: 'Qidi', model: 'X-Plus 3', bed: [280, 280, 270], watts: 200, price: 5000 },
  { id: 'qidi_q1_pro', brand: 'Qidi', model: 'Q1 Pro', bed: [245, 245, 240], watts: 180, price: 3800 },
  { id: 'qidi_plus4', brand: 'Qidi', model: 'Plus4', bed: [305, 305, 280], watts: 280, price: 7000 },

  // ---------- Sovol ----------
  { id: 'sovol_sv06', brand: 'Sovol', model: 'SV06', bed: [220, 220, 250], watts: 130, price: 1500 },
  { id: 'sovol_sv08', brand: 'Sovol', model: 'SV08', bed: [350, 350, 345], watts: 250, price: 4500 },

  // ---------- Outras ----------
  { id: 'voron_24', brand: 'Voron', model: '2.4 (350)', bed: [350, 350, 350], watts: 300, price: 9000 },
  { id: 'artillery_x4', brand: 'Artillery', model: 'Sidewinder X4', bed: [300, 300, 400], watts: 200, price: 2800 },
  { id: 'snapmaker_j1', brand: 'Snapmaker', model: 'J1s', bed: [324, 200, 200], watts: 200, price: 9000 },
  { id: 'outra', brand: 'Outra', model: 'Outra / genérica', bed: [220, 220, 250], watts: 150, price: 2500 },
];

const INDEX = new Map(PRINTERS.map((p) => [p.id, p]));

export const getPrinter = (id) => INDEX.get(id) || null;

export const printerLabel = (printer) =>
  printer ? `${printer.brand} ${printer.model}` : '';

/** Agrupa por marca, preservando a ordem do catálogo — pronto para <optgroup>. */
export function printersByBrand() {
  const groups = new Map();
  for (const printer of PRINTERS) {
    if (!groups.has(printer.brand)) groups.set(printer.brand, []);
    groups.get(printer.brand).push(printer);
  }
  return [...groups.entries()];
}

/** Impressoras cuja mesa acomoda a peça, considerando uma folga de 2 mm. */
export function printersThatFit({ x = 0, y = 0, z = 0 }) {
  const fits = (printer) => {
    const [bx, by, bz] = printer.bed;
    const margin = 2;
    const flat = (x + margin <= bx && y + margin <= by) || (y + margin <= bx && x + margin <= by);
    return flat && z + margin <= bz;
  };
  return PRINTERS.filter(fits);
}

/** `true` quando a peça não cabe na mesa da impressora escolhida. */
export function exceedsBed(printer, { x = 0, y = 0, z = 0 }) {
  if (!printer) return false;
  return !printersThatFit({ x, y, z }).some((p) => p.id === printer.id);
}

export default PRINTERS;
