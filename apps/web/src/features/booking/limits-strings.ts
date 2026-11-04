// The words of Availability's Limits section (spec 0037, AC-1297 to AC-1299).

/** The ranges the server takes (spec 0037's Numbers): 1 to 50 a day, 1 to 200 a week. */
export const LIMIT_RANGES = { day: { min: 1, max: 50 }, week: { min: 1, max: 200 } } as const;

/**
 * The numbers each limit's Select offers after No limit: 1 to 10, then round numbers up to each range's top, so a
 * salon or clinic still sets a real cap (50 a day, 200 a week). All inside `LIMIT_RANGES`.
 */
export const LIMIT_CHOICES = {
  day: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50],
  week: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200],
} as const;

const meetings = (count: number) => (count === 1 ? '1 meeting' : `${String(count)} meetings`);

/** Meeting limits' words. */
export const limitsStrings = {
  title: 'Meeting limits',
  description: 'Across every booking page.',
  descriptionFor: (first: string) => `${first}’s, across every booking page.`,
  loading: 'Loading meeting limits',
  failed: 'Couldn’t load meeting limits.',
  dayField: 'Meetings a day',
  weekField: 'Meetings a week',
  noLimit: 'No limit',
  // The count beside each limit (AC-1299): "4 of 20 this week".
  // At the limit (or past it, when it was lowered under what is booked) the day or week is closed: say so.
  dayCount: (count: number, limit: number) =>
    count >= limit
      ? `${String(count)} of ${String(limit)} today. Full for today.`
      : `${String(count)} of ${String(limit)} today`,
  weekCount: (count: number, limit: number) =>
    count >= limit
      ? `${String(count)} of ${String(limit)} this week. Full this week.`
      : `${String(count)} of ${String(limit)} this week`,
  // With no limit, what is booked so far.
  dayBooked: (count: number) => `${meetings(count)} today`,
  weekBooked: (count: number) => `${meetings(count)} this week`,
  // Read only (AC-1299): why it can't be changed here.
  setByOthers: 'Your meeting limits are set by others.',
  seeOnly: (first: string) => `You can see ${first}’s meeting limits but not change them.`,
} as const;
