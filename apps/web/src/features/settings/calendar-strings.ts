// Settings › Scheduling › Calendars: the page's copy (spec 0024), apart from the other settings pages' own.
import type { CalendarStatus } from '@crm/data';

/** Settings › Scheduling › Calendars: the page's copy (spec 0024, AC-597, AC-599, AC-611, AC-621). */
export const strings = {
  /** The loading state's name, read by screen readers. */
  loading: 'Loading your calendars',
  /** The page's title, and its entry in the settings navigation. */
  title: 'Calendars',
  connectGoogle: 'Connect Google calendar',
  connectOutlook: 'Connect Outlook calendar',
  /** One button that offers both providers, when both are on. */
  connect: 'Connect calendar',
  connectMenu: 'Connect a calendar',
  google: 'Google Calendar',
  outlook: 'Outlook',
  /** The page's sections. */
  connectionsSection: 'Connected calendars',
  workspaceSection: 'For everyone in the workspace',
  /** Calendar sync isn't set up on this deployment. */
  offTitle: 'Calendar sync is off',
  offText: 'Connecting calendars isn’t available here yet. Your booking pages still use your hours.',
  emptyTitle: 'No calendar connected',
  emptyText: 'Connect your calendar so bookings avoid your busy times and your meetings show on the people you meet.',
  failedTitle: 'Couldn’t load your calendars',
  failedText: 'Try again in a moment.',
  /** How many accounts may be connected, when the limit is reached. */
  limitReached: (max: string) => `You’ve connected ${max} accounts, the most you can. Disconnect one to add another.`,
  /** The one word of help on the page: where bookings go, across accounts. */
  defaultHelpLabel: 'Where bookings go',
  defaultHelp:
    'New bookings from your booking pages go on this calendar. A booking page can pick another one in its editor.',
  defaultHelpExample:
    'With Google and Outlook connected, bookings go on this one calendar. Busy times from every calendar with Check for conflicts on are kept free.',
  calendarsGroup: 'Calendars',
  /** Where new bookings go (the member's destination), one Select across every account. */
  addBookingsTo: 'Add bookings to',
  addBookingsHelp: 'New bookings from your booking pages go on this calendar.',
  chooseCalendar: 'Choose a calendar',
  noWritable: 'None of your calendars can take bookings. Connect one you can add events to.',
  calendarsLoadingShort: 'Loading calendars',
  calendarsFailedAll: 'Couldn’t load your calendars. Try again below.',
  logsBadge: 'Logs to CRM',
  /** Each account's calendars, a compact table: the column headers once, above the rows. */
  calendarsIn: (account: string) => `Calendars in ${account}`,
  calendarColumn: 'Calendar',
  conflictsColumn: 'Check for conflicts',
  weekColumn: 'Show on my week',
  optionsColumn: 'Options',
  checkFor: (name: string) => `Check ${name} for conflicts`,
  showOn: (name: string) => `Show ${name} on my week`,
  calendarOptions: (name: string) => `${name} options`,
  logMeetings: 'Log meetings to CRM',
  /** A calendar that couldn't be read, said once under the account's list. */
  warningLine: (name: string, message: string) => `${name}: ${message}`,
  calendarsLoading: 'Loading this account’s calendars',
  calendarsFailed: 'Couldn’t load this account’s calendars.',
  tryAgain: 'Try again',
  noCalendars: 'No calendars found in this account yet.',
  /** An account listed with calendars but none in use (no main calendar among them). */
  noneInUse: 'None of this account’s calendars are in use.',
  /** A calendar's row. */
  colour: (name: string) => `${name} colour`,
  /** The quiet toasts a switch raises once saved, each with Undo. */
  saved: {
    checkConflicts: (name: string, on: boolean) =>
      on ? `${name} is checked for conflicts` : `${name} is no longer checked for conflicts`,
    showInWeek: (name: string, on: boolean) => (on ? `${name} shows on your week` : `${name} is hidden from your week`),
    sync: (name: string, on: boolean) =>
      on ? `${name}’s meetings are logged to the CRM` : `${name}’s meetings are no longer logged to the CRM`,
  },
  colourSaved: (name: string) => `${name}’s colour changed`,
  defaultSaved: (name: string) => `New bookings now go to ${name}`,
  /** After a change leaves a calendar not in use: it stays on its row until the person leaves, then never shows. */
  noLongerListed: (saved: string, name: string) => `${saved}. ${name} won’t be listed once you leave this page.`,
  sharingSaved: (account: string) => `What teammates see of ${account}’s meetings changed`,
  undo: 'Undo',
  /** New bookings moved off a calendar the provider removed (AC-1005). */
  fellBackTitle: 'Where bookings go changed',
  fellBackText: (now: string, was: string) => `New bookings now go to ${now}. ${was} stopped taking them.`,
  fellBackNone: (was: string) =>
    `${was} stopped taking bookings and no other calendar can take them. Pick a calendar under Add bookings to.`,
  /** A connection's "···" menu. */
  rowActions: (account: string) => `Actions for ${account}`,
  status: {
    syncing: 'Syncing',
    connected: 'Connected',
    expired: 'Needs reconnecting',
    revoked: 'Access removed',
    failed: 'Stopped syncing',
  } satisfies Record<CalendarStatus, string>,
  synced: 'Synced',
  notSyncedYet: 'Not synced yet',
  /** What teammates see of an account's meetings (the owner asked what Shared and Private meant, 22 Oct 2026). */
  sharingLabel: 'Teammates see',
  shared: 'Full details',
  private: 'Busy only',
  sharingHelp: {
    shared: 'Title, attendees and link',
    private: 'Shown as “Private meeting” with the time',
  },
  sharingInfo:
    'Controls what other members of this workspace see of meetings from this calendar account, on their calendar and in Bookings. You always see everything.',
  reconnect: 'Reconnect',
  /** Local development only: Google's notices can't reach a laptop, so sync waits for the 15 minute poll. */
  syncNow: 'Sync now',
  disconnect: 'Disconnect',
  /** The confirm names the calendar it ends (the owner's rule for every confirm, 21 October 2026). */
  disconnectTitle: (account: string) => `Disconnect ${account}?`,
  disconnectText: 'Its meetings leave your records and its busy times stop blocking your booking pages.',
  disconnected: (account: string) => `Disconnected ${account}.`,
  cancel: 'Cancel',
  disconnecting: 'Disconnecting',
  disconnectFailed: 'That didn’t disconnect. Try again in a moment.',
  /** The workspace setting, for owners and admins (AC-609). */
  createPeople: 'Add people from meetings',
  createPeopleHelp: 'Applies to every member’s synced meetings.',
  createPeopleInfo:
    'A guest who isn’t in Timefix yet becomes a person, linked to the company with their email’s domain.',
  createPeopleExample: 'A meeting with ana@acme.com adds Ana to People, linked to Acme if a company has acme.com.',
  /** Closes the note about how connecting went. */
  dismiss: 'Dismiss',
  /** What the browser came back from Google with (`?calendar=`). */
  results: {
    connected: {
      tone: 'success',
      title: 'Calendar connected',
      text: 'Your meetings are syncing. They show on records within a few minutes.',
    },
    denied: {
      tone: 'info',
      title: 'Calendar not connected',
      text: 'You didn’t give Timefix access. Connect again whenever you like.',
    },
    scope: {
      tone: 'warning',
      title: 'Calendar not connected',
      text: 'Timefix needs to see your events and when you’re busy. Connect again and leave both boxes ticked.',
    },
    limit: { tone: 'warning', title: 'Calendar not connected', text: 'You’ve connected the most accounts you can.' },
    off: {
      tone: 'info',
      title: 'Calendar sync is off',
      text: 'Connecting calendars isn’t available here yet. Your booking pages still use your hours.',
    },
    failed: {
      tone: 'danger',
      title: 'Calendar not connected',
      text: 'Something went wrong on the way back from your calendar. Try again.',
    },
  },
} as const;

/** What the browser came back with, as `?calendar=` names it. */
export type ConnectResult = keyof typeof strings.results;

/** True when `value` is one of the results the connect routes send back. */
export function isConnectResult(value: unknown): value is ConnectResult {
  return typeof value === 'string' && Object.hasOwn(strings.results, value);
}
