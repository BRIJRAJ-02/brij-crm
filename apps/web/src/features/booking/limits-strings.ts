// The words of Availability's Limits section (spec 0037, AC-1297 to AC-1299).

/** The ranges the server takes (spec 0037's Numbers): 1 to 50 a day, 1 to 200 a week. */
export const LIMIT_RANGES = { day: { min: 1, max: 50 }, week: { min: 1, max: 200 } } as const;

/** What a limit starts at when its Switch is turned on for the first time. */
export const LIMIT_STARTS = { day: 8, week: 30 } as const;

const meetings = (count: number) => (count === 1 ? '1 meeting' : `${String(count)} meetings`);

/** Meeting limits' words. */
export const limitsStrings = {
  title: 'Meeting limits',
  description: 'Across every booking page. Once a limit is reached, no page offers that day or week.',
  descriptionFor: (first: string) =>
    `Across every booking page. Once ${first} reaches a limit, no page offers them that day or week.`,
  loading: 'Loading meeting limits',
  failed: 'Couldn’t load meeting limits.',
  daySwitch: 'Limit meetings a day',
  weekSwitch: 'Limit meetings a week',
  dayField: 'Meetings a day',
  weekField: 'Meetings a week',
  // The count beside each limit (AC-1299): "4 of 20 this week".
  dayCount: (count: number, limit: number) => `${String(count)} of ${String(limit)} today`,
  weekCount: (count: number, limit: number) => `${String(count)} of ${String(limit)} this week`,
  // With no limit, what is booked so far.
  dayBooked: (count: number) => `${meetings(count)} today, no limit.`,
  weekBooked: (count: number) => `${meetings(count)} this week, no limit.`,
  dayRange: 'Use a whole number from 1 to 50.',
  weekRange: 'Use a whole number from 1 to 200.',
  // Read only (AC-1299): why it can't be changed here.
  setByOthers: 'Your meeting limits are set by someone who manages your scheduling.',
  seeOnly: (first: string) => `You can see ${first}’s meeting limits but not change them.`,
} as const;
