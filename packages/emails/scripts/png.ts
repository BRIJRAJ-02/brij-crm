// Just enough PNG to recolour the wordmark: read an 8 bit RGBA, non
// interlaced file (what apps/web/public/brand holds), and write one back.
// Node's zlib does the compression, so there is no image library to pin.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** An image as straight RGBA bytes, four per pixel, row after row. */
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** The Paeth predictor (PNG's filter type 4). */
function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/** Reads a PNG that is 8 bit RGBA and not interlaced; anything else throws. */
export function decodePng(file: Uint8Array): Rgba {
  const bytes = Buffer.from(file);
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file.');
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const kind = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || colour !== 6 || interlace !== 0) throw new Error('Only 8 bit RGBA, non interlaced PNGs.');
    } else if (kind === 'IDAT') {
      data.push(body);
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? (pixels[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= 4 && y > 0 ? (pixels[(y - 1) * stride + x - 4] ?? 0) : 0;
      const value = line[x] ?? 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, upLeft);
      pixels[y * stride + x] = (value + predicted) & 0xff;
    }
  }
  return { width, height, pixels };
}

/** One PNG chunk: its length, type, data and CRC. */
function chunk(kind: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(kind, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

/** Writes an RGBA image as an 8 bit RGBA PNG, every row unfiltered, compressed hard. */
export function encodePng(image: Rgba): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const stride = image.width * 4;
  const raw = Buffer.alloc(image.height * (stride + 1));
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(image.pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The image in one colour (`#rrggbb`), its shape kept by the alpha channel. */
export function recolour(image: Rgba, hex: string): Rgba {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`${hex} isn't a #rrggbb colour.`);
  const [red, green, blue] = [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? '0', 16));
  const pixels = new Uint8Array(image.pixels);
  for (let at = 0; at < pixels.length; at += 4) {
    // A fully clear pixel keeps no colour, so the file compresses as well as the source.
    const clear = pixels[at + 3] === 0;
    pixels[at] = clear ? 0 : (red ?? 0);
    pixels[at + 1] = clear ? 0 : (green ?? 0);
    pixels[at + 2] = clear ? 0 : (blue ?? 0);
  }
  return { width: image.width, height: image.height, pixels };
}
