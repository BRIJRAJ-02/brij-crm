// The share image picker's own numbers and the one conversion it needs (spec 0055, AC-5511).
//
// The size here is a courtesy, not the rule: the contract refuses a longer base64 and the column refuses larger
// bytes, so a picture over this never reaches the page whatever the browser does. It is repeated because
// `apps/web` may not import `@crm/contracts` (the lint rule), and a number is cheaper to repeat than to drag a
// schema library into the first load for. Keep it equal to `SHARE_IMAGE_MAX_BYTES` there.

/** The largest share image the picker offers to send: 500 kB, as the contract and the column both hold. */
export const SHARE_IMAGE_MAX_BYTES = 500_000;

/** What the picker takes. The server reads the bytes themselves, so a renamed file is refused there whatever this says. */
export const SHARE_IMAGE_TYPES: readonly string[] = ['image/png', 'image/jpeg'];

/**
 * One file as the base64 the procedure carries. Done a chunk at a time: `String.fromCharCode(...bytes)` on half a
 * megabyte is hundreds of thousands of arguments at once, which throws on some engines and is slow on the rest.
 */
export async function asBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const CHUNK = 8192;
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}
