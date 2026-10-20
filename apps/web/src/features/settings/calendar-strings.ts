// Settings › Account › Calendars: the page's copy (spec 0024), apart from the other settings pages' own.
import type { CalendarStatus } from '@crm/data';

/** Settings › Account › Calendars: the page's copy (spec 0024, AC-597, AC-599, AC-611, AC-621). */
export const strings = {
  /** The page's title, and its entry in the settings navigation. */
  title: 'Calendars',
  description: 'Connect your calendar so your meetings show on the people and companies you meet.',
  connectGoogle: 'Connect Google calendar',
  /** Calendar sync isn't set up on this deployment. */
  offTitle: 'Calendar sync isn’t set up for this workspace',
  offText: 'Ask whoever runs Timefix for you to switch it on.',
  emptyTitle: 'No calendar connected',
  emptyText: 'Connect one and your meetings with contacts appear on their records.',
  failedTitle: 'Couldn’t load your calendars',
  failedText: 'Try again in a moment.',
  /** How many accounts may be connected, when the limit is reached. */
  limitReached: (max: string) => `You’ve connected ${max} calendars, the most you can. Disconnect one to add another.`,
  google: 'Google',
  defaultBadge: 'Default',
  status: {
    syncing: 'Syncing',
    connected: 'Connected',
    expired: 'Expired',
    revoked: 'Revoked',
    failed: 'Failed',
  } satisfies Record<CalendarStatus, string>,
  terms: {
    status: 'Status',
    lastSynced: 'Last synced',
    sharing: 'Who sees its meetings',
  },
  notYet: 'Not yet',
  sharingLabel: 'Who sees this calendar’s meetings',
  shared: 'Shared',
  private: 'Private',
  sharingHelp: {
    shared: 'Anyone who can see a meeting’s people sees its title, attendees and link.',
    private: 'Others see “Private meeting” and its time only.',
  },
  makeDefault: 'Make default',
  /** Local development only: Google's notices can't reach a laptop, so sync waits for the 15 minute poll. */
  syncNow: 'Sync now',
  disconnect: 'Disconnect',
  disconnectTitle: 'Disconnect this calendar?',
  disconnectText: (account: string) =>
    `Meetings from ${account} stop syncing, and the ones no one else’s calendar holds leave your records. Your calendar itself isn’t changed.`,
  keep: 'Keep it',
  /** The workspace setting, for owners and admins (AC-609). */
  createPeople: 'Add people from meetings',
  createPeopleHelp:
    'When someone outside the workspace is invited to a synced meeting and isn’t in Timefix yet, add them as a person, linked to their company.',
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
