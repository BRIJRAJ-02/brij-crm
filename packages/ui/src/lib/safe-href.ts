// The one check on every link the library draws (AC-14). Anything it refuses
// renders as plain text, so a `javascript:` URL can never become a link.
import { safeLink } from '@crm/contracts/safe-link';

/**
 * Returns the href when it is safe to link to: `http:`, `https:`, `mailto:`,
 * `tel:`, or a single slash path on our own origin (which the router handles).
 * Returns `undefined` for anything else, including `javascript:`, `data:`,
 * protocol relative `//host` links, bare words and anything holding a tab,
 * CR, LF or another control character. The rule is the contracts' own
 * (`safeLink`), the one stored rich text is held to.
 */
export function safeHref(href: string | undefined): string | undefined {
  return safeLink(href);
}

/** True for a path on our own origin, which the router handles, rather than a link out. */
export function isAppPath(href: string): boolean {
  return href.startsWith('/') && !/^\/[/\\]/.test(href);
}
