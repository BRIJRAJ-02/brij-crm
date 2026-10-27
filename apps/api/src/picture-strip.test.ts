// The metadata an upload carries (27 Oct 2026): taken out of a JPEG, a PNG and a WebP, with what draws the picture
// kept byte for byte, and a file whose structure doesn't hold together refused.
import { describe, expect, it } from 'vitest';
import { jpegWith, pngWith, webpWith } from '../test/pictures.ts';
import { stripPictureMetadata } from './picture-strip.ts';

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

describe('taking metadata out of a picture', () => {
  it('drops a JPEG’s EXIF, XMP and comments, and keeps JFIF, the colour profile and the scan', () => {
    const out = stripPictureMetadata('jpeg', jpegWith({ exif: true, comment: true, profile: true }));
    expect(out).toBeDefined();
    const kept = text(out ?? new Uint8Array());
    expect(kept).not.toContain('GPS');
    expect(kept).not.toContain('a comment');
    expect(kept).toContain('JFIF');
    expect(kept).toContain('ICC_PROFILE');
    expect(kept).toContain('SCAN');
    expect(out?.at(-2)).toBe(0xff);
    expect(out?.at(-1)).toBe(0xd9);
  });

  it('leaves a clean JPEG as it was', () => {
    const clean = jpegWith({});
    expect(stripPictureMetadata('jpeg', clean)).toEqual(clean);
  });

  it('drops a PNG’s text, time and EXIF chunks', () => {
    const out = stripPictureMetadata('png', pngWith({ text: true }));
    const kept = text(out ?? new Uint8Array());
    expect(kept).not.toContain('GPS');
    expect(kept).not.toContain('tIME');
    expect(kept).toContain('IHDR');
    expect(kept).toContain('IDAT');
    expect(kept).toContain('IEND');
  });

  it('drops a WebP’s EXIF and XMP chunks, clears their flags, and makes RIFF’s size again', () => {
    const out = stripPictureMetadata('webp', webpWith({ exif: true }));
    expect(out).toBeDefined();
    const bytes = out ?? new Uint8Array();
    const kept = text(bytes);
    expect(kept).not.toContain('GPS');
    expect(kept).not.toContain('XMP ');
    expect(kept).toContain('VP8L');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8);
    expect((bytes[20] ?? 0) & 0x0c).toBe(0);
  });

  it('refuses a file whose structure doesn’t hold together', () => {
    // First bytes that look right, and nothing after them that does.
    expect(stripPictureMetadata('jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 1, 2]))).toBeUndefined();
    expect(stripPictureMetadata('jpeg', jpegWith({}).subarray(0, 20))).toBeUndefined();
    expect(stripPictureMetadata('png', pngWith({}).subarray(0, 30))).toBeUndefined();
    const webp = webpWith({});
    expect(stripPictureMetadata('webp', webp.subarray(0, webp.byteLength - 3))).toBeUndefined();
    expect(stripPictureMetadata('gif', jpegWith({}))).toBeUndefined();
  });
});
