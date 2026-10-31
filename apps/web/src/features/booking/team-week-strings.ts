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
  /** A day's column heading: the weekday first, then the date ("Mon 2"). */
  dayShort: (weekday: string, date: string) => `${weekday} ${date}`,
  person: 'Team member',
  thisWeek: 'This week',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  search: 'Search people',
  /** The team filter (AC-1289). */
  teamFilter: 'Filter by team',
  everyone: 'Everyone',
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
  /** Under a day's total (the brief's decision 3): how many of those working the workspace link can book. */
  linkCount: (count: number) => `Link: ${String(count)}`,
  /** The footer's heading while the workspace has a link: it names the link once, so "Link: 3" reads on its own. */
  workingWithLink: (title: string) => `Working, hours added up. Link: ${title}`,
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
  /** The toolbar's Copy week: everyone on the page the reader may change. */
  copyAll: 'Copy to next week',
  copyTitle: (rows: readonly { readonly name: string }[]) =>
    rows.length === 1
      ? `Copy ${rows[0]?.name ?? ''}’s week to next week?`
      : `Copy this week to next week for ${teamWeekStrings.people(rows.length)}?`,
  copyBody: (rows: readonly { readonly name: string }[], range: string, isPartial: boolean) =>
    `This replaces ${rows.length === 1 ? `${rows[0]?.name ?? ''}’s hours` : `the hours of ${teamWeekStrings.namesOf(rows)}`} for ${range} with this week’s. Days on usual hours this week are on usual hours next week too.${isPartial ? ' People not shown here keep their hours.' : ''}`,
  /** "Ada Lovelace, Sam Lee and 3 more": who a copy covers, named. */
  namesOf: (rows: readonly { readonly name: string }[]) => {
    const named = rows.slice(0, 2).map((row) => row.name);
    const rest = rows.length - named.length;
    return rest > 0 ? `${named.join(', ')} and ${String(rest)} more` : named.join(' and ');
  },
  copyAction: 'Copy week',
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
  usualBody: (count: number) =>
    count === 0
      ? 'Choose who these hours are for.'
      : `This replaces the usual hours for ${teamWeekStrings.people(count)}. Changes for one date stay as they are.`,
  usualAction: 'Set usual hours',
  usualDone: (count: number) =>
    count === 0 ? 'Their usual hours were already these.' : `Usual hours set for ${teamWeekStrings.people(count)}.`,
  readOnlyWeek: 'Weeks before this one are read only.',
  /** The hint after the legend: what selecting a day does, and what the hours are for. */
  explain: 'Select a day to change that date only. Usual hours repeat every week; booking pages offer these hours.',
  legendUsual: 'Usual hours',
  legendChanged: 'Changed for this date',
  seesOnlyYou: 'You see your own hours. People who share their scheduling with you show here too.',
  failed: 'Couldn’t load the roster.',
  noMatch: 'No one matches',
  noMatchBody: 'Try another name.',
  noMatchInTeam: 'Try another team or name.',
  noMatchTeam: 'Try another team.',
  showMore: 'Show more',
  moreFailed: 'Couldn’t load more people.',
  tryAgain: 'Try again',
  failedSave: 'Couldn’t save.',
  somethingWrong: 'Something went wrong. Try again.',
} as const;
