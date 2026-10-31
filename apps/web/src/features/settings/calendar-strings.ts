// Settings › Scheduling › Calendars: the page's copy (spec 0024), apart from the other settings pages' own.
import type { CalendarStatus } from '@crm/data';
import type { ConnectResult } from './connect-result.ts';

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
  offText: 'Booking pages still use your hours.',
  /** Under the title, two provider buttons: the picture of what to do, so no sentence of why. */
  emptyTitle: 'No calendar connected',
  failedTitle: 'Couldn’t load your calendars',
  failedText: 'Try again in a moment.',
  /** How many accounts may be connected, when the limit is reached. */
  limitReached: (max: string) => `Limit of ${max} accounts. Disconnect one to add another.`,
  calendarsGroup: 'Calendars',
  /** Where new bookings go (the member's destination), one Select across every account: the label is the whole help. */
  addBookingsTo: 'Add bookings to',
  chooseCalendar: 'Choose a calendar',
  noWritable: 'No calendar can take bookings. Connect one you can add events to.',
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
    checkConflicts: (name: string, on: boolean) => (on ? `Checking ${name} for conflicts` : `Not checking ${name}`),
    showInWeek: (name: string, on: boolean) => (on ? `${name} on your week` : `${name} off your week`),
    sync: (name: string, on: boolean) => (on ? `Logging ${name} to the CRM` : `Not logging ${name}`),
  },
  colourSaved: 'Colour changed',
  defaultSaved: (name: string) => `Bookings go to ${name}`,
  /** After a change leaves a calendar not in use: it stays on its row until the person leaves, then never shows. */
  noLongerListed: (saved: string) => `${saved}. Gone from this list next visit.`,
  sharingSaved: (sharing: 'shared' | 'private') =>
    sharing === 'private' ? 'Teammates see busy only' : 'Teammates see full details',
  undo: 'Undo',
  /** New bookings moved off a calendar the provider removed (AC-1005). */
  fellBackTitle: 'Where bookings go changed',
  fellBackText: (now: string, was: string) => `Now ${now}. ${was} stopped taking bookings.`,
  fellBackNone: (was: string) => `${was} stopped taking bookings. Pick another under Add bookings to.`,
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
  /** What teammates see of an account's meetings (the owner asked what Shared and Private meant, 22 Oct 2026): the two choices carry their own help, so no tip. */
  sharingLabel: 'Teammates see',
  shared: 'Full details',
  private: 'Busy only',
  sharingHelp: {
    shared: 'Title, attendees and link',
    private: 'Shown as “Private meeting” with the time',
  },
  reconnect: 'Reconnect',
  /** Local development only: Google's notices can't reach a laptop, so sync waits for the 15 minute poll. */
  syncNow: 'Sync now',
  disconnect: 'Disconnect',
  /** The confirm names the calendar it ends (the owner's rule for every confirm, 21 October 2026). */
  disconnectTitle: (account: string) => `Disconnect ${account}?`,
  disconnectText: 'Its meetings leave your records. Its busy times stop blocking bookings.',
  disconnected: (account: string) => `Disconnected ${account}.`,
  cancel: 'Cancel',
  disconnecting: 'Disconnecting',
  disconnectFailed: 'Couldn’t disconnect. Try again.',
  /** The workspace setting, for owners and admins (AC-609): the example is the whole help. */
  createPeople: 'Add people from meetings',
  createPeopleExample: 'A meeting with ana@acme.com adds Ana to People, linked to Acme if a company has acme.com.',
  /** Closes the note about how connecting went. */
  dismiss: 'Dismiss',
  /** What the browser came back from Google with (`?calendar=`). */
  results: {
    connected: {
      tone: 'success',
      title: 'Calendar connected',
      text: 'Meetings show on records in a few minutes.',
    },
    denied: { tone: 'info', title: 'Calendar not connected', text: 'Access wasn’t given.' },
    scope: {
      tone: 'warning',
      title: 'Calendar not connected',
      text: 'Both boxes need a tick. Connect again.',
    },
    limit: { tone: 'warning', title: 'Calendar not connected', text: 'Account limit reached.' },
    off: {
      tone: 'info',
      title: 'Calendar sync is off',
      text: 'Booking pages still use your hours.',
    },
    failed: {
      tone: 'danger',
      title: 'Calendar not connected',
      text: 'Couldn’t connect. Try again.',
    },
  } as const satisfies Record<ConnectResult, unknown>,
} as const;
