// The one check on every image the library draws (AC-14), matching the CSP's
// `img-src 'self' data: blob:`. Anything else falls back to initials or an icon.

/**
 * Returns the src when the image may load: a path or URL on `origin`,
 * `data:image/…` or `blob:`. Returns `undefined` otherwise, so the caller shows
 * its fallback. A Google account picture comes through the api's own origin
 * routes (23 Oct 2026), and a company's logo through `/api/logos/<domain>`
 * (spec 0059), so neither is ever an outside address here.
 */
export function safeImageSrc(src: string | undefined, origin: string = globalThis.location.origin): string | undefined {
  const value = src?.trim() ?? '';
  if (value === '') return undefined;
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return value;
  if (value.startsWith('/')) return /^\/[/\\]/.test(value) ? undefined : value;
  try {
    return new URL(value).origin === origin ? value : undefined;
  } catch {
    return undefined;
  }
}
