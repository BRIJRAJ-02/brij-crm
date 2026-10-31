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
  /** Whose time off, for someone who Manages others (spec 0037, AC-1272): Me first, then them by name. */
  forLabel: 'For',
  forMe: 'Me',
  // Remote's banner when someone with Manage acts for a colleague: one line (spec 0058, AC-15).
  onBehalf: (first: string) => `${first} gets an email about it.`,
  onBehalfEdit: (first: string) => `${first} gets an email about the change.`,
  /** The one hint left (spec 0058, AC-15): acting for a colleague, whose zone the days are in. */
  daysZoneFor: (first: string) => `In ${first}’s time zone.`,
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
  // Deputy's warning: the meetings already booked in the period, as a count (AC-1285; spec 0058, AC-15).
  inside: (count: number) =>
    count === 1 ? '1 meeting in this time off' : `${String(count)} meetings in this time off`,
  insideFor: (first: string, count: number) =>
    count === 1 ? `${first} has 1 meeting in this time off` : `${first} has ${String(count)} meetings in this time off`,
  insideKept: 'They stay booked, marked Host away on Bookings.',
  insideMore: (count: number) => (count === 1 ? 'And 1 more.' : `And ${String(count)} more.`),
  done: 'Done',
  openBookings: 'Open Bookings',
  // Delete (AC-1445).
  deleteTitle: (days: string) => `Delete time off, ${days}?`,
  deleteBody: 'These days open for booking again.',
  deleteBodyFor: (first: string) => `These days open for booking with ${first} again.`,
  deleteCommit: 'Delete time off',
  deleting: 'Deleting…',
  deleted: 'Time off deleted',
  // Elsewhere.
  somethingWrong: 'Something went wrong. Try again.',
} as const;
