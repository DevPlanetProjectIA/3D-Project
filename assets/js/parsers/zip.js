/*
 * Leitor de ZIP suficiente para containers 3MF (OPC).
 *
 * Lê o diretório central, não a sequência de cabeçalhos locais, e descomprime
 * com `DecompressionStream('deflate-raw')` — nativo, sem dependências.
 */

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;

const decoder = new TextDecoder('utf-8');

/** Localiza o End Of Central Directory varrendo o fim do arquivo. */
function findEOCD(view) {
  const maxComment = 0xffff + 22;
  const start = Math.max(0, view.byteLength - maxComment);
  for (let offset = view.byteLength - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) === SIG_EOCD) return offset;
  }
  throw new Error('Arquivo não é um ZIP válido (assinatura final ausente).');
}

/** Resolve os campos do diretório central, inclusive em arquivos ZIP64. */
function readDirectoryInfo(view, eocd) {
  let entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  const needsZip64 = entries === 0xffff || offset === 0xffffffff;
  if (!needsZip64) return { entries, offset };

  // Localizador ZIP64 fica imediatamente antes do EOCD clássico.
  const locator = eocd - 20;
  if (locator < 0 || view.getUint32(locator, true) !== SIG_EOCD64_LOCATOR) {
    throw new Error('ZIP64 sem localizador válido.');
  }
  const eocd64 = Number(view.getBigUint64(locator + 8, true));
  if (view.getUint32(eocd64, true) !== SIG_EOCD64) throw new Error('ZIP64 malformado.');
  entries = Number(view.getBigUint64(eocd64 + 32, true));
  offset = Number(view.getBigUint64(eocd64 + 48, true));
  return { entries, offset };
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Este navegador não suporta DecompressionStream; não é possível abrir arquivos 3MF comprimidos.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Lê o índice do ZIP. Devolve `{ entries, get(name), find(predicate) }`.
 * Os dados só são descomprimidos quando pedidos.
 */
export function openZip(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const eocd = findEOCD(view);
  const { entries: total, offset: cdStart } = readDirectoryInfo(view, eocd);

  const entries = [];
  let cursor = cdStart;
  for (let i = 0; i < total; i++) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));

    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  async function readEntry(entry) {
    if (!entry) throw new Error('Entrada não encontrada no ZIP.');
    const lo = entry.localOffset;
    if (view.getUint32(lo, true) !== SIG_LOCAL) throw new Error(`Cabeçalho local inválido para "${entry.name}".`);
    const nameLen = view.getUint16(lo + 26, true);
    const extraLen = view.getUint16(lo + 28, true);
    const dataStart = lo + 30 + nameLen + extraLen;
    const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) return raw.slice();
    if (entry.method === 8) return inflateRaw(raw);
    throw new Error(`Método de compressão ${entry.method} não suportado.`);
  }

  const normalize = (name) => String(name).replace(/^\/+/, '').toLowerCase();

  return {
    entries,
    names: () => entries.map((e) => e.name),
    find(predicate) { return entries.find(predicate) || null; },
    async get(name) {
      const target = normalize(name);
      return readEntry(entries.find((e) => normalize(e.name) === target));
    },
    async text(name) {
      return decoder.decode(await this.get(name));
    },
    async readEntryText(entry) {
      return decoder.decode(await readEntry(entry));
    },
    readEntry,
  };
}

export default openZip;
