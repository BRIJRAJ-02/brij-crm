// What an uploaded picture says besides itself (27 Oct 2026), taken out before it is kept. The web app's canvas
// already leaves a phone's location and camera behind (`apps/web`, `photo.ts`); a caller that skipped it, a script
// with a session or a later client, must not be able to put GPS on a public page either. So the server walks the
// file's own structure and keeps only what draws the picture:
// - JPEG: every segment up to the scan, less APP1 to APP15 (EXIF, XMP, maker notes, Photoshop's) and comments,
//   keeping APP0 (JFIF) and the colour profile (APP2 `ICC_PROFILE`) and Adobe's APP14, which change how it draws.
// - PNG: every chunk less text (`tEXt`, `zTXt`, `iTXt`), `eXIf` and `tIME`.
// - WebP: every chunk less `EXIF` and `XMP `, with VP8X's two flags for them cleared and RIFF's size made again.
// A file whose structure doesn't hold together is refused (undefined), never kept as it came.

/** JPEG markers kept although they are APPn: the colour profile and Adobe's colour transform. */
const KEPT_APP = new Set([0xe2, 0xee]);

/** PNG chunks that carry words, a time or EXIF, and never pixels. */
const PNG_DROPPED = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

/** WebP chunks that carry metadata. */
const WEBP_DROPPED = new Set(['EXIF', 'XMP ']);

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/** Joins pieces into one array. */
function join(pieces: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.byteLength, 0));
  let at = 0;
  for (const piece of pieces) {
    out.set(piece, at);
    at += piece.byteLength;
  }
  return out;
}

function stripJpeg(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.byteLength) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // The scan: everything from here on is the picture itself.
    if (marker === 0xda) {
      kept.push(bytes.subarray(at));
      return join(kept);
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    if (length < 2 || at + 2 + length > bytes.byteLength) return undefined;
    const segment = bytes.subarray(at, at + 2 + length);
    const isApp = marker >= 0xe1 && marker <= 0xef;
    const isProfile = marker === 0xe2 && ascii(segment, 4, 12) === 'ICC_PROFILE\0';
    const dropped = marker === 0xfe || (isApp && !(KEPT_APP.has(marker) && (marker !== 0xe2 || isProfile)));
    if (!dropped) kept.push(segment);
    at += 2 + length;
  }
  return undefined;
}

function stripPng(bytes: Uint8Array): Uint8Array | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.byteLength) {
    const length = view.getUint32(at);
    const end = at + 12 + length;
    if (end > bytes.byteLength) return undefined;
    const type = ascii(bytes, at + 4, 4);
    if (!PNG_DROPPED.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') return join(kept);
  }
  return undefined;
}

function stripWebp(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = 8 + view.getUint32(4, true);
  if (riffEnd > bytes.byteLength) return undefined;
  const kept: Uint8Array[] = [];
  let at = 12;
  while (at + 8 <= riffEnd) {
    const fourcc = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size + (size % 2);
    if (end > riffEnd) return undefined;
    if (fourcc === 'VP8X') {
      const chunk = bytes.slice(at, end);
      // Bits 3 (EXIF) and 2 (XMP) of its flags byte: what is left carries neither.
      chunk[8] = (chunk[8] ?? 0) & ~0x0c;
      kept.push(chunk);
    } else if (!WEBP_DROPPED.has(fourcc)) {
      kept.push(bytes.subarray(at, end));
    }
    at = end;
  }
  if (at !== riffEnd) return undefined;
  const body = join(kept);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, 4 + body.byteLength, true);
  return join([header, body]);
}

/**
 * The picture with its metadata taken out, by its sniffed type, or undefined when its structure doesn't hold
 * together. Never mutates `bytes`.
 */
export function stripPictureMetadata(sniff: string, bytes: Uint8Array): Uint8Array | undefined {
  if (sniff === 'jpeg') return stripJpeg(bytes);
  if (sniff === 'png') return stripPng(bytes);
  if (sniff === 'webp') return stripWebp(bytes);
  return undefined;
}
