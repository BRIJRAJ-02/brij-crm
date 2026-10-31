// Where Bookings › Roster (the Team week, spec 0037) is, apart from links.ts, which the loaders keep in the first
// load: only the screens link here.

/** Bookings › Roster: a week by its Monday (else this week) and a name search. */
export const teamWeekHref = (slug: string, week?: string, q?: string) => {
  const query = new URLSearchParams();
  if (week !== undefined) query.set('week', week);
  if (q !== undefined && q.trim() !== '') query.set('q', q.trim());
  const text = query.toString();
  return `/w/${slug}/bookings/roster${text === '' ? '' : `?${text}`}`;
};
