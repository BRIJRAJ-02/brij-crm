// A pass's icon (26 October 2026). Apple refuses a `.pkpass` with no `icon.png`, and shows it beside the pass in
// the wallet's list, so it is not optional and not decorative.
//
// It is drawn here rather than read off the disk on purpose: the card function already taught us that anything a
// Vercel function reads at run time has to be a static import or the file trace leaves it behind
// (`apps/web/AGENTS.md`). A solid rounded square in the brand's ink has no such problem, costs a few hundred
// bytes, and is the same on every deploy. A drawn mark can replace it later by returning different pixels here.
import { crc32 } from './zip.ts';
import { deflateSync } from 'node:zlib';

/** The pass's ink, the same near black the share card is drawn on. */
const INK: readonly [number, number, number] = [17, 17, 19];
/** The accent the corner mark is drawn in. */
const ACCENT: readonly [number, number, number] = [88, 101, 242];

/** One PNG chunk: its length, its type, its bytes and their CRC. */
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.byteLength, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(body)])), 0);
  return Buffer.concat([head, Buffer.from(body), crc]);
}

/**
 * A square icon `size` across: the brand's ink, its corners cut, and the accent as a bar across the lower third,
 * which reads as a mark at 29 pixels without pretending to be the wordmark. 8 bit RGBA, no interlacing.
 */
export function passIcon(size: number): Uint8Array {
  const radius = Math.round(size * 0.22);
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    // Each scanline is prefixed with its filter type; 0 is none, which is all a flat picture needs.
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      // The corners: inside the rounded rectangle, or transparent.
      const nearX = x < radius ? radius - x : x >= size - radius ? x - (size - radius) + 1 : 0;
      const nearY = y < radius ? radius - y : y >= size - radius ? y - (size - radius) + 1 : 0;
      const outside = nearX > 0 && nearY > 0 && nearX * nearX + nearY * nearY > radius * radius;
      const bar = y >= Math.round(size * 0.62) && y < Math.round(size * 0.74) && x >= radius && x < size - radius;
      const [r, g, b] = bar ? ACCENT : INK;
      const at = 1 + x * 4;
      row[at] = r;
      row[at + 1] = g;
      row[at + 2] = b;
      row[at + 3] = outside ? 0 : 255;
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // 8 bits a channel
  header.writeUInt8(6, 9); // RGBA
  header.writeUInt8(0, 10); // deflate
  header.writeUInt8(0, 11); // the one filter method
  header.writeUInt8(0, 12); // not interlaced
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.concat(rows))),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
}

/** The two Apple asks for, drawn once per instance: 29 points, at one and two pixels to the point. */
let drawn: { readonly icon: Uint8Array; readonly icon2x: Uint8Array } | undefined;
export function passIcons(): { readonly icon: Uint8Array; readonly icon2x: Uint8Array } {
  drawn ??= { icon: passIcon(29), icon2x: passIcon(58) };
  return drawn;
}
