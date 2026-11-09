// The embedded frame's screen addresses (spec 0070, AC-7032): a launch's screen as the address it opens, with the
// partner's look kept in it so a reload keeps it. Plain functions, read by the routes' loaders.

/** A screen a launch may open (`PARTNER_SCREENS` in the contracts). */
export type EmbedScreen = 'link_pages.mine' | 'link_pages.team';

/** The address of the frame's link page screens for this partner. */
export function embedLinkPageBase(clientId: string): string {
  return `/embed/${clientId}/link-page`;
}

/** Where a launch's screen opens, in the look it asked for. */
export function embedLinkPageHref(clientId: string, screen: EmbedScreen, theme?: 'light' | 'dark'): string {
  const search = new URLSearchParams();
  if (screen === 'link_pages.team') search.set('team', 'true');
  if (theme !== undefined) search.set('theme', theme);
  const query = search.toString();
  return query === '' ? embedLinkPageBase(clientId) : `${embedLinkPageBase(clientId)}?${query}`;
}
