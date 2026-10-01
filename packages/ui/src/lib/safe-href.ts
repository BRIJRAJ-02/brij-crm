// The one check on every link the library draws (AC-14). Anything it refuses
// renders as plain text, so a `javascript:` URL can never become a link.

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Returns the href when it is safe to link to: `http:`, `https:`, `mailto:`,
 * `tel:`, or a single slash path on our own origin (which the router handles).
 * Returns `undefined` for anything else, including `javascript:`, `data:`,
 * protocol relative `//host` links and bare words.
 */
export function safeHref(href: string | undefined): string | undefined {
  const value = href?.trim() ?? '';
  if (value === '') return undefined;
  if (value.startsWith('/')) return /^\/[/\\]/.test(value) ? undefined : value;
  try {
    return SAFE_PROTOCOLS.has(new URL(value).protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** True for a path on our own origin, which the router handles, rather than a link out. */
export function isAppPath(href: string): boolean {
  return href.startsWith('/') && !/^\/[/\\]/.test(href);
}
