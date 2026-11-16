// Opens and writes zip files using only what a browser already has.
//
// In plain words: an .xlsx workbook is a zip file holding small text files. To change a workbook
// without sending it anywhere, the page has to open that zip and write a new one itself. This file
// does both, with no outside code. A part that is not changed is copied across byte for byte.

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Lists the parts of a zip. Each part keeps its packed bytes; nothing is unpacked until asked. */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error('This is not a workbook: it is too short to be one.');
  let end = bytes.length - 22;
  const stop = Math.max(0, end - 65535);
  while (end >= stop && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < stop) throw new Error('This is not a workbook, or the file was cut short.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error('This tool does not read files over 4 GB.');
  const parts = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('The file is damaged: its list of parts cannot be read.');
    const flags = view.getUint16(at + 8, true);
    if (flags & 1) throw new Error('The file is locked with a password.');
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    parts.push({ name, method, crc, size, packed: bytes.subarray(start, start + packedSize) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return parts;
}

async function through(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** The unpacked bytes of one part. */
export async function unpack(part) {
  if (part.data) return part.data;
  if (part.method === 0) return part.packed;
  if (part.method === 8) return through(part.packed, new DecompressionStream('deflate-raw'));
  throw new Error(`The part ${part.name} is packed in a way this tool does not read.`);
}

/** One part as text. Parts of a workbook are UTF-8; a few custom parts are UTF-16 and say so with a mark. */
export async function text(part) {
  const bytes = await unpack(part);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return decoder.decode(bytes);
}

let table;
function crc32(bytes) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Writes a zip. A part with `data` (bytes) or `text` is packed afresh; a part without either is
 * copied across exactly as it was read.
 */
export async function writeZip(parts) {
  const ready = [];
  for (const part of parts) {
    let { method, crc, size, packed } = part;
    const fresh = part.text !== undefined ? encoder.encode(part.text) : part.data;
    if (fresh) {
      crc = crc32(fresh);
      size = fresh.length;
      method = 8;
      packed = await through(fresh, new CompressionStream('deflate-raw'));
    }
    ready.push({ name: part.name, method, crc, size, packed });
  }
  return assemble(ready);
}

/**
 * Writes a small zip at once, without waiting: each part, given as `text` or `data`, is stored as
 * it is, not packed. For a file of a few small parts, such as a legend.
 */
export function storeZip(parts) {
  return assemble(
    parts.map((part) => {
      const fresh = part.text !== undefined ? encoder.encode(part.text) : part.data;
      return { name: part.name, method: 0, crc: crc32(fresh), size: fresh.length, packed: fresh };
    }),
  );
}

/** Puts parts that are already packed together into one zip file. */
function assemble(ready) {
  const chunks = [];
  const listed = [];
  let offset = 0;
  for (const part of ready) {
    const { method, crc, size, packed } = part;
    const name = encoder.encode(part.name);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // names are UTF-8
    head.setUint16(8, method, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, 0x21, true); // 1 January 1980: the file carries no clock time of its own
    head.setUint32(14, crc, true);
    head.setUint32(18, packed.length, true);
    head.setUint32(22, size, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    chunks.push(new Uint8Array(head.buffer), name, packed);
    listed.push({ name, method, crc, size, packedSize: packed.length, offset });
    offset += 30 + name.length + packed.length;
  }
  const listStart = offset;
  for (const item of listed) {
    const row = new DataView(new ArrayBuffer(46));
    row.setUint32(0, 0x02014b50, true);
    row.setUint16(4, 20, true);
    row.setUint16(6, 20, true);
    row.setUint16(8, 0x0800, true);
    row.setUint16(10, item.method, true);
    row.setUint16(12, 0, true);
    row.setUint16(14, 0x21, true);
    row.setUint32(16, item.crc, true);
    row.setUint32(20, item.packedSize, true);
    row.setUint32(24, item.size, true);
    row.setUint16(28, item.name.length, true);
    row.setUint32(42, item.offset, true);
    chunks.push(new Uint8Array(row.buffer), item.name);
    offset += 46 + item.name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, listed.length, true);
  end.setUint16(10, listed.length, true);
  end.setUint32(12, offset - listStart, true);
  end.setUint32(16, listStart, true);
  chunks.push(new Uint8Array(end.buffer));
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
