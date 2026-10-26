// What a picture's own bytes say it is (26 October 2026). Every image this product takes from outside itself — a
// link block's site icon, fetched from a site we do not run, and a share image, uploaded by a person — is decided
// here and never by what a server or a browser claimed it was. A `content-type` header and a file picker's `type`
// are both the sender's word for it; the first bytes are not.
//
// One reader, not one per caller: the two callers want different sets (an icon may be an ICO, a share image may
// not), so each narrows this answer rather than writing its own signatures.

/** The image types this product can recognise. Each is a file signature below, and nothing else ever matches. */
export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/x-icon';

/**
 * The type `bytes` begin as, or undefined for anything else. SVG is deliberately not among them: it is a document
 * that can carry script, and nothing this product serves as an image is one.
 */
export function imageTypeOf(bytes: Uint8Array): ImageType | undefined {
  const at = (offset: number, ...expected: readonly number[]) =>
    expected.every((byte, index) => bytes[offset + index] === byte);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (at(4, 0x37, 0x61) || at(4, 0x39, 0x61))) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  // An icon file: two zero bytes, then type 1 (icon) or 2 (cursor), then a count of at least one image.
  if (at(0, 0x00, 0x00) && (at(2, 0x01, 0x00) || at(2, 0x02, 0x00)) && !at(4, 0x00, 0x00)) return 'image/x-icon';
  return undefined;
}
