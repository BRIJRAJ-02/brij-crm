// A zip archive, written by hand: a `.pkpass` is a zip, and the only one this repo ever makes. Stored entries
// only (no compression), which Wallet reads and which keeps this to the two headers and the directory below, and
// deterministic: the same files in the same order give the same bytes, so a test can pin them.
//
// What it leaves out, on purpose: compression, zip64 (a pass is kilobytes), directories, extra fields and
// anything to do with a time zone (every entry is stamped with the same fixed DOS time, see `DOS_STAMP`).

/** One file in the archive: the name a reader sees, and its bytes. */
export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Stored, not deflated: the only method `writeZip` writes, and the one every zip reader has always had. */
const STORED = 0;

/**
 * The timestamp every entry carries: 1 January 1980, 00:00, the earliest a DOS stamp can hold. A pass's bytes say
 * nothing about when it was made, so the same card downloaded twice is the same file, byte for byte.
 */
const DOS_STAMP = { time: 0, date: 0b0000_0000_0010_0001 } as const;

/** The CRC-32 table, built once: the polynomial zip has used since 1989 (0xedb88320, reflected). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** The CRC-32 of some bytes, as zip stores it. */
export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ (CRC_TABLE[(value ^ byte) & 0xff] ?? 0);
  return (value ^ 0xffffffff) >>> 0;
}

/** A little endian writer: zip is little endian throughout. */
function bytesOf(parts: readonly (readonly [size: 2 | 4, value: number])[]): Uint8Array {
  const total = parts.reduce((sum, [size]) => sum + size, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [size, value] of parts) {
    if (size === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
    at += size;
  }
  return out;
}

/** Every piece joined into one array. */
function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * The entries as one zip archive. Names are written as UTF-8 with the language encoding flag set, so a name
 * outside ASCII still reads correctly, though every name a pass carries is ASCII today.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const sum = crc32(entry.bytes);
    const size = entry.bytes.byteLength;
    const header = join([
      bytesOf([
        [4, 0x04034b50],
        [2, 20], // the version that reads it: 2.0, which stored entries have always needed
        [2, 0x0800], // the name is UTF-8
        [2, STORED],
        [2, DOS_STAMP.time],
        [2, DOS_STAMP.date],
        [4, sum],
        [4, size],
        [4, size],
        [2, name.byteLength],
        [2, 0], // no extra field
      ]),
      name,
    ]);
    local.push(header, entry.bytes);
    central.push(
      join([
        bytesOf([
          [4, 0x02014b50],
          [2, 20], // made by: 2.0, MS-DOS, which is what a pass's reader expects
          [2, 20],
          [2, 0x0800],
          [2, STORED],
          [2, DOS_STAMP.time],
          [2, DOS_STAMP.date],
          [4, sum],
          [4, size],
          [4, size],
          [2, name.byteLength],
          [2, 0], // no extra field
          [2, 0], // no comment
          [2, 0], // the one disk
          [2, 0], // no internal attributes
          [4, 0], // no external attributes
          [4, offset],
        ]),
        name,
      ]),
    );
    offset += header.byteLength + size;
  }
  const directory = join(central);
  return join([
    ...local,
    directory,
    bytesOf([
      [4, 0x06054b50],
      [2, 0], // the one disk
      [2, 0],
      [2, entries.length],
      [2, entries.length],
      [4, directory.byteLength],
      [4, offset],
      [2, 0], // no archive comment
    ]),
  ]);
}
