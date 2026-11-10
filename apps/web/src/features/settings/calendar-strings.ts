// Bookings settings › Calendars: the page's copy (spec 0024), apart from the other settings pages' own. Plain words,
// no "sync" (the owner's calendar connect mock, 9 November 2026): Updated, Refresh now, Needs reconnecting.
import type { CalendarStatus } from '@crm/data';
import type { ConnectResult } from './connect-result.ts';

/** Bookings settings › Calendars: the page's copy (spec 0024, AC-597, AC-599, AC-611, AC-621). */
export const strings = {
  /** The loading state's name, read by screen readers. */
  loading: 'Loading your calendars',
  /** The page's title, and its entry in the settings navigation. */
  title: 'Calendars',
  /** The one way in: a button that opens the connect popup. */
  connect: 'Connect calendar',
  /** Each provider's button in the popup, named in full for screen readers (`connectWith`). */
  connectShort: 'Connect',
  google: 'Google Calendar',
  outlook: 'Outlook',
  /** Under each provider's name in the popup: which accounts it takes. */
  googleAccounts: 'Gmail or Google Workspace',
  outlookAccounts: 'Outlook.com or Microsoft 365',
  /** The page's sections: which accounts, which calendars block your times, where bookings go. */
  accountsSection: 'Your accounts',
  accountsCount: (count: string, max: string) => `${count} of ${max} connected.`,
  accountsFull: (max: string) => `${max} of ${max} connected. Disconnect one to add another.`,
  conflictsSection: 'Check for conflicts',
  conflictsText: 'Times busy on these calendars aren’t offered.',
  addBookingsTo: 'Add new bookings to',
  bookingsCalendar: 'Calendar',
  bookingsCalendarText: 'Each booking page can pick its own.',
  workspaceSection: 'Workspace',
  /** Calendar sync isn't set up on this deployment. */
  offTitle: 'Calendar sync is off',
  offText: 'Booking pages still use your hours.',
  emptyTitle: 'No calendar connected',
  emptyText: 'Connect one so guests only see times you’re free.',
  failedTitle: 'Couldn’t load your calendars',
  failedText: 'Try again in a moment.',
  chooseCalendar: 'Choose a calendar',
  noWritable: 'No calendar can take bookings yet. Guests get them by email.',
  calendarsLoadingShort: 'Loading calendars',
  logsBadge: 'Logs to CRM',
  checkFor: (name: string) => `Check ${name} for conflicts`,
  calendarOptions: (name: string) => `${name} options`,
  showOnWeek: 'Show on my week',
  showOnWeekHelp: 'Its events beside your bookings',
  logMeetings: 'Log meetings to CRM',
  logMeetingsHelp: 'Adds its meetings to people’s records',
  /** A calendar that couldn't be read, on its own row. */
  calendarsLoading: 'Loading this account’s calendars',
  calendarsFailed: 'Couldn’t load this account’s calendars.',
  tryAgain: 'Try again',
  noCalendars: 'No calendars found in this account yet.',
  /** An account listed with calendars but none in use (no main calendar among them). */
  noneInUse: 'None of this account’s calendars are in use.',
  /** A calendar on an account that stopped: its switch keeps its setting, but nothing is read until it reconnects. */
  reconnectToCheck: 'Reconnect the account to check it',
  colour: (name: string) => `${name} colour`,
  /** The quiet toasts a change raises once saved, each with Undo. */
  saved: {
    checkConflicts: (name: string, on: boolean) =>
      on ? `${name} now blocks your times` : `${name} no longer blocks your times`,
    showInWeek: (name: string, on: boolean) => (on ? `${name} shows on your week` : `${name} hidden from your week`),
    sync: (name: string, on: boolean) => (on ? `${name} adds meetings to records` : `${name} stops adding meetings`),
  },
  colourSaved: 'Colour changed',
  defaultSaved: (name: string) => `New bookings go to ${name}`,
  /** After a change leaves a calendar not in use: it stays on its row until the person leaves, then never shows. */
  noLongerListed: (saved: string) => `${saved}. Gone from this list next visit.`,
  sharingSaved: (sharing: 'shared' | 'private') =>
    sharing === 'private' ? 'Teammates now see busy only' : 'Teammates now see full details',
  undo: 'Undo',
  /** New bookings moved off a calendar the provider removed (AC-1005). */
  fellBackTitle: 'Where bookings go changed',
  fellBackText: (now: string, was: string) => `Now ${now}. ${was} stopped taking bookings.`,
  fellBackNone: (was: string) => `${was} stopped taking bookings. Pick another under Add new bookings to.`,
  /** An account's "···" menu. */
  rowActions: (account: string) => `More for ${account}`,
  /** An account's state, in plain words. */
  status: {
    syncing: 'Connecting',
    connected: 'Connected',
    expired: 'Needs reconnecting',
    revoked: 'Needs reconnecting',
    failed: 'Needs reconnecting',
  } satisfies Record<CalendarStatus, string>,
  /** Why an account needs reconnecting, when the provider gave no message. */
  why: {
    syncing: '',
    connected: '',
    expired: 'Its sign in expired',
    revoked: 'Access was removed',
    failed: 'It stopped updating',
  } satisfies Record<CalendarStatus, string>,
  updated: 'Updated',
  notUpdatedYet: 'Not updated yet',
  /** What teammates see of an account's meetings: the two choices carry their own help. */
  sharingLabel: 'Teammates see',
  shared: 'Full details',
  private: 'Busy only',
  sharingHelp: {
    shared: 'Title, guests and link',
    private: 'Shown as Private meeting',
  },
  reconnect: 'Reconnect',
  refresh: 'Refresh now',
  refreshHelp: 'Fetch your latest events',
  refreshing: (account: string) => `Fetching the latest from ${account}`,
  disconnect: 'Disconnect',
  /** The confirm names the calendar it ends (the owner's rule for every confirm, 21 October 2026). */
  disconnectTitle: (account: string) => `Disconnect ${account}?`,
  disconnectText: 'Its meetings leave your records, and its busy times stop blocking bookings.',
  disconnected: (account: string) => `${account} disconnected`,
  cancel: 'Cancel',
  disconnecting: 'Disconnecting…',
  disconnectFailed: 'Couldn’t disconnect. Try again.',
  /** The workspace setting, for owners and admins (AC-609): the example is the whole help. */
  createPeople: 'Add people from meetings',
  createPeopleExample: 'A meeting with ana@acme.com adds Ana to People, linked to Acme if a company has acme.com.',
  dismiss: 'Dismiss',
  /** The connect popup (one popup, one title; the owner's mock, 9 November 2026). */
  connectTitle: 'Connect a calendar',
  connectText: 'Guests only see times you’re free.',
  connectWith: (provider: string) => `Connect ${provider}`,
  /** Back from the provider with a new account: which of its calendars block your times. */
  chooseTitle: 'Which calendars should block your times?',
  chooseText: 'Times busy on these calendars aren’t offered.',
  done: 'Done',
  close: 'Close',
  connected: 'Calendar connected',
  reconnected: 'Calendar reconnected',
  /** What the browser came back from the provider with (`?calendar=`), when it wasn't connected: a step of the popup. */
  problems: {
    denied: { title: 'Nothing was connected', text: 'Access wasn’t given. Try again and choose Allow.' },
    scope: { title: 'One permission was missing', text: 'Try again and tick every box on the consent screen.' },
    limit: { title: 'That’s the most accounts', text: 'Disconnect one, then add this one.' },
    off: { title: 'Calendar sync is off', text: 'Booking pages still use your hours.' },
    failed: { title: 'That didn’t connect', text: 'Something went wrong on our side. Try again in a moment.' },
  } as const satisfies Record<Exclude<ConnectResult, 'connected'>, { readonly title: string; readonly text: string }>,
} as const;
