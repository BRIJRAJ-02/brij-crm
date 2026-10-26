// The pass's own ground (the owner, 26 October 2026): a soft mesh of colour behind the whole pass, which is how
// Apple's own user passes look and what the owner asked this one to look like.
//
// Drawn here rather than by the web project's picture function, which is where the share card and the old band
// are drawn. A gradient needs no font, no layout engine and no text measuring, so it needs none of what lives
// over there — and drawing it here means the pass costs no outside request, no two second timeout and no way to
// half fail. A pass either has its ground or the build threw.
//
// It is a plain PNG written by hand: Node has zlib, and the rest of a PNG is three chunks and a CRC. Reaching for
// an image library to lay down a gradient would be a dependency guarding nothing.
import { deflateSync } from 'node:zlib';

/** Apple draws the background at 180 x 220 points. These are the @3x pixels, as Apple's own passes ship them. */
export const BACKGROUND_WIDTH = 1074;
export const BACKGROUND_HEIGHT = 1509;

/** One colour of the mesh, placed in the frame by a fraction of its width and height. */
interface Blob {
  readonly x: number;
  readonly y: number;
  readonly rgb: readonly [number, number, number];
}

/**
 * The mesh, sampled from the ground Apple's own Wallet draws behind a user pass (the owner, 26 October 2026,
 * "rebuild same orange"): a warm red around the whole edge with gold gathering through the middle and falling to
 * the lower half. The barcode sits over the lower middle, where the gold is lightest, which is what keeps a black
 * code readable on it.
 */
const BLOBS: readonly Blob[] = [
  { x: 0.0, y: 0.0, rgb: [207, 69, 67] },
  { x: 1.0, y: 0.0, rgb: [207, 69, 67] },
  { x: 0.0, y: 0.5, rgb: [237, 105, 67] },
  { x: 1.0, y: 0.5, rgb: [238, 120, 61] },
  { x: 0.5, y: 0.46, rgb: [244, 183, 37] },
  { x: 0.86, y: 0.62, rgb: [244, 182, 39] },
  { x: 0.5, y: 0.95, rgb: [207, 153, 33] },
  { x: 0.0, y: 1.0, rgb: [203, 92, 56] },
  { x: 1.0, y: 1.0, rgb: [201, 74, 62] },
];

/**
 * How coarsely the mesh is really worked out. A mesh of this kind has no detail to lose, so it is computed on a
 * small grid and read back smoothly, which costs a fraction of the pixels and looks the same. Below about 24 the
 * corners start to show the grid's own shape.
 */
const GRID = 48;

/** Inverse distance weighting, the usual way a mesh gradient is made: every blob pulls, the nearest pulls most. */
function meshAt(u: number, v: number): readonly [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (const blob of BLOBS) {
    const dx = u - blob.x;
    const dy = v - blob.y;
    // The floor keeps a pixel sitting exactly on a blob from dividing by nothing, and softens every centre.
    const spread = dx * dx + dy * dy + 0.035;
    const weight = 1 / (spread * spread);
    r += blob.rgb[0] * weight;
    g += blob.rgb[1] * weight;
    b += blob.rgb[2] * weight;
    total += weight;
  }
  return [r / total, g / total, b / total];
}

/** The CRC-32 table PNG asks for, built once. */
const CRC_TABLE = Int32Array.from({ length: 256 }, (_unused, index) => {
  let c = index;
  for (let bit = 0; bit < 8; bit += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** CRC-32 of one chunk's type and data, which is what a PNG chunk ends with. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: its length, its four letter type, its data, and the CRC over the type and the data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set(new TextEncoder().encode(type), 0);
  body.set(data, 4);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/** The scanlines as a PNG: 8 bit colour, no alpha, filter 0 on every row (the picture is smooth, so it buys little). */
function toPng(width: number, height: number, raw: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bits per channel
  header[9] = 2; // colour, no alpha
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/** The mesh at any size, as a PNG. */
export function passBackgroundAt(width: number, height: number): Uint8Array {
  const grid = new Float64Array(GRID * GRID * 3);
  for (let gy = 0; gy < GRID; gy += 1) {
    for (let gx = 0; gx < GRID; gx += 1) {
      const [r, g, b] = meshAt(gx / (GRID - 1), gy / (GRID - 1));
      const at = (gy * GRID + gx) * 3;
      grid[at] = r;
      grid[at + 1] = g;
      grid[at + 2] = b;
    }
  }
  // Read back smoothly: each pixel is the four grid points around it, mixed by how far it sits between them.
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const fy = (y / (height - 1)) * (GRID - 1);
    const y0 = Math.min(Math.floor(fy), GRID - 2);
    const ty = fy - y0;
    const row = y * stride + 1;
    for (let x = 0; x < width; x += 1) {
      const fx = (x / (width - 1)) * (GRID - 1);
      const x0 = Math.min(Math.floor(fx), GRID - 2);
      const tx = fx - x0;
      for (let channel = 0; channel < 3; channel += 1) {
        const at = (y0 * GRID + x0) * 3 + channel;
        // Every read is inside the grid by construction; `?? 0` is how that is said without a non null claim.
        const top = (grid[at] ?? 0) * (1 - tx) + (grid[at + 3] ?? 0) * tx;
        const bottom = (grid[at + GRID * 3] ?? 0) * (1 - tx) + (grid[at + GRID * 3 + 3] ?? 0) * tx;
        raw[row + x * 3 + channel] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return toPng(width, height, raw);
}

/** The ground at @3x, as Apple's own passes ship it. */
export function passBackground(): Uint8Array {
  return passBackgroundAt(BACKGROUND_WIDTH, BACKGROUND_HEIGHT);
}

/** The same ground at @2x, which Apple also asks for. */
export function passBackground2x(): Uint8Array {
  return passBackgroundAt(Math.round(BACKGROUND_WIDTH / 1.5), Math.round(BACKGROUND_HEIGHT / 1.5));
}
