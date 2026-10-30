// The words of Bookings › Roster, the Team week (spec 0037, job J6, AC-1289 to AC-1296, AC-1300), its cell editor,
// its row menu and its confirms (AC-1445).

/** Hours as "38 h" or "37.5 h": quarter hours show their decimal. */
const hours = (minutes: number): string => {
  const value = Math.round((minutes / 60) * 100) / 100;
  return `${String(value)} h`;
};

/** The Team week's words. */
export const teamWeekStrings = {
  title: 'Roster',
  grid: (range: string) => `Roster, ${range}`,
  /** A day's column heading: the weekday first, then the date ("Mon 2"). */
  dayShort: (weekday: string, date: string) => `${weekday} ${date}`,
  person: 'Team member',
  thisWeek: 'This week',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  search: 'Search people',
  hours,
  people: (count: number) => (count === 1 ? '1 person' : `${String(count)} people`),
  nobody: 'Nobody',
  /**
   * The footer's heading (AC-1294): who works that day, over their hours added up (each person's own merged hours,
   * the same number as the hours under their name, whatever their zone). One word: the lines under it say the rest.
   */
  working: 'Working',
  totalLabel: (day: string, count: number, minutes: number) =>
    count === 0
      ? `${day}: nobody working`
      : `${day}: ${teamWeekStrings.people(count)} working, ${hours(minutes)} added up`,
  /** Under a day's total (the brief's decision 3): how many of those working the workspace link can book. */
  linkCount: (count: number) => `${String(count)} bookable`,
  /** What a screen reader hears for a day's total while the workspace has a link. */
  totalWithLinkLabel: (total: string, title: string, count: number) =>
    count === 0 ? `${total}. ${title} can book nobody` : `${total}. ${title} can book ${teamWeekStrings.people(count)}`,
  offset: (minutes: number) => {
    const sign = minutes < 0 ? '−' : '+';
    const whole = Math.abs(minutes);
    const h = Math.floor(whole / 60);
    const m = whole % 60;
    return `UTC${sign}${String(h)}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`}`;
  },
  otherSchedules: (count: number) => (count === 1 ? '1 other schedule' : `${String(count)} other schedules`),
  off: 'Off',
  away: 'Away',
  /** A changed date, as a screen reader hears its cell (the legend's "This date only"). */
  thisWeekOnly: 'this date only',
  range: (start: string, end: string) => `${start} – ${end}`,
  rangeWords: (start: string, end: string) => `${start} to ${end}`,
  cellLabel: (day: string, name: string, words: string) => `${day}, ${name}: ${words}`,
  editorLabel: (name: string, day: string) => `${name}, ${day}`,
  /** Over the day's editor: the day, then whose it is ("Sat 31 · Ana Reyes"). */
  editorTitle: (day: string, name: string) => `${day} · ${name}`,
  dayHours: (day: string) => `Hours on ${day}`,
  /** The editor's way back on a changed date, one press: its tooltip says what the usual hours are. */
  usualIs: (words: string) => `Usual: ${words}`,
  backToUsual: 'Back to usual',
  backToUsualAt: (words: string) => `Back to usual hours, ${words}`,
  /** In the editor of a day away: the cell stays Away whatever hours the date keeps. */
  awayFirst: 'Away this day. Time off comes first.',
  cancel: 'Cancel',
  save: 'Save',
  rowActions: (name: string) => `Actions for ${name}`,
  copyToNext: 'Copy to next week',
  setUsual: 'Set usual hours',
  /** The toolbar's Copy week: everyone on the page the reader may change. */
  copyAll: 'Copy week',
  copyAllHint: 'Copy this week to next week',
  /** Over a past week's grid. */
  pastWeek: 'Past weeks are read only.',
  copyTitle: (rows: readonly { readonly name: string }[]) =>
    rows.length === 1 ? `Copy ${rows[0]?.name ?? ''}’s week to next week?` : 'Copy this week to next week?',
  copyBody: (rows: readonly { readonly name: string }[], isPartial: boolean) =>
    `Copies this week’s hours to next week${rows.length === 1 ? '' : ` for ${teamWeekStrings.namesOf(rows)}`}.${isPartial ? ' People not shown keep theirs.' : ''}`,
  /** "Ada Lovelace, Sam Lee and 3 more": who a copy covers, named. */
  namesOf: (rows: readonly { readonly name: string }[]) => {
    const named = rows.slice(0, 2).map((row) => row.name);
    const rest = rows.length - named.length;
    return rest > 0 ? `${named.join(', ')} and ${String(rest)} more` : named.join(' and ');
  },
  copyAction: 'Copy',
  copied: (rows: readonly { readonly name: string }[], changed: number) =>
    changed === 0
      ? 'Next week already matched this week.'
      : rows.length === 1
        ? `${rows[0]?.name ?? ''}’s week copied to next week.`
        : `Copied to next week for ${teamWeekStrings.people(changed)}.`,
  /** On a row the reader may not change, beside rows they may. */
  viewOnly: 'View only',
  /** Between the quiet extras after a person's hours. */
  metaSeparator: ' · ',
  usualTitle: (name: string | undefined) => (name === undefined ? 'Set usual hours' : `Set ${name}’s usual hours`),
  usualFor: 'People',
  usualForPlaceholder: 'Choose people…',
  usualWeek: 'Usual week',
  /** What Save replaces, once someone is chosen; changes for one date stay. */
  usualBody: (count: number) => `Replaces usual hours for ${teamWeekStrings.people(count)}.`,
  usualAction: 'Save',
  usualDone: (count: number) =>
    count === 0 ? 'Their usual hours were already these.' : `Usual hours set for ${teamWeekStrings.people(count)}.`,
  legendUsual: 'Usual',
  legendChanged: 'This date only',
  seesOnlyYou: 'Teammates show here once they share their hours with you.',
  failed: 'Couldn’t load the roster.',
  noMatch: 'No one matches',
  noMatchBody: 'Try another name.',
  clearSearch: 'Clear search',
  showMore: 'Show more',
  moreFailed: 'Couldn’t load more people.',
  tryAgain: 'Try again',
  failedSave: 'Couldn’t save.',
  somethingWrong: 'Something went wrong. Try again.',
} as const;
