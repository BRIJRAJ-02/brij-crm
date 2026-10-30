// The words of Availability's Team week, the Roster (spec 0037, job J6, AC-1289 to AC-1296, AC-1300), its cell
// editor, its row menu and its confirms (AC-1445).

/** Hours as "38 h" or "37.5 h": quarter hours show their decimal. */
const hours = (minutes: number): string => {
  const value = Math.round((minutes / 60) * 100) / 100;
  return `${String(value)} h`;
};

/** The Team week's words. */
export const teamWeekStrings = {
  view: 'View',
  mine: 'Mine',
  team: 'Team',
  title: 'Roster',
  grid: (range: string) => `Roster, ${range}`,
  person: 'Team member',
  thisWeek: 'This week',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  search: 'Search people',
  hours,
  people: (count: number) => (count === 1 ? '1 person' : `${String(count)} people`),
  nobody: 'Nobody',
  /**
   * The footer's heading (AC-1294): who works that day, and their hours added up, each person's own merged hours
   * (the same number as the hours under their name), whatever their zone.
   */
  working: 'Working, hours added up',
  totalLabel: (day: string, count: number, minutes: number) =>
    count === 0
      ? `${day}: nobody working`
      : `${day}: ${teamWeekStrings.people(count)} working, ${hours(minutes)} added up`,
  offset: (minutes: number) => {
    const sign = minutes < 0 ? '−' : '+';
    const whole = Math.abs(minutes);
    const h = Math.floor(whole / 60);
    const m = whole % 60;
    return `UTC${sign}${String(h)}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}`;
  },
  otherSchedules: (count: number) =>
    count === 1 ? '1 page uses another schedule' : `${String(count)} pages use other schedules`,
  off: 'Off',
  away: 'Away',
  thisWeekOnly: 'this week only',
  range: (start: string, end: string) => `${start} – ${end}`,
  rangeWords: (start: string, end: string) => `${start} to ${end}`,
  cellLabel: (day: string, name: string, words: string) => `${day}, ${name}: ${words}`,
  editorLabel: (name: string, day: string) => `${name}, ${day}`,
  dayHours: (day: string) => `Hours on ${day}`,
  usualHours: 'Usual hours',
  backToUsual: (words: string) => `Back to usual hours (${words})`,
  cancel: 'Cancel',
  save: 'Save',
  saved: (name: string, day: string) => `${name}’s ${day} saved.`,
  rowActions: (name: string) => `Actions for ${name}`,
  copyToNext: 'Copy this week to next week',
  setUsual: 'Set usual hours',
  setUsualFor: 'Set usual hours for…',
  copyTitle: (name: string) => `Copy ${name}’s week to next week?`,
  copyBody: (name: string, range: string) =>
    `This replaces ${name}’s hours for ${range} with this week’s. Days on usual hours this week are on usual hours next week too.`,
  copyAction: 'Copy week',
  copied: (name: string) => `${name}’s week copied to next week.`,
  usualTitle: (name: string | undefined) => (name === undefined ? 'Set usual hours' : `Set ${name}’s usual hours`),
  usualFor: 'People',
  usualForPlaceholder: 'Choose people…',
  usualWeek: 'Usual week',
  usualBody: (count: number) =>
    count === 0
      ? 'Choose who these hours are for.'
      : `This replaces the usual hours for ${teamWeekStrings.people(count)}. Changes for one date stay as they are.`,
  usualAction: 'Set usual hours',
  usualDone: (count: number) =>
    count === 0 ? 'Their usual hours were already these.' : `Usual hours set for ${teamWeekStrings.people(count)}.`,
  readOnlyWeek: 'Weeks before this one are read only.',
  explain:
    'A change to a day is for that date only, marked with a dot. Usual hours repeat every week. Booking pages offer these hours.',
  seesOnlyYou: 'You see your own hours. People who share their scheduling with you show here too.',
  failed: 'Couldn’t load the roster.',
  noMatch: 'No one matches',
  noMatchBody: 'Try another name.',
  showMore: 'Show more',
  moreFailed: 'Couldn’t load more people.',
  tryAgain: 'Try again',
  failedSave: 'Couldn’t save.',
  somethingWrong: 'Something went wrong. Try again.',
} as const;
