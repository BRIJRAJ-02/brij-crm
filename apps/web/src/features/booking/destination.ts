// The line under a booking page's "Add bookings to" (spec 0024, AC-997): where the page's bookings go, and, when its
// own calendar stopped taking bookings or went, which one stopped and the default the page uses instead. Also whether
// a Video page makes no link, for the line under Location (Q57, Q77).
import type { CalendarItem, PageDestinationView } from '@crm/data';
import { strings } from './strings.ts';

/** A connection whose calendar can still take a booking's event, and its video link: as the event writer reads it. */
const LIVE_CONNECTIONS: ReadonlySet<string> = new Set(['syncing', 'connected', 'failed']);

/**
 * Why Location says a Video page makes no link, or undefined when it doesn't: the reader's own one on one page with no
 * live calendar among their connections, `reconnect` when one of them has expired (Settings › Calendars lists it as
 * needing reconnecting), else `none`. A team page's host varies, and a colleague's calendars aren't the reader's to
 * read, so neither is told; nor is anyone while either read is still on its way.
 */
export function noVideoLinkReason(input: {
  readonly kind: 'personal' | 'collective' | 'round_robin';
  /** The reader owns the page (its destination's read), or undefined while that read is on its way. */
  readonly isOwner: boolean | undefined;
  /** The reader's own connections' statuses, or undefined while they are on their way. */
  readonly connections: readonly string[] | undefined;
}): 'none' | 'reconnect' | undefined {
  const { kind, isOwner, connections } = input;
  if (kind !== 'personal' || isOwner !== true || connections === undefined) return undefined;
  if (connections.some((status) => LIVE_CONNECTIONS.has(status))) return undefined;
  return connections.includes('expired') ? 'reconnect' : 'none';
}

/** The value meaning "the owner's own destination". */
export const DEFAULT_DESTINATION = 'default';

/**
 * What the owner's Select shows and what choosing sends. A pick that can't take bookings now shows as the default,
 * where bookings go (AC-997). A pick that went shows no value, the default as its placeholder, so choosing Default
 * fires and clears the note (a Select never fires for the value it already shows). `send` answers what to save for
 * a choice, or undefined when it changes nothing.
 */
export function destinationChoice(destination: PageDestinationView): {
  readonly value: string | null;
  readonly send: (id: string | null) => string | null | undefined;
} {
  const { calendarId, status } = destination;
  const gone = status === 'unusable' && calendarId === undefined;
  const value = gone ? null : status === 'page' && calendarId !== undefined ? calendarId : DEFAULT_DESTINATION;
  // Against the stored pick: choosing the default while it only stands in for a stopped or gone pick clears it.
  const stored = gone ? undefined : status === 'default' || calendarId === undefined ? DEFAULT_DESTINATION : calendarId;
  return {
    value,
    send: (id) => (id === null || id === stored ? undefined : id === DEFAULT_DESTINATION ? null : id),
  };
}

/** The owner's hint: the usual one, or the fall back naming the calendar that stopped and the default in its place. */
export function destinationHint(destination: PageDestinationView, calendars: readonly CalendarItem[]): string {
  if (destination.status !== 'unusable') return strings.addBookingsHint;
  const pick = calendars.find((calendar) => calendar.id === destination.calendarId)?.name ?? destination.removedName;
  const current = calendars.find((calendar) => calendar.isDestination);
  // The default names where bookings go only while it can take them itself.
  const usable = current !== undefined && current.id !== destination.calendarId && current.canBeDestination;
  return strings.destinationFellBack(pick, usable ? current.name : undefined);
}
