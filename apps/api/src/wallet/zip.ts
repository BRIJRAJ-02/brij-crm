// A `.pkpass` is a zip, and this is the smallest zip writer that makes one (26 October 2026). Written here rather
// than taken as a dependency: a pass holds five small files, none worth compressing, so the whole format we need is
// the stored (uncompressed) entry, and a zip library would be a few hundred kilobytes in the function for that.
//
// Stored entries only, no directories, no zip64, no data descriptors: a pass is a handful of files far under 4 GB,
// and every one of those features exists for cases a pass never has. Names are plain ASCII (`pass.json`,
// `icon@2x.png`), so there is no encoding flag to set.
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

/** One file in the archive. */
export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** CRC-32, which every zip entry carries; the table is built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** The CRC-32 of some bytes, as the zip header wants it. */
export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  // The table has all 256 entries, so the fallback is never taken; it is here because the index type can't say so.
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** The SHA-1 of some bytes as lowercase hex, which is what a pass's manifest lists. */
export function sha1(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

/** Deflate when it actually helps; a tiny file often grows, and then it is stored as it is. */
function packed(bytes: Uint8Array): { readonly method: number; readonly body: Uint8Array } {
  if (bytes.byteLength === 0) return { method: 0, body: bytes };
  const deflated = deflateRawSync(bytes);
  return deflated.byteLength < bytes.byteLength ? { method: 8, body: deflated } : { method: 0, body: bytes };
}

/**
 * The entries as one zip. Every file keeps the same order in the central directory as in the body, which is what
 * a reader walks. Times are fixed at zero (1980-01-01): a pass is made fresh on every request, so a real time
 * would make two identical passes different files for no reader's benefit.
 */
export function makeZip(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'ascii');
    const { method, body } = packed(entry.bytes);
    const crc = crc32(entry.bytes);

    const local = Buffer.alloc(30 + name.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // the version needed: 2.0, which is deflate
    local.writeUInt16LE(0, 6); // no flags: no encryption, no data descriptor
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(entry.bytes.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28); // no extra field
    name.copy(local, 30);

    const header = Buffer.alloc(46 + name.byteLength);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // made by
    header.writeUInt16LE(20, 6); // needed to extract
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.byteLength, 20);
    header.writeUInt32LE(entry.bytes.byteLength, 24);
    header.writeUInt16LE(name.byteLength, 28);
    header.writeUInt16LE(0, 30); // extra
    header.writeUInt16LE(0, 32); // comment
    header.writeUInt16LE(0, 34); // the disk it starts on
    header.writeUInt16LE(0, 36); // internal attributes
    header.writeUInt32LE(0, 38); // external attributes
    header.writeUInt32LE(offset, 42);
    name.copy(header, 46);

    locals.push(local, body);
    central.push(header);
    offset += local.byteLength + body.byteLength;
  }

  const directory = Buffer.concat(central.map((part) => Buffer.from(part)));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // the disk the directory starts on
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // no comment
  return Uint8Array.from(Buffer.concat([...locals.map((part) => Buffer.from(part)), directory, end]));
}
