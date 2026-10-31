// A link page's pictures (spec 0061, AC-6108, AC-6128): the type by the first bytes, SVG refused, and the metadata
// out of every picture kept, a photo's GPS above all.
import { describe, expect, it } from 'vitest';
import { checkProfileImage, profileImageStorePath, profileImageTypeOf, readPageMeta } from './images.ts';

const bytes = (...parts: readonly (readonly number[] | string | Uint8Array)[]) =>
  Buffer.concat(
    parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part as Uint8Array))),
  );
const be16 = (n: number) => [(n >> 8) & 255, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

/** A JPEG's segments: JFIF, an EXIF block with a GPS position, a comment, a frame of 640 by 480, and its scan. */
function jpegWithGps(): Buffer {
  const exif = bytes('Exif\0\0', 'GPSLatitude 51.5074 N GPSLongitude 0.1278 W');
  const comment = bytes('Shot at home');
  const frame = [0x08, ...be16(480), ...be16(640), 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, ...be16(16)],
    'JFIF\0',
    [1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xe1, ...be16(exif.length + 2)],
    exif,
    [0xff, 0xfe, ...be16(comment.length + 2)],
    comment,
    [0xff, 0xc0, ...be16(frame.length + 2), ...frame],
    [0xff, 0xda, ...be16(8), 3, 1, 0, 2, 0x11, 3],
    [1, 2, 3, 4],
    [0xff, 0xd9],
  );
}

/** A PNG chunk with a made up CRC: the walk reads lengths and types, never checks a CRC. */
const chunk = (type: string, data: readonly number[] | Buffer) =>
  bytes(be32(data.length), type, [...data], [0, 0, 0, 0]);

function pngWithText(): Buffer {
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', [...be32(300), ...be32(200), 8, 6, 0, 0, 0]),
    chunk('tEXt', bytes('Comment\0GPS 51.5 N')),
    chunk('eXIf', bytes('MM\0*GPS')),
    chunk('IDAT', [1, 2, 3]),
    chunk('IEND', []),
  );
}

function webpWithExif(): Buffer {
  const vp8x = [0x0c, 0, 0, 0, ...[799 & 255, 799 >> 8, 0], ...[599 & 255, 599 >> 8, 0]];
  const exif = bytes('MM\0*GPS 51.5 N');
  const vp8l = [0x2f, 0, 0, 0, 0];
  const body = bytes(
    'WEBP',
    'VP8X',
    le32(vp8x.length),
    vp8x,
    'EXIF',
    le32(exif.length),
    exif,
    'VP8L',
    le32(vp8l.length),
    vp8l,
    [0],
  );
  return bytes('RIFF', le32(body.length), body);
}

describe('a picture for a link page', () => {
  it('takes the GPS and comment out of a JPEG and keeps what draws it', () => {
    const checked = checkProfileImage(jpegWithGps());
    expect(checked).toMatchObject({ ok: true, type: 'image/jpeg', width: 640, height: 480 });
    if (!checked.ok) return;
    const text = Buffer.from(checked.bytes).toString('latin1');
    expect(text).not.toContain('GPS');
    expect(text).not.toContain('Shot at home');
    expect(text).toContain('JFIF');
    expect(Buffer.from(checked.bytes).subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  });

  it('takes the text and eXIf chunks out of a PNG', () => {
    const checked = checkProfileImage(pngWithText());
    expect(checked).toMatchObject({ ok: true, type: 'image/png', width: 300, height: 200 });
    if (!checked.ok) return;
    const text = Buffer.from(checked.bytes).toString('latin1');
    expect(text).not.toContain('GPS');
    expect(text).toContain('IDAT');
    expect(text).toContain('IEND');
  });

  it('takes the EXIF chunk out of a WebP, clears its flag and sizes the file again', () => {
    const checked = checkProfileImage(webpWithExif());
    expect(checked).toMatchObject({ ok: true, type: 'image/webp', width: 800, height: 600 });
    if (!checked.ok) return;
    const out = Buffer.from(checked.bytes);
    expect(out.toString('latin1')).not.toContain('GPS');
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect((out[20] ?? 0) & 0x0c).toBe(0);
  });

  it('refuses an SVG, a GIF and a renamed file, whatever they claimed', () => {
    expect(checkProfileImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toEqual({
      ok: false,
      reason: 'type',
    });
    expect(checkProfileImage(Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'))).toEqual({ ok: false, reason: 'type' });
    expect(profileImageTypeOf(Buffer.from('%PDF-1.7'))).toBeUndefined();
  });

  it('refuses a file whose segments don’t hold together, or that is too big or too wide', () => {
    expect(checkProfileImage(jpegWithGps().subarray(0, 40))).toEqual({ ok: false, reason: 'shape' });
    const wide = pngWithText();
    wide.writeUInt32BE(5000, 16);
    expect(checkProfileImage(wide)).toEqual({ ok: false, reason: 'shape' });
    const big = Buffer.concat([
      pngWithText().subarray(0, -12),
      chunk('IDAT', Buffer.alloc(1_600_000)),
      chunk('IEND', []),
    ]);
    expect(checkProfileImage(big)).toEqual({ ok: false, reason: 'size' });
  });

  it('keeps each picture in its person’s folder for the workspace, by its own id', () => {
    expect(profileImageStorePath('u', 'w', 'i', 'image/webp')).toBe('link-page/u/w/i.webp');
  });
});

describe('a page’s own picture and title', () => {
  const base = new URL('https://shop.example.com/products/a');

  it('reads og:image, made whole against the page, and og:title', () => {
    const html = `<html><head><meta name="description" content="x">
      <meta content="/img/a.jpg?x=1&amp;y=2" property="og:image">
      <meta property='og:title' content='A &quot;great&quot; shop'></head>`;
    expect(readPageMeta(html, base)).toEqual({
      image: new URL('https://shop.example.com/img/a.jpg?x=1&y=2'),
      title: 'A "great" shop',
    });
  });

  it('falls back to twitter:image, and keeps only an https picture', () => {
    expect(readPageMeta('<meta name="twitter:image" content="https://cdn.example.com/b.png">', base).image?.href).toBe(
      'https://cdn.example.com/b.png',
    );
    expect(readPageMeta('<meta property="og:image" content="http://cdn.example.com/b.png">', base)).toEqual({});
    expect(readPageMeta('<meta property="og:image" content="javascript:alert(1)">', base)).toEqual({});
    expect(readPageMeta('<p>No tags</p>', base)).toEqual({});
  });
});
