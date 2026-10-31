// The words of Availability's Time off section (spec 0037, AC-1281 to AC-1288), its dialog and its confirm.
import type { TimeOffReason } from '@crm/data';

/** Time off's words. */
export const timeOffStrings = {
  title: 'Time off',
  loading: 'Loading time off',
  failed: 'Couldn’t load time off.',
  none: 'No time off planned',
  past: 'Past',
  add: 'Add time off',
  addFor: (first: string) => `Add time off for ${first}`,
  edit: 'Edit time off',
  editFor: (first: string) => `Edit ${first}’s time off`,
  columns: { days: 'Days', what: 'Details', actions: 'Actions' },
  actionsFor: (days: string) => `Actions for ${days}`,
  editAction: 'Edit',
  deleteAction: 'Delete',
  away: 'Away',
  reasons: {
    vacation: 'Vacation',
    sick: 'Sick leave',
    travel: 'Travel',
    holiday: 'Public holiday',
    other: 'Other',
  } satisfies Record<TimeOffReason, string>,
  covers: (name: string) => `${name} covers`,
  changedBy: (name: string) => `Changed by ${name}`,
  you: 'you',
  someone: 'someone',
  // The dialog.
  days: 'Days',
  // Fresha's line: what time off does, said where the days are picked.
  daysHint: 'Whole days, in your time zone.',
  daysHintFor: (first: string) => `Whole days, in ${first}’s time zone.`,
  /** Whose time off, for someone who Manages others (spec 0037, AC-1272): Me first, then them by name. */
  forLabel: 'For',
  forMe: 'Me',
  // Workable's plain count, once the days are picked.
  dayCount: (count: number) => (count === 1 ? '1 day off.' : `${String(count)} days off.`),
  // Remote's banner when someone with Manage acts for a colleague.
  onBehalf: (first: string) => `You’re adding time off on ${first}’s behalf. ${first} gets an email about it.`,
  onBehalfEdit: (first: string) =>
    `You’re changing ${first}’s time off on their behalf. ${first} gets an email about it.`,
  pickDays: 'Pick the days.',
  reason: 'Reason',
  standin: 'Who covers',
  nobody: 'Nobody',
  note: 'Note',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  added: 'Time off added',
  changed: 'Time off saved',
  // After a save over meetings (AC-1285).
  // The second step says the time off is saved; the meetings inside are what is left to do.
  savedTitle: 'Time off saved',
  savedTitleFor: (first: string) => `Time off for ${first} saved`,
  // Deputy's warning: the meetings already booked in the period, listed (AC-1285).
  inside: (count: number) =>
    count === 1 ? 'You have 1 meeting during this period.' : `You have ${String(count)} meetings during this period.`,
  insideFor: (first: string, count: number) =>
    count === 1
      ? `${first} has 1 meeting during this period.`
      : `${first} has ${String(count)} meetings during this period.`,
  insideKept: 'They stay booked and show Host away on Bookings, so you can move or reassign them.',
  insideMore: (count: number) => (count === 1 ? 'And 1 more.' : `And ${String(count)} more.`),
  done: 'Done',
  openBookings: 'Open Bookings',
  // Delete (AC-1445).
  deleteTitle: (days: string) => `Delete time off, ${days}?`,
  deleteBody: 'Online bookings can be placed on these days again.',
  deleteBodyFor: (first: string) => `Online bookings can be placed with ${first} on these days again.`,
  deleteCommit: 'Delete time off',
  deleting: 'Deleting…',
  deleted: 'Time off deleted',
  // Elsewhere.
  somethingWrong: 'Something went wrong. Try again.',
} as const;
