// The one rule for a link anything stores or draws (spec 0003, AC-14; spec
// 0019's security review): plain TypeScript with no Zod, so the library's
// `safeHref()` and the rich text document's schema read the same function.
// A link is resolved against a fixed base, so what the browser would follow
// is what is judged: `http:`, `https:`, `mailto:`, `tel:`, or a path on our
// own origin. Control characters (tab, CR, LF and the rest) are refused
// before anything else, since browsers strip them while resolving
// (`java\tscript:` would otherwise pass as text and run as script).

/** The protocols a link may use. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** A base no real link resolves to, so a path or a bare word is told apart from a link out. */
const BASE = 'https://base.invalid';

/** Any ASCII control character, NUL to US, and DEL. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The link as given when it is safe to store or draw, else undefined: a
 * single slash path that stays on our origin, or an absolute `http:`,
 * `https:`, `mailto:` or `tel:` link. Refused: control characters anywhere,
 * `javascript:` and `data:` links, protocol relative `//host` and `/\host`,
 * backslashes in a path, and bare words.
 */
export function safeLink(href: string | undefined): string | undefined {
  const value = href?.trim() ?? '';
  if (value === '' || CONTROL.test(value)) return undefined;
  let resolved: URL;
  try {
    resolved = new URL(value, BASE);
  } catch {
    return undefined;
  }
  if (value.startsWith('/')) {
    if (/^\/[/\\]/.test(value) || value.includes('\\')) return undefined;
    return resolved.origin === BASE ? value : undefined;
  }
  // A bare word ("example", "./x") resolves to the base: not a link out, and not a path either.
  if (resolved.origin === BASE) return undefined;
  return SAFE_PROTOCOLS.has(resolved.protocol) ? value : undefined;
}

/** Whether a link may be stored or drawn (`safeLink` answers it). */
export function isSafeLink(href: string): boolean {
  return safeLink(href) !== undefined;
}
