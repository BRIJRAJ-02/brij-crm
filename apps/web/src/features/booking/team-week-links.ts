// Where Availability's Team week (the Roster, spec 0037) is, apart from links.ts, which the loaders keep in the first
// load: only the screens link here.

/** Availability's Team week (the Roster): a week by its Monday (else this week) and a name search. */
export const teamWeekHref = (slug: string, week?: string, q?: string) => {
  const query = new URLSearchParams({ view: 'team' });
  if (week !== undefined) query.set('week', week);
  if (q !== undefined && q.trim() !== '') query.set('q', q.trim());
  return `/w/${slug}/bookings/availability?${query.toString()}`;
};
