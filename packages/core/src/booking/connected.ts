// Booking's calendar calls over spec 0024's connections (spec 0025, AC-630,
// AC-633): the busy reader is spec 0024's `freeBusy` for the host (every
// calendar they connected, unioned; a failing one is read past and named,
// and only a refused default calendar, or every calendar failing, closes the
// host's times), and the event writer its `createEvent` on the host's
// default calendar (AC-711; their oldest live one while none is the
// default), which also writes the meeting row at once,
// linked to the booking. Both run as the system (the visitor has no scope of
// their own in the workspace). A provider's failure becomes the answer
// booking expects: a refused grant `blocked` (nothing offered), a passing
// outage `unavailable` (offered as if no calendar).
import type { Database } from '@crm/db';
import { systemScope } from '../access/door.ts';
import { createCalendarEvents } from '../calendar/events.ts';
import type { CalendarProvider } from '../calendar/provider.ts';
import type { TokenKey } from '../calendar/tokens.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { AfterWrite } from '../engine/write.ts';
import type { BookingCalendar, BusyAnswer } from './calendar.ts';
import { FREE_EMAIL_DOMAINS } from './visitor.ts';

/** What the connected calendar needs, passed in by the api when calendar sync is on. */
export interface ConnectedCalendarDeps {
  readonly db: Database;
  readonly providers: Readonly<Partial<Record<'google' | 'microsoft', CalendarProvider>>>;
  readonly tokenKey: TokenKey;
  /** The write hooks the booking's meeting row is stored through (the outbox). */
  readonly hooks?: readonly AfterWrite[];
  /** Whether an email domain names no company (gmail.com); the booking's own list by default. */
  readonly isFreeDomain?: (domain: string) => boolean;
  readonly now?: () => Date;
}

/** The busy times and the event writer over a workspace's connected calendars. */
export function connectedCalendar(deps: ConnectedCalendarDeps): BookingCalendar {
  const events = createCalendarEvents({
    db: deps.db,
    providers: deps.providers,
    tokenKey: deps.tokenKey,
    hooks: deps.hooks ?? [],
    isFreeDomain: deps.isFreeDomain ?? ((domain) => FREE_EMAIL_DOMAINS.has(domain)),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  return {
    async busy({ workspaceId, memberId, from, to }): Promise<BusyAnswer> {
      // Booking keeps its own minute per page and day, and its recheck must read past any cache: always fresh here.
      const [answer] = await events.freeBusy(
        systemScope(deps.db, workspaceId),
        { memberIds: [memberId], from, to },
        { fresh: true },
      );
      if (answer === undefined || answer.status === 'none') return { status: 'none' };
      if (answer.status !== 'read') return { status: answer.status };
      return {
        status: 'read',
        busy: answer.busy,
        ...(answer.skipped === undefined ? {} : { skipped: answer.skipped }),
      };
    },
    async events(event) {
      try {
        const made = await events.createEvent(systemScope(deps.db, event.workspaceId), {
          memberId: event.hostMemberId,
          title: event.title,
          start: event.start,
          end: event.end,
          timeZone: 'UTC',
          attendees: event.attendees,
          video: event.video,
          // The booking's id: a retry never makes a second event or video link.
          requestId: event.bookingId,
          bookingId: event.bookingId,
          ...(event.description === '' ? {} : { description: event.description }),
          ...(event.location === undefined ? {} : { location: event.location }),
        });
        return {
          ...(made.meetingId === undefined ? {} : { meetingId: made.meetingId }),
          ...(made.videoUrl === undefined ? {} : { videoUrl: made.videoUrl }),
        };
      } catch (error) {
        // A host with no live calendar: the booking stands without an event (AC-631).
        if (isRefusal(error) && error.refusal.code === 'CALENDAR_NOT_CONNECTED') return {};
        throw error;
      }
    },
    // A booking's move and cancel (milestone 2): spec 0024's own, by the meeting its event wrote; the provider tells
    // the attendees.
    existing: {
      async move(ref, change) {
        await events.moveEvent(systemScope(deps.db, ref.workspaceId), {
          meetingId: ref.meetingId,
          start: change.start,
          end: change.end,
          timeZone: 'UTC',
        });
      },
      async cancel(ref) {
        await events.cancelEvent(systemScope(deps.db, ref.workspaceId), { meetingId: ref.meetingId });
      },
    },
  };
}
