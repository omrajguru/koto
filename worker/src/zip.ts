/**
 * The pieces of a stored (uncompressed) zip, so the backup download can stream straight from
 * R2 without holding files in memory or computing checksums. Each file's CRC-32 is worked out
 * while it is uploaded (backup.ts) and kept in its R2 metadata.
 *
 * Stored, not compressed: WAV audio barely compresses, and storing keeps the Worker's CPU
 * time per request tiny. No ZIP64, so a backup must stay under 4 GB (BACKUP_QUOTA_BYTES).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** Continues a CRC-32 over more bytes. Start with 0. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the zip, UTF-8. */
  path: string;
  size: number;
  crc: number;
  modified: Date;
}

const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;
/** Bit 11: file names are UTF-8. */
const UTF8_FLAG = 0x0800;

function encodePath(path: string): Uint8Array {
  return new TextEncoder().encode(path);
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

export function localHeader(entry: ZipEntry): Uint8Array {
  const name = encodePath(entry.path);
  const header = new Uint8Array(LOCAL_HEADER_BYTES + name.length);
  const view = new DataView(header.buffer);
  const { time, day } = dosDateTime(entry.modified);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, day, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.size, true);
  view.setUint32(22, entry.size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  header.set(name, LOCAL_HEADER_BYTES);
  return header;
}

/** Central directory and end record, written after every file. */
export function directory(entries: ZipEntry[]): Uint8Array {
  const names = entries.map(entry => encodePath(entry.path));
  const centralBytes = names.reduce((total, name) => total + CENTRAL_HEADER_BYTES + name.length, 0);
  const output = new Uint8Array(centralBytes + END_RECORD_BYTES);
  const view = new DataView(output.buffer);
  let position = 0;
  let offset = 0;
  entries.forEach((entry, index) => {
    const name = names[index];
    const { time, day } = dosDateTime(entry.modified);
    view.setUint32(position, 0x02014b50, true);
    view.setUint16(position + 4, 20, true);
    view.setUint16(position + 6, 20, true);
    view.setUint16(position + 8, UTF8_FLAG, true);
    view.setUint16(position + 10, 0, true);
    view.setUint16(position + 12, time, true);
    view.setUint16(position + 14, day, true);
    view.setUint32(position + 16, entry.crc, true);
    view.setUint32(position + 20, entry.size, true);
    view.setUint32(position + 24, entry.size, true);
    view.setUint16(position + 28, name.length, true);
    // Extra field, comment, disk number, internal and external attributes: none.
    view.setUint32(position + 42, offset, true);
    output.set(name, position + CENTRAL_HEADER_BYTES);
    position += CENTRAL_HEADER_BYTES + name.length;
    offset += LOCAL_HEADER_BYTES + name.length + entry.size;
  });
  view.setUint32(position, 0x06054b50, true);
  view.setUint16(position + 8, entries.length, true);
  view.setUint16(position + 10, entries.length, true);
  view.setUint32(position + 12, centralBytes, true);
  view.setUint32(position + 16, offset, true);
  return output;
}

/** Total size of the zip, known before streaming starts so the browser can show progress. */
export function zipSize(entries: ZipEntry[]): number {
  return entries.reduce(
    (total, entry) => total + LOCAL_HEADER_BYTES + CENTRAL_HEADER_BYTES + 2 * encodePath(entry.path).length + entry.size,
    END_RECORD_BYTES,
  );
}
