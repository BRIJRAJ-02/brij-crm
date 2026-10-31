// A company's logo from our own origin (spec 0059, AC-5901 to AC-5907): the address a company record's picture
// names, built from its first Domains value, and the one rule for which domains may be asked for at all. The api's
// `GET /api/logos/:domain` (apps/api/src/logos.ts) fetches the site's icon through the one outside door; nothing
// here touches the network. The path names the domain, so a changed first domain is a new picture (AC-5902).

/** Where a company's logo is read from: this, then its domain. */
export const LOGO_PATH = '/api/logos/';

/** The longest name DNS carries. */
const HOST_MAX = 253;

/** One label of a host name: lowercase letters, digits and inner hyphens, at most 63 characters. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A top level label a public site sits under: letters, or an international name as `xn--`. Never all digits. */
const TOP_LABEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Top level names kept for private or special use (RFC 6761, 6762, 7686, 8375, 9476, and ICANN's `.internal`),
 * and the few a private network commonly invents: never a public site, so never worth a lookup.
 */
const SPECIAL_USE: ReadonlySet<string> = new Set([
  'alt',
  'arpa',
  'corp',
  'example',
  'home',
  'internal',
  'invalid',
  'lan',
  'local',
  'localdomain',
  'localhost',
  'onion',
  'test',
]);

/**
 * Whether `domain` is a public host name a logo may be fetched for (AC-5906): lowercase, at most 253 characters, two
 * labels or more, each a valid label, under a top level name of letters (or `xn--`) outside the special use names.
 * So never an address literal, a port, credentials, a path, a trailing dot or another spelling of the same name.
 * Where the name resolves to is the outside door's check (spec 0055, AC-5531); this keeps the obvious non sites
 * from costing a lookup, and keeps one path per domain at the edge.
 */
export function isLogoDomain(domain: string): boolean {
  if (domain.length === 0 || domain.length > HOST_MAX) return false;
  const labels = domain.split('.');
  const top = labels.at(-1) ?? '';
  return (
    labels.length >= 2 && labels.every((label) => LABEL.test(label)) && TOP_LABEL.test(top) && !SPECIAL_USE.has(top)
  );
}

/**
 * The picture address of a company whose first domain is `domain` (AC-5901, AC-5902), or undefined when that domain
 * can't have a logo, so the record keeps its coloured initial without a request that could only miss.
 */
export function companyLogoPath(domain: string): string | undefined {
  const host = domain.trim().toLowerCase();
  return isLogoDomain(host) ? `${LOGO_PATH}${host}` : undefined;
}
