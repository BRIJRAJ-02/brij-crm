// The Captures page's two tabs and their addresses, kept apart from the tab
// strip so routes and other screens can link to a tab without loading it.

/** Captures' tabs, in their order: the booking links, then the forms. */
export const CAPTURE_TABS = ['links', 'forms'] as const;

/** One of Captures' tabs. */
export type CaptureTab = (typeof CAPTURE_TABS)[number];

/** Whether `value` names one of Captures' tabs. */
export const isCaptureTab = (value: string): value is CaptureTab => (CAPTURE_TABS as readonly string[]).includes(value);

/** A Captures tab's address. */
export const captureTabHref = (slug: string, tab: CaptureTab) => `/w/${slug}/captures/${tab}`;

/** Captures › Links, the booking links. */
export const linksHref = (slug: string) => captureTabHref(slug, 'links');

/** Captures › Forms, the lead capture forms. */
export const formsHref = (slug: string) => captureTabHref(slug, 'forms');

/** The tab an address under Captures shows: its last segment when that names a tab, else Links. */
export function captureTabOf(pathname: string): CaptureTab {
  const last = pathname.replace(/\/+$/, '').split('/').at(-1) ?? '';
  return isCaptureTab(last) ? last : 'links';
}
