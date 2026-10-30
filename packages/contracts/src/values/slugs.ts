// API names (spec 0012, AC-245): the one function that derives an object's or
// an attribute's API name from its plural name or title, and the words no
// object may take. Plain TypeScript with no Zod, so the browser's dialog, the
// server, relationship sides (#15) and the schema map's links (#56) share it.

/**
 * The API names no object may take: route segments beside `$object` (the
 * schema map, settings and their tabs), so `/settings/objects/map` can never
 * be an object.
 */
export const RESERVED_SLUGS = ['map', 'list', 'new', 'settings', 'attributes', 'configuration'] as const;

/** The longest API name (the engine's rule). */
export const MAX_API_SLUG = 63;

/** The shape every API name has: lowercase letters, digits and underscores, starting with a letter, 1 to 63 long. */
export const API_SLUG_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

/** What an API name names: an object (checked against `RESERVED_SLUGS`) or an attribute. */
export type ApiSlugKind = 'object' | 'attribute';

/** True when an object API name is one of the reserved route segments. */
export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug);
}

/**
 * An API name from a plural name or a title: accents dropped, lowercased,
 * every run of anything but letters and digits one `_`, trimmed of `_`,
 * `x_` in front when it starts with a digit, cut to 63 characters. Nothing
 * left gives `object` or `attribute`; an object name on the reserved list
 * gets `_object` after it. "Projects" gives `projects`, "Café orders" gives
 * `cafe_orders`, "2026 goals" gives `x_2026_goals`, "Map" gives `map_object`.
 */
export function toApiSlug(text: string, kind: ApiSlugKind): string {
  const plain = text
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
  const prefixed = /^[0-9]/.test(plain) ? `x_${plain}` : plain;
  const cut = prefixed.slice(0, MAX_API_SLUG).replace(/_+$/, '');
  const slug = cut === '' ? kind : cut;
  return kind === 'object' && isReservedSlug(slug) ? `${slug}_object` : slug;
}

/**
 * The first API name free of `taken`, made from `base`: `base` itself, else `base_2`, `base_3` and on, `base` cut
 * so the whole stays within 63 characters. A new attribute named like an archived one gets one this way, so
 * Create works while the archived one keeps its name (flow pass, 30 October 2026).
 */
export function freeApiSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${String(n)}`;
    const candidate = `${base.slice(0, MAX_API_SLUG - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
