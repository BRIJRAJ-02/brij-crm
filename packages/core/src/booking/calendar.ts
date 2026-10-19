// The two calendar calls booking needs (spec 0025), as narrow functions the
// api passes in, shaped like spec 0024's CalendarProvider `freeBusy` and
// `createEvent`. Booking never sees a connection, a token or a provider:
// `connected.ts` builds them over spec 0024's connections when calendar sync
// is on, and with `CALENDAR_SYNC` off the api passes `NO_CALENDAR`.
//
// Failure is a value, never an empty list (a lesson from an earlier
// scheduling build: an unreadable calendar that answered `[]` sold busy
// hours). A host whose calendar refuses us until they reconnect is `blocked`:
// the page offers nothing for them (fail closed). A passing outage is
// `unavailable`: the page offers availability minus bookings (fail open), as
// it does for a host with no calendar at all (`none`, AC-631).

import type { BusyInterval } from '../calendar/provider.ts';

/** One busy interval, ISO 8601 UTC, the end exclusive: spec 0024's own. */
export type { BusyInterval };

/** What a host's calendars said about a range. */
export type BusyAnswer =
  | { readonly status: 'read'; readonly busy: readonly BusyInterval[] }
  /** The host has no connected calendar (AC-631): availability and bookings only, and the builder warns. */
  | { readonly status: 'none' }
  /** A grant refused until the host reconnects: nothing is offered for them. */
  | { readonly status: 'blocked' }
  /** A passing failure (5xx, network, rate limit): offered as if no calendar. */
  | { readonly status: 'unavailable' };

/** Every connected calendar of one member, unioned: spec 0024's `freeBusy(tokens, from, to)` over the member's connections. */
export type BusyReader = (request: {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly from: string;
  readonly to: string;
}) => Promise<BusyAnswer>;

/** One attendee of the event. */
export interface EventAttendee {
  readonly email: string;
  readonly name: string;
}

/** The event a booking puts on the host's calendar (spec 0024's `NewEvent`, AC-633). */
export interface BookingEvent {
  readonly workspaceId: string;
  /** Whose calendar holds it: the organiser. */
  readonly hostMemberId: string;
  /** Spec 0024 links the meeting it writes back to this booking (`meetings.booking_id`). */
  readonly bookingId: string;
  readonly title: string;
  /** The visitor's answers, as plain text. */
  readonly description: string;
  readonly start: string;
  readonly end: string;
  /** The visitor; the host is the organiser. */
  readonly attendees: readonly EventAttendee[];
  /** Ask the provider for a video link (the page's location is video). */
  readonly video: boolean;
  /** An address, a phone number or custom text, for the other locations. */
  readonly location?: string;
}

/** What the writer made: spec 0024's meeting row, when it wrote one, and the video link. */
export interface WrittenEvent {
  readonly meetingId?: string;
  readonly videoUrl?: string;
}

/**
 * Puts the event on the host's calendar: spec 0024's `createEvent`, which
 * also writes the meeting row so timelines show it at once. Throws when it
 * can't; booking retries, then keeps the booking without an event.
 */
export type EventWriter = (event: BookingEvent) => Promise<WrittenEvent>;

/** The calendar calls booking takes. */
export interface BookingCalendar {
  readonly busy: BusyReader;
  readonly events: EventWriter;
}

/**
 * No calendar sync: every host has none (AC-631), and no event is made (the
 * booking still stands). The api's default while `CALENDAR_SYNC` is off.
 */
export const NO_CALENDAR: BookingCalendar = Object.freeze({
  busy: () => Promise.resolve({ status: 'none' } as const),
  events: () => Promise.resolve({}),
});

/**
 * A busy reader that remembers each answer for `ttlMs` (spec: slots cached 60
 * seconds per page and day), keyed by member and range, at most `max` entries
 * (the oldest dropped first). Only `read` and `none` answers are kept, so a
 * failure is asked again. The booking's own recheck reads past it (`fresh`).
 */
export function createBusyCache(
  reader: BusyReader,
  options: { readonly ttlMs?: number; readonly max?: number; readonly now?: () => number } = {},
): BusyReader & { readonly fresh: BusyReader } {
  const ttlMs = options.ttlMs ?? 60_000;
  const max = options.max ?? 2_000;
  const now = options.now ?? Date.now;
  const kept = new Map<string, { readonly at: number; readonly answer: BusyAnswer }>();
  const cached: BusyReader = async (request) => {
    const key = `${request.workspaceId}:${request.memberId}:${request.from}:${request.to}`;
    const hit = kept.get(key);
    if (hit !== undefined && now() - hit.at < ttlMs) return hit.answer;
    const answer = await reader(request);
    if (answer.status === 'read' || answer.status === 'none') {
      kept.delete(key);
      kept.set(key, { at: now(), answer });
      while (kept.size > max) {
        const oldest = kept.keys().next();
        if (oldest.done === true) break;
        kept.delete(oldest.value);
      }
    }
    return answer;
  };
  return Object.assign(cached, { fresh: reader });
}
