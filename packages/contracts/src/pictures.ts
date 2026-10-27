// A person's own picture, uploaded (27 Oct 2026): what the browser may send, and what the server takes. Plain
// TypeScript with no Zod, so the browser checks a file before it sends a byte and the server checks it again.
import type { UploadType } from './forms/uploads.ts';

/**
 * The largest picture the server takes, in bytes. The browser squares and re-encodes a photo to a few hundred
 * kilobytes before it sends it, so this is a ceiling for a caller that skipped that, not a size a person meets.
 */
export const PICTURE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/** The side of the square the browser draws a picture to before sending it, in pixels. */
export const PICTURE_SIDE = 512;

/**
 * What a picture may be, and nothing else: JPEG, PNG or WebP, each recognised by its first bytes. No SVG (a browser
 * runs its scripts) and no GIF (it moves on a public page).
 */
export const PICTURE_UPLOAD_TYPES: readonly UploadType[] = [
  { contentType: 'image/jpeg', extensions: ['jpg', 'jpeg'], sniff: 'jpeg' },
  { contentType: 'image/png', extensions: ['png'], sniff: 'png' },
  { contentType: 'image/webp', extensions: ['webp'], sniff: 'webp' },
];

/** The picture type a `content-type` names, or undefined for anything not taken. */
export function pictureTypeOf(contentType: string): UploadType | undefined {
  const bare = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  return PICTURE_UPLOAD_TYPES.find((type) => type.contentType === bare);
}
