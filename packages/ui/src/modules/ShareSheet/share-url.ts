// The one gate on what ShareSheet passes on (spec 0073, AC-7318): an address is drawn, copied, shared or encoded
// into a QR code only once it passes here, so a `javascript:`, `data:` or `vbscript:` link never reaches a guest.
import { safeHref } from '../../lib/safe-href.ts';

/**
 * The address when it may be shared: it passes `safeHref` (the library's one link rule) and is an absolute
 * `http:` or `https:` address, since a path on our own origin, a `mailto:` or a `tel:` means nothing on another
 * device. Anything else, `javascript:`, `data:` and `vbscript:` among it, answers undefined.
 */
export function shareableUrl(url: string): string | undefined {
  const safe = safeHref(url);
  if (safe === undefined) return undefined;
  return /^https?:\/\/[^/]/i.test(safe) ? safe : undefined;
}
