// A link page's pictures (spec 0061, AC-6101, AC-6108, AC-6128): what a picture's own first bytes say it is, its
// size, and its bytes with the metadata a camera writes taken out, so no location leaves with a photo. Every picture
// the page stores comes through `checkProfileImage`, whether a person uploaded it or our server read it from a site
// (a thumbnail, a poster). JPEG, PNG and WebP only: SVG is a document that can carry script, and GIF is refused too.
//
// Pure: bytes in, bytes out. Nothing here decodes pixels; it walks each format's own segments and keeps the ones a
// picture needs to draw, which is why it can run on every upload in a request.
import { PROFILE_IMAGE_MAX_BYTES, type ProfileImageType } from '@crm/contracts';

/** The longest side a stored picture may have: the database's own check alike. */
export const PROFILE_IMAGE_MAX_SIDE = 4096;

/** A picture as kept: its type by its bytes, its size, and its bytes with the metadata taken out. */
export interface CheckedImage {
  readonly ok: true;
  readonly type: ProfileImageType;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8Array;
}

/** Why a picture is refused: not one of the three types, too big, or a file that doesn't hold together. */
export type ImageRefusal = { readonly ok: false; readonly reason: 'type' | 'size' | 'shape' };

/** The extension a stored picture's path takes. */
export function imageExtension(type: ProfileImageType): 'jpg' | 'png' | 'webp' {
  if (type === 'image/jpeg') return 'jpg';
  return type === 'image/png' ? 'png' : 'webp';
}

/** The type `bytes` begin as among the three a link page stores, or undefined (an SVG, a GIF, anything else). */
export function profileImageTypeOf(bytes: Uint8Array): ProfileImageType | undefined {
  const at = (offset: number, ...expected: readonly number[]) =>
    expected.every((byte, index) => bytes[offset + index] === byte);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return undefined;
}

const u16be = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const u32be = (bytes: Uint8Array, at: number) => (u16be(bytes, at) * 65536 + u16be(bytes, at + 2)) >>> 0;
const u16le = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
const u24le = (bytes: Uint8Array, at: number) => u16le(bytes, at) | ((bytes[at + 2] ?? 0) << 16);
const u32le = (bytes: Uint8Array, at: number) => (u16le(bytes, at) + u16le(bytes, at + 2) * 65536) >>> 0;

/** A picture's bytes and size once its metadata is out, or undefined when its segments don't hold together. */
interface Stripped {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * A JPEG without its APP1 to APP15 segments (EXIF and its GPS, XMP, ICC, maker notes) and comments, keeping APP0
 * (JFIF) and everything that draws. From the start of scan the rest is copied whole: it is the picture itself.
 */
function stripJpeg(bytes: Uint8Array): Stripped | undefined {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  let width = 0;
  let height = 0;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1] ?? 0;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers with no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    const length = u16be(bytes, at + 2);
    if (length < 2 || at + 2 + length > bytes.length) return undefined;
    const segment = bytes.subarray(at, at + 2 + length);
    // Start of frame (not DHT C4, JPG C8 or DAC CC): the picture's height and width.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = u16be(bytes, at + 5);
      width = u16be(bytes, at + 7);
    }
    if (marker === 0xda) {
      // The scan header, then its entropy coded data up to the next marker: a stuffed `FF 00`, a restart marker and
      // fill bytes are part of the scan. Past it is either the end of the picture, after which nothing is kept (a
      // phone may append a second picture with its own EXIF there), or the next segment of a progressive JPEG,
      // which goes through the same rule as any other.
      kept.push(segment);
      let end = at + 2 + length;
      while (end + 1 < bytes.length) {
        const next = bytes[end + 1] ?? 0;
        if (bytes[end] === 0xff && next !== 0x00 && next !== 0xff && !(next >= 0xd0 && next <= 0xd7)) break;
        end += 1;
      }
      if (end + 1 >= bytes.length) return undefined;
      kept.push(bytes.subarray(at + 2 + length, end));
      if (bytes[end + 1] === 0xd9) {
        kept.push(bytes.subarray(end, end + 2));
        return width > 0 && height > 0 ? { bytes: Buffer.concat(kept), width, height } : undefined;
      }
      at = end;
      continue;
    }
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) kept.push(segment);
    at += 2 + length;
  }
  return undefined;
}

/**
 * The PNG chunks a picture needs to draw, and nothing else: text, `eXIf`, time and every private or unknown chunk
 * go, whatever they carry.
 */
const PNG_KEPT = new Set([
  'IHDR',
  'PLTE',
  'IDAT',
  'IEND',
  'tRNS',
  'gAMA',
  'cHRM',
  'sRGB',
  'iCCP',
  'pHYs',
  'sBIT',
  'acTL',
  'fcTL',
  'fdAT',
]);

/** A PNG without its text, `eXIf` and time chunks, every chunk's length checked. */
function stripPng(bytes: Uint8Array): Stripped | undefined {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  let width = 0;
  let height = 0;
  let ended = false;
  while (at + 12 <= bytes.length) {
    const length = u32be(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) return undefined;
    if (type === 'IHDR') {
      width = u32be(bytes, at + 8);
      height = u32be(bytes, at + 12);
    }
    if (PNG_KEPT.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  return ended && width > 0 && height > 0 ? { bytes: Buffer.concat(kept), width, height } : undefined;
}

/** The WebP chunks a picture needs to draw; EXIF, XMP and anything else go. */
const WEBP_KEPT = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

/** A WebP without its `EXIF` and `XMP ` chunks, the extended header's flags for them cleared and the size made again. */
function stripWebp(bytes: Uint8Array): Stripped | undefined {
  const declared = u32le(bytes, 4);
  if (declared + 8 > bytes.length || declared < 4) return undefined;
  const kept: Uint8Array[] = [];
  let at = 12;
  let width = 0;
  let height = 0;
  const end = 8 + declared;
  while (at + 8 <= end) {
    const fourcc = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = u32le(bytes, at + 4);
    const next = at + 8 + size + (size % 2);
    if (at + 8 + size > end) return undefined;
    const data = bytes.subarray(at + 8, at + 8 + size);
    if (fourcc === 'VP8X' && size >= 10) {
      width = u24le(data, 4) + 1;
      height = u24le(data, 7) + 1;
      const header = Uint8Array.from(bytes.subarray(at, Math.min(next, end)));
      // Bit 3 is EXIF and bit 2 XMP: neither is here any more.
      header[8] = (header[8] ?? 0) & ~0x0c;
      kept.push(header);
    } else if (!WEBP_KEPT.has(fourcc)) {
      // EXIF, XMP and anything unknown: taken out.
    } else {
      if (fourcc === 'VP8 ' && width === 0 && size >= 10) {
        if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return undefined;
        width = u16le(data, 6) & 0x3fff;
        height = u16le(data, 8) & 0x3fff;
      }
      if (fourcc === 'VP8L' && width === 0 && size >= 5) {
        if (data[0] !== 0x2f) return undefined;
        const bits = u32le(data, 1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      kept.push(bytes.subarray(at, Math.min(next, end)));
    }
    at = next;
  }
  if (width === 0 || height === 0) return undefined;
  const body = Buffer.concat(kept);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'ascii');
  return { bytes: Buffer.concat([head, body]), width, height };
}

/**
 * A picture checked for a link page (AC-6108, AC-6128): its type by its first bytes (JPEG, PNG or WebP; SVG, GIF
 * and anything else refused whatever it claimed to be), its segments walked and its metadata taken out, its sides
 * between 1 and 4,096 pixels, and at most 1.5 MB once stripped.
 */
export function checkProfileImage(bytes: Uint8Array): CheckedImage | ImageRefusal {
  const type = profileImageTypeOf(bytes);
  if (type === undefined) return { ok: false, reason: 'type' };
  if (bytes.byteLength > PROFILE_IMAGE_MAX_BYTES * 4) return { ok: false, reason: 'size' };
  const stripped = type === 'image/jpeg' ? stripJpeg(bytes) : type === 'image/png' ? stripPng(bytes) : stripWebp(bytes);
  if (stripped === undefined) return { ok: false, reason: 'shape' };
  if (
    stripped.width < 1 ||
    stripped.height < 1 ||
    stripped.width > PROFILE_IMAGE_MAX_SIDE ||
    stripped.height > PROFILE_IMAGE_MAX_SIDE
  ) {
    return { ok: false, reason: 'shape' };
  }
  if (stripped.bytes.byteLength > PROFILE_IMAGE_MAX_BYTES) return { ok: false, reason: 'size' };
  return { ok: true, type, width: stripped.width, height: stripped.height, bytes: stripped.bytes };
}

/** A stored picture's path in the file store: the person's folder for that workspace, and the picture's own id. */
export function profileImageStorePath(
  userId: string,
  workspaceId: string,
  imageId: string,
  type: ProfileImageType,
): string {
  return `link-page/${userId}/${workspaceId}/${imageId}.${imageExtension(type)}`;
}

/** The few named entities a page's tags use, and numeric ones. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d{1,7});/g, (_, code: string) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, code: string) =>
      String.fromCodePoint(Math.min(Number.parseInt(code, 16), 0x10ffff)),
    )
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** The attributes of one tag, names lowercased. */
function attributesOf(tag: string): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    const name = match[1]?.toLowerCase();
    if (name !== undefined && !found.has(name)) found.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return found;
}

/**
 * The picture and title a page names for itself in its `<meta>` tags (AC-6101): `og:image` (its `secure_url` first),
 * then `twitter:image`, resolved against the page's own address and kept only when it is https; and `og:title`.
 * Reads the first 64 kB it was given, never runs anything, and answers nothing it can't read.
 */
export function readPageMeta(html: string, base: URL): { readonly image?: URL; readonly title?: string } {
  const head = html.slice(0, 64 * 1024);
  const meta = new Map<string, string>();
  for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesOf(tag[0]);
    const key = (attributes.get('property') ?? attributes.get('name'))?.toLowerCase();
    const content = attributes.get('content')?.trim();
    if (key !== undefined && content !== undefined && content !== '' && !meta.has(key)) meta.set(key, content);
  }
  let image: URL | undefined;
  for (const key of ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    const value = meta.get(key);
    if (value === undefined || value.length > 2000 || !URL.canParse(value, base.href)) continue;
    const url = new URL(value, base);
    if (url.protocol === 'https:' && url.username === '' && url.password === '') {
      image = url;
      break;
    }
  }
  const title = meta.get('og:title');
  return { ...(image === undefined ? {} : { image }), ...(title === undefined ? {} : { title }) };
}
