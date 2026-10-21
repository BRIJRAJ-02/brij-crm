// Settings › Scheduling › Calendars: the page's copy (spec 0024), apart from the other settings pages' own.
import type { CalendarStatus } from '@crm/data';

/** Settings › Scheduling › Calendars: the page's copy (spec 0024, AC-597, AC-599, AC-611, AC-621). */
export const strings = {
  /** The loading state's name, read by screen readers. */
  loading: 'Loading your calendars',
  /** The page's title, and its entry in the settings navigation. */
  title: 'Calendars',
  connectGoogle: 'Connect Google calendar',
  /** The page's sections. */
  connectionsSection: 'Connected calendars',
  workspaceSection: 'Workspace',
  /** Calendar sync isn't set up on this deployment. */
  offTitle: 'Calendar sync isn’t set up for this workspace',
  offText: 'Ask whoever runs Timefix for you to switch it on.',
  emptyTitle: 'No calendar connected',
  emptyText: 'Your meetings then show on the people and companies you meet.',
  failedTitle: 'Couldn’t load your calendars',
  failedText: 'Try again in a moment.',
  /** How many accounts may be connected, when the limit is reached. */
  limitReached: (max: string) => `You’ve connected ${max} calendars, the most you can. Disconnect one to add another.`,
  defaultBadge: 'Default',
  defaultHelp: 'New bookings from your booking pages are added to this calendar.',
  /** A connection's "···" menu. */
  rowActions: (account: string) => `Actions for ${account}`,
  status: {
    syncing: 'Syncing',
    connected: 'Connected',
    expired: 'Expired',
    revoked: 'Revoked',
    failed: 'Failed',
  } satisfies Record<CalendarStatus, string>,
  synced: 'Synced',
  notSyncedYet: 'Not synced yet',
  sharingLabel: 'Who sees this calendar’s meetings',
  shared: 'Shared',
  private: 'Private',
  sharingHelp: {
    shared: 'Others see the title, attendees and link',
    private: 'Others see “Private meeting” and the time',
  },
  makeDefault: 'Make default',
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
  createPeopleHelp: 'For every member’s synced meetings.',
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
    limit: { tone: 'warning', title: 'Calendar not connected', text: 'You’ve connected the most calendars you can.' },
    off: {
      tone: 'info',
      title: 'Calendar sync isn’t set up',
      text: 'Ask whoever runs Timefix for you to switch it on.',
    },
    failed: {
      tone: 'danger',
      title: 'Calendar not connected',
      text: 'Something went wrong on the way back from Google. Try again.',
    },
  },
} as const;

/** What the browser came back with, as `?calendar=` names it. */
export type ConnectResult = keyof typeof strings.results;

/** True when `value` is one of the results the connect routes send back. */
export function isConnectResult(value: unknown): value is ConnectResult {
  return typeof value === 'string' && Object.hasOwn(strings.results, value);
}
