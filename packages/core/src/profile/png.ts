// A PNG writer, just enough for the one picture this repo draws by hand: the gradient behind a Wallet pass.
// Truecolour, 8 bits a channel, no alpha, one IDAT deflated by `node:zlib`. Written here rather than with an
// image library because the only picture it ever makes is a few hundred pixels of smooth colour, and because a
// Vercel Function should not carry a native image dependency to draw one.
import { deflateSync } from 'node:zlib';
import { crc32 } from './zip.ts';

/** One chunk: length, type, data, CRC-32 over the type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  out.set(typed, 4);
  out.set(data, 8);
  const sum = crc32(out.subarray(4, 8 + data.byteLength));
  view.setUint32(8 + data.byteLength, sum);
  return out;
}

/** PNG's first eight bytes, the same in every file. */
const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/**
 * A truecolour PNG from a function that gives each pixel its three channels. Every row is written with filter 0
 * (none): the picture is a gradient, so a filter would save little and cost clarity here.
 */
export function writePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number],
): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3));
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at] = 0;
    at += 1;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixel(x, y);
      raw[at] = Math.max(0, Math.min(255, Math.round(red)));
      raw[at + 1] = Math.max(0, Math.min(255, Math.round(green)));
      raw[at + 2] = Math.max(0, Math.min(255, Math.round(blue)));
      at += 3;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  // The last three are the compression, filter and interlace methods, each with one value: 0.
  const parts = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
