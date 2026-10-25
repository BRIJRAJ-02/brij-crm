// The link page's name in the settings navigation and the command menu, apart from the editor's copy, so the
// navigation (in the app's first load) carries one word, not the editor's strings.
export const navStrings = {
  title: 'Link page',
} as const;

/** The link page's editor (spec 0051), a view of Settings › Account › Profile: the person's page at /<handle>. */
export const linkPageHref = (slug: string) => `/w/${slug}/settings/account/profile?view=link-page`;
