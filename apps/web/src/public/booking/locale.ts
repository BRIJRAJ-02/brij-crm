// One language per page (bookings critic B-13, 4 Nov 2026): the public booking pages are written in English, so their
// dates and times are formatted in English too, with the visitor's own region's conventions (the first day of the
// week, the 12 or 24 hour clock, the order of day and month). A Japanese visitor read "2026年11月" over "5日" cells
// under English copy; a German one read "Do., 5. Nov." beside "Book".

/** The locale the page formats in: the visitor's own when it is English, else English for the visitor's region. */
export function pageLocale(visitor: string | undefined): string {
  const fallback = 'en-US';
  if (visitor === undefined || visitor === '') return fallback;
  try {
    const parsed = new Intl.Locale(visitor);
    if (parsed.language === 'en') return parsed.baseName;
    // English for the region the visitor's language names, where it names one ("de-DE" reads as "en-DE": 24 hours,
    // Monday first, "5 Nov"); a bare language ("ja") has no region to borrow, so the page's own English.
    const region = parsed.region ?? parsed.maximize().region;
    if (region === undefined) return fallback;
    const english = `en-${region}`;
    return Intl.DateTimeFormat.supportedLocalesOf([english]).length > 0 ? english : 'en-GB';
  } catch {
    return fallback;
  }
}
