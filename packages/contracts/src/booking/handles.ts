// Public booking addresses (owner decision, 22 Oct 2026), the Calendly and Cal.com way: each person has a handle,
// their profile is at `/<handle>` and each booking page at `/<handle>/<slug>`. Plain values with no imports, so the
// web's routing (vite.config.ts, vercel.json's check), the public bundle and the API share one definition.

/** The fewest and most characters a handle has. */
export const HANDLE_MIN = 3;
/** The most characters a handle has. */
export const HANDLE_MAX = 40;
/** The most characters a bio has: one line. */
export const BIO_MAX = 160;

/** A handle's shape: lowercase letters, digits and single hyphens, 3 to 40 characters. */
export const HANDLE_PATTERN = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A booking page's slug shape (`BookingSlug`'s), as the router reads it. */
export const SLUG_PATTERN = /^(?=.{1,60}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Words no one may take as a handle: every top level path the app serves (its routes, the public pages, the API,
 * the built files), and words a visitor would read as ours. A route added at the top level adds its word here;
 * `apps/web/public-paths.test.ts` fails until it does.
 */
export const RESERVED_HANDLES: readonly string[] = [
  'about',
  'account',
  'accounts',
  'admin',
  'api',
  'app',
  'apps',
  'assets',
  'auth',
  'availability',
  'b',
  'billing',
  'blog',
  'book',
  'booking',
  'bookings',
  'brand',
  'calendar',
  'callback',
  'cancel',
  'captures',
  'contact',
  'dashboard',
  'demo',
  'developers',
  'docs',
  'download',
  'edit',
  'email',
  'email-preferences',
  'embed',
  'f',
  'favicon',
  'form',
  'forms',
  'health',
  'help',
  'home',
  'inbox',
  'index',
  'integrations',
  'invite',
  'join',
  'legal',
  'links',
  'login',
  'logout',
  'mail',
  'manage',
  'manifest',
  'new',
  'null',
  'oauth',
  'objects',
  'pricing',
  'privacy',
  'profile',
  'public',
  'reschedule',
  'robots',
  'root',
  'schedule',
  'search',
  'security',
  'settings',
  'sign-in',
  'sign-out',
  'sign-up',
  'signin',
  'signup',
  'sitemap',
  'static',
  'status',
  'support',
  'team',
  'terms',
  'theme-boot',
  'timefix',
  'two-factor',
  'undefined',
  'user',
  'users',
  'verify',
  'w',
  'webhooks',
  'welcome',
  'www',
];

/** Whether `handle` is one of the words kept for the app. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.includes(handle);
}

/**
 * The edge cache tags for what a link page serves publicly (spec 0058, AC-23): its shell, share card, picture and
 * share image are each kept under `link-page:<handle>`, so switching the page Private deletes every copy at once.
 * Only well formed handles make a tag, each once, so nothing a visitor typed ever names one.
 */
export function linkPageCacheTags(...handles: readonly (string | undefined)[]): readonly string[] {
  const valid = handles.filter((handle): handle is string => handle !== undefined && HANDLE_PATTERN.test(handle));
  return [...new Set(valid)].map((handle) => `link-page:${handle}`);
}

/** Why `handle` can't be a handle, in plain words, or undefined when it can. */
export function handleProblem(handle: string): string | undefined {
  if (handle.length < HANDLE_MIN) return 'Use at least 3 characters.';
  if (handle.length > HANDLE_MAX) return 'Use at most 40 characters.';
  if (!HANDLE_PATTERN.test(handle)) return 'Use lowercase letters, numbers and single hyphens.';
  if (isReservedHandle(handle)) return 'That handle is kept for Timefix. Pick another.';
  return undefined;
}

/**
 * A handle from a name, for the field's first value: lowercase, hyphens for anything else, 3 to 40 characters
 * (a short one padded with `-me`), and never a reserved word (it gains `-me` too).
 */
export function handleFromName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, HANDLE_MAX)
    .replace(/-+$/g, '');
  const padded = base === '' ? 'me' : base;
  const long = padded.length < HANDLE_MIN || isReservedHandle(padded) ? `${padded}-me` : padded;
  return long.slice(0, HANDLE_MAX).replace(/-+$/g, '');
}

/** A text as a handle's letters: lowercase, accents dropped, hyphens for anything else, at most 40, maybe empty. */
function handleLetters(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      // The accents NFKD split off go, so "Renée" is `renee`, not `rene-e` (migration 0115's backfill does the same).
      .replace(/[\u0300-\u036f]+/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, HANDLE_MAX)
      .replace(/-+$/g, '')
  );
}

/**
 * The handle a new membership's link page starts from (26 Oct 2026, the owner: "create link page automatically as
 * soon as someone signs up"): their name's letters ("Ada Lovelace" gives `ada-lovelace`); when the name gives fewer
 * than 3 or a reserved word, the email's part before the `@` (a `+tag` dropped); when neither does, the name padded
 * as `handleFromName` pads it. Always a valid handle. The database makes it unique with a short number.
 */
export function handleBaseFor(name: string, email: string): string {
  const fromName = handleLetters(name);
  if (fromName.length >= HANDLE_MIN && !isReservedHandle(fromName)) return fromName;
  const local = email.split('@')[0]?.split('+')[0] ?? '';
  const fromEmail = handleLetters(local);
  if (fromEmail.length >= HANDLE_MIN && !isReservedHandle(fromEmail)) return fromEmail;
  return handleFromName(fromName === '' ? local : name);
}

/** What a public booking address is: a profile (`/<handle>`), or one page (`/<handle>/<slug>`). */
export type HandleAddress =
  | { readonly kind: 'profile'; readonly handle: string }
  | { readonly kind: 'page'; readonly handle: string; readonly slug: string };

/** The handle address a path names, or undefined for any other path (the app's, `/b/…`, a reserved word). */
export function handleAddressOf(pathname: string): HandleAddress | undefined {
  const parts = pathname.replace(/\/+$/, '').split('/').slice(1);
  const [handle, slug, ...rest] = parts;
  if (handle === undefined || rest.length > 0 || !HANDLE_PATTERN.test(handle) || isReservedHandle(handle)) {
    return undefined;
  }
  if (slug === undefined) return { kind: 'profile', handle };
  return SLUG_PATTERN.test(slug) ? { kind: 'page', handle, slug } : undefined;
}

/**
 * A booking page's public path: `/<handle>/<slug>` for a Public page once its owner has a handle, else
 * `/b/<publicKey>`, which keeps working either way. A Link only page is only ever `/b/<publicKey>`: its random key
 * is what keeps it to the people it is sent to (the owner, 22 Oct 2026).
 */
export function bookingPagePath(page: {
  readonly handle?: string | undefined;
  readonly slug: string;
  readonly publicKey: string;
  readonly isPrivate?: boolean;
}): string {
  return page.handle === undefined || page.isPrivate === true
    ? `/b/${encodeURIComponent(page.publicKey)}`
    : `/${encodeURIComponent(page.handle)}/${encodeURIComponent(page.slug)}`;
}

/** One section of a profile: its key, its heading as its first item spells it (none for items without one), and its items. */
export interface ProfileSection<Item> {
  /** The heading trimmed and in lower case: what makes two items one section. Empty for items with no heading. */
  readonly key: string;
  readonly title?: string;
  readonly items: readonly Item[];
}

/**
 * A profile's items under their sections (22 Oct 2026), in the owner's order: each section where its first item is,
 * its items in their order. Headings compare trimmed and ignoring case, so "Sales", "sales" and "Sales " are one
 * section, spelled as the first one is. The profile at `/<handle>` and Settings › Profile's order group by this one
 * rule, so what the owner arranges is what visitors see.
 */
export function profileSections<Item>(
  items: readonly Item[],
  sectionOf: (item: Item) => string | null | undefined,
): readonly ProfileSection<Item>[] {
  const groups = new Map<string, { readonly key: string; readonly title?: string; readonly items: Item[] }>();
  for (const item of items) {
    const title = sectionOf(item)?.trim() ?? '';
    const key = title.toLocaleLowerCase();
    const group = groups.get(key) ?? { key, ...(title === '' ? {} : { title }), items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
