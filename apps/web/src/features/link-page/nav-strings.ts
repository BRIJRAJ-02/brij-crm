// The link page's name in the settings navigation and the command menu, apart from the editor's copy, so the
// navigation (in the app's first load) carries one word, not the editor's strings.
export const navStrings = {
  title: 'Link page',
} as const;

/**
 * The link page's editor (spec 0051): the person's page at /<handle>. One definition, in the sidebar's own module,
 * so the row in the sidebar, the card on Home, the booking page editor and Settings › Profile all point at the one
 * address. It was a view of Settings › Account › Profile until 25 October 2026.
 */
export { linkPageHref } from '../workspace/objects.ts';
