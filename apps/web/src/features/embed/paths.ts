// The embedded frame's addresses (spec 0070, AC-7032), read before anything loads: `main.tsx` asks whether this page
// is one, so the data layer sends the frame's header, the theme is kept off the person's own storage, and a session
// that ends sends the frame to its own page rather than to sign in. Plain functions, tiny, in the first load.
/** `/embed/<clientId>/…`: the partner's client id is the frame's first segment. */
const EMBED_PATH = /^\/embed\/(tfp_[A-Za-z0-9_-]{22})(?:\/|$)/;

/** The header the frame's calls carry, so the API reads the frame's own session cookie (`EMBED_HEADER` in the api). */
export const EMBED_HEADER = 'x-crm-embed';

/** The partner's client id when `pathname` is one of the frame's pages, else undefined. */
export function embedClientIdOf(pathname: string): string | undefined {
  return EMBED_PATH.exec(pathname)?.[1];
}

/** The partner's look, as the frame's address keeps it (`?theme=`), or undefined. */
export function embedThemeOf(search: string): 'light' | 'dark' | undefined {
  const theme = new URLSearchParams(search).get('theme');
  return theme === 'light' || theme === 'dark' ? theme : undefined;
}

/** The frame's own page for a session that ended, in the partner's look: it asks the partner for a fresh launch. */
export function embedEndedHref(clientId: string, theme?: 'light' | 'dark'): string {
  return `/embed/${clientId}/start?ended=true${theme === undefined ? '' : `&theme=${theme}`}`;
}
