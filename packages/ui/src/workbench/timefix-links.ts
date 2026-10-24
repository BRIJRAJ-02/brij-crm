// Reads back the Timefix links a public page's story draws, and the tags each carries, written out by hand so a
// story checks the tags themselves rather than the builder's own output. Stories only.

/** A Timefix link's tags, as its address carries them. */
export type TimefixTags = Readonly<Record<string, string>>;

/** The tags a Timefix link on `medium` (`booking_page`) carries as `content` (`footer_logo` or `claim_link`). */
export function timefixTags(medium: string, content: string): TimefixTags {
  return { utm_source: 'timefix', utm_medium: medium, utm_campaign: 'powered_by', utm_content: content };
}

/**
 * Every www.timefix.com link in `root`, in page order, as its tags: a hidden foot's too, since the booking frame draws
 * one foot for wide screens and one for phones.
 */
export function timefixLinkTags(root: HTMLElement): readonly TimefixTags[] {
  return [...root.querySelectorAll<HTMLAnchorElement>('a[href^="https://www.timefix.com"]')].map((link) =>
    Object.fromEntries(new URL(link.href).searchParams),
  );
}
