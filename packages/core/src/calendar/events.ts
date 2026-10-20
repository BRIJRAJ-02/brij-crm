// Free and busy, and writing events (spec 0024, milestone 3, AC-615 to
// AC-618): the core services booking (spec 0025) and later round robin (#58)
// call as the system, never the browser. Every call reads the member's
// connections as the system in the workspace, opens their sealed tokens
// (refreshed as the sync does), and calls the provider outside every
// transaction.
//
// - `freeBusy` answers each member's busy intervals over every live
//   connection they have, at most 62 days at once, each member's answer kept
//   60 seconds per range (a failure is never kept, so it is asked again).
//   A member with no connection answers `none` (round robin treats them as
//   unavailable; booking offers their hours, AC-631), a refused grant
//   `blocked`, a passing outage `unavailable`: failure is a value, never an
//   empty list.
// - `createEvent` writes to the member's default connection (or, while that
//   one is stopped, their oldest live one), with a Meet link when asked, and
//   writes the meeting row at once (`created_by_crm`, its source, attendees
//   and records) so timelines show it before the next sync, which finds the
//   same event by its UID and updates it in place. No live connection:
//   `CALENDAR_NOT_CONNECTED`.
// - `moveEvent` and `cancelEvent` change or cancel an event the CRM made,
//   through the provider (which tells the attendees), by the event id its
//   source kept.
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { systemScope } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { applyEvents, dropSources } from './apply.ts';
import {
  isProviderError,
  type BusyInterval,
  type CalendarProvider,
  type CalendarTokens,
  type ProviderEvent,
} from './provider.ts';
import { liveTokens } from './sync.ts';
import type { TokenBinding, TokenKey } from './tokens.ts';

/** The widest range one `freeBusy` reads (AC-615). */
export const FREE_BUSY_MAX_DAYS = 62;

/** How long one member's answer for one range is kept (AC-615). */
export const FREE_BUSY_CACHE_MS = 60_000;

/** The most members one `freeBusy` reads. */
export const FREE_BUSY_MAX_MEMBERS = 50;

/** What `createEvent` refuses for a member with no live connection (AC-618). */
export const NOT_CONNECTED = 'That member has no connected calendar.';

/** What a meeting the CRM didn't make (or that is gone) answers to a move or a cancel. */
export const UNKNOWN_EVENT = 'That calendar event does not exist.';

const DAY_MS = 86_400_000;

/** A connection a `freeBusy` read past because it failed: the others still answered. */
export interface SkippedCalendar {
  readonly connectionId: string;
  /** `blocked`: its grant is refused until the member reconnects; `unavailable`: a passing failure. */
  readonly reason: 'blocked' | 'unavailable';
}

/**
 * One member's busy times, or why there are none. A `read` answer may have
 * read past some of the member's calendars (`skipped`), so a screen can warn.
 */
export type MemberBusy =
  | {
      readonly memberId: string;
      readonly status: 'read';
      readonly busy: readonly BusyInterval[];
      readonly skipped?: readonly SkippedCalendar[];
    }
  /** No connected calendar: callers treat the member as unavailable (AC-618), booking as hours only (AC-631). */
  | { readonly memberId: string; readonly status: 'none' }
  /** A grant refused until the member reconnects. */
  | { readonly memberId: string; readonly status: 'blocked' }
  /** A passing failure (5xx, network, rate limit). */
  | { readonly memberId: string; readonly status: 'unavailable' };

/** A `freeBusy` question: members and a range, ISO 8601 in UTC, at most 62 days. */
export interface FreeBusyInput {
  readonly memberIds: readonly string[];
  readonly from: string;
  readonly to: string;
}

/** An event the CRM puts on a member's calendar (AC-616). */
export interface CreateEventInput {
  readonly memberId: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly attendees: readonly { readonly email: string; readonly name?: string }[];
  readonly timeZone: string;
  /** Ask the provider for a video link (Google Meet). */
  readonly video: boolean;
  /** Sent to the provider only; never stored (AC-613). */
  readonly description?: string;
  readonly location?: string;
  /** The idempotency key (a uuid): a retry never makes a second event or video link. */
  readonly requestId: string;
  /** The booking the event is for (spec 0025), kept on the meeting. */
  readonly bookingId?: string;
}

/** What `createEvent` made: the meeting row, the provider's event id, and the video link. */
export interface CreatedEvent {
  readonly meetingId?: string;
  readonly providerEventId: string;
  readonly videoUrl?: string;
}

/** A move of an event the CRM made (AC-617). */
export interface MoveEventInput {
  readonly meetingId: string;
  readonly start: string;
  readonly end: string;
  readonly timeZone: string;
}

/** What the events services need, passed in by the api or the worker. */
export interface CalendarEventsDeps {
  readonly db: Database;
  readonly providers: Readonly<Partial<Record<'google' | 'microsoft', CalendarProvider>>>;
  readonly tokenKey: TokenKey;
  /** The write hooks a meeting row is stored through (the outbox's `meetings` event). */
  readonly hooks: readonly AfterWrite[];
  readonly isFreeDomain: (domain: string) => boolean;
  readonly now?: () => Date;
  /** Kept answers at most (the oldest dropped first). */
  readonly cacheMax?: number;
}

/** A live connection as the events services read it. */
interface ConnectionRow extends Record<string, unknown> {
  readonly id: string;
  readonly member_id: string;
  readonly provider: 'google' | 'microsoft';
  readonly account_email: string;
  readonly tokens: Buffer;
  readonly is_default: boolean;
}

/** The events services. */
export interface CalendarEvents {
  readonly freeBusy: (
    scope: EngineScope,
    input: FreeBusyInput,
    options?: { readonly fresh?: boolean },
  ) => Promise<readonly MemberBusy[]>;
  readonly createEvent: (scope: EngineScope, input: CreateEventInput) => Promise<CreatedEvent>;
  readonly moveEvent: (scope: EngineScope, input: MoveEventInput) => Promise<{ readonly meetingId: string }>;
  readonly cancelEvent: (scope: EngineScope, input: { readonly meetingId: string }) => Promise<void>;
}

/** Refuses a range that is not two ISO moments in order, at most 62 days apart. */
function checkRange(from: string, to: string): void {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw inputInvalid('to', 'Give a range that ends after it starts.');
  }
  if (end - start > FREE_BUSY_MAX_DAYS * DAY_MS) {
    throw inputInvalid('to', `Ask for at most ${String(FREE_BUSY_MAX_DAYS)} days at once.`);
  }
}

/** The free and busy times and the event writes over a deployment's providers. */
export function createCalendarEvents(deps: CalendarEventsDeps): CalendarEvents {
  const now = () => deps.now?.() ?? new Date();
  const cacheMax = deps.cacheMax ?? 2_000;
  const kept = new Map<string, { readonly at: number; readonly answer: MemberBusy }>();

  /** The members' live connections, each member's default first, then oldest first. */
  const connectionsOf = async (scope: EngineScope, memberIds: readonly string[]) => {
    const found = await inWorkspace(scope, (tx) =>
      tx.execute<ConnectionRow>(sql`
        select id::text as id, member_id::text as member_id, provider, account_email, tokens, is_default
        from calendar_connections
        where member_id = any(array(select jsonb_array_elements_text(${JSON.stringify(memberIds)}::jsonb))::uuid[])
          and status in ('connected', 'syncing')
        order by is_default desc, created_at, id
      `),
    );
    return found.rows;
  };

  const tokensFor = async (scope: EngineScope, row: ConnectionRow) => {
    const provider = deps.providers[row.provider];
    if (provider === undefined) return undefined;
    const binding: TokenBinding = {
      workspaceId: scope.workspaceId,
      memberId: row.member_id,
      provider: row.provider,
      accountEmail: row.account_email,
    };
    const tokens: CalendarTokens = await liveTokens(deps, scope, provider, row, binding, now());
    return { provider, tokens };
  };

  /**
   * One member's busy times over every live connection, unioned, each read
   * at once. A calendar that fails is read past and named in `skipped`, so
   * one bad account never closes the member's whole day. It fails closed
   * (`blocked`) only when the destination calendar (the default, where
   * events go) has its grant refused, or every calendar fails and one is
   * refused; when every calendar fails and none is refused, `unavailable`.
   */
  const busyOf = async (
    scope: EngineScope,
    memberId: string,
    rows: readonly ConnectionRow[],
    from: string,
    to: string,
  ): Promise<MemberBusy> => {
    const mine = rows.filter((row) => row.member_id === memberId);
    if (mine.length === 0) return { memberId, status: 'none' };
    const answers = await Promise.all(
      mine.map(async (row): Promise<{ readonly busy: readonly BusyInterval[] } | SkippedCalendar> => {
        try {
          const live = await tokensFor(scope, row);
          if (live === undefined) return { busy: [] };
          return { busy: await live.provider.freeBusy(live.tokens, from, to) };
        } catch (error) {
          if (!isProviderError(error)) throw error;
          const refused = error.code === 'CALENDAR_AUTH_REVOKED' || error.code === 'CALENDAR_SCOPE_DECLINED';
          return { connectionId: row.id, reason: refused ? 'blocked' : 'unavailable' };
        }
      }),
    );
    const skipped = answers.filter((answer): answer is SkippedCalendar => 'reason' in answer);
    const [destination] = answers;
    if (destination !== undefined && 'reason' in destination && destination.reason === 'blocked') {
      return { memberId, status: 'blocked' };
    }
    if (skipped.length === answers.length) {
      return skipped.some((each) => each.reason === 'blocked')
        ? { memberId, status: 'blocked' }
        : { memberId, status: 'unavailable' };
    }
    const busy = answers
      .flatMap((answer) => ('busy' in answer ? answer.busy : []))
      .toSorted((a, b) => a.start.localeCompare(b.start));
    return { memberId, status: 'read', busy, ...(skipped.length === 0 ? {} : { skipped }) };
  };

  const keep = (key: string, answer: MemberBusy) => {
    if (answer.status !== 'read' && answer.status !== 'none') return;
    kept.delete(key);
    kept.set(key, { at: now().getTime(), answer });
    while (kept.size > cacheMax) {
      const oldest = kept.keys().next();
      if (oldest.done === true) break;
      kept.delete(oldest.value);
    }
  };

  /** A CRM made meeting's source: its connection and the provider's event id. */
  const sourceOf = async (scope: EngineScope, meetingIdAsGiven: string) => {
    const meetingId = checkId(meetingIdAsGiven, UNKNOWN_EVENT);
    const found = await inWorkspace(scope, (tx) =>
      tx.execute<ConnectionRow & { provider_event_id: string; status: string }>(sql`
        select c.id::text as id, c.member_id::text as member_id, c.provider, c.account_email, c.tokens,
          c.is_default, c.status, s.provider_event_id
        from meetings m
        join meeting_sources s on s.workspace_id = m.workspace_id and s.meeting_id = m.id
        join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
        where m.id = ${meetingId}::uuid and m.created_by_crm
        order by c.created_at, c.id
        limit 1
      `),
    );
    const [row] = found.rows;
    if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_EVENT);
    if (row.status !== 'connected' && row.status !== 'syncing') throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
    return { meetingId, row };
  };

  /** Writes the provider's answer as the meeting row at once, marked made by the CRM. */
  const writeMeeting = async (
    scope: EngineScope,
    row: ConnectionRow,
    event: ProviderEvent,
    bookingId: string | undefined,
  ): Promise<string | undefined> => {
    const { result } = await runWrite(
      scope,
      async (context) => {
        await applyEvents(context, { id: row.id, memberId: row.member_id }, [event], deps.isFreeDomain);
        const marked = await context.tx.execute<{ id: string }>(sql`
          update meetings m set created_by_crm = true, booking_id = coalesce(${bookingId ?? null}::uuid, m.booking_id)
          from meeting_sources s
          where s.workspace_id = m.workspace_id and s.meeting_id = m.id
            and s.connection_id = ${row.id}::uuid and s.provider_event_id = ${event.id}
          returning m.id::text as id
        `);
        return marked.rows[0]?.id;
      },
      deps.hooks,
    );
    return result;
  };

  return {
    async freeBusy(scope, input, options = {}) {
      checkRange(input.from, input.to);
      const memberIds = [...new Set(input.memberIds.map((id) => checkId(id, 'That member does not exist.')))];
      if (memberIds.length > FREE_BUSY_MAX_MEMBERS) {
        throw inputInvalid('memberIds', `Ask for at most ${String(FREE_BUSY_MAX_MEMBERS)} members at once.`);
      }
      const from = new Date(input.from).toISOString();
      const to = new Date(input.to).toISOString();
      const keyOf = (memberId: string) => `${scope.workspaceId}:${memberId}:${from}:${to}`;
      const answers = new Map<string, MemberBusy>();
      for (const memberId of memberIds) {
        const hit = options.fresh === true ? undefined : kept.get(keyOf(memberId));
        if (hit !== undefined && now().getTime() - hit.at < FREE_BUSY_CACHE_MS) answers.set(memberId, hit.answer);
      }
      const asking = memberIds.filter((memberId) => !answers.has(memberId));
      if (asking.length > 0) {
        const rows = await connectionsOf(scope, asking);
        // Members at once: five hosts answer in about the time of one (AC-615).
        const read = await Promise.all(asking.map((memberId) => busyOf(scope, memberId, rows, from, to)));
        for (const answer of read) {
          answers.set(answer.memberId, answer);
          keep(keyOf(answer.memberId), answer);
        }
      }
      return memberIds.flatMap((memberId) => {
        const answer = answers.get(memberId);
        return answer === undefined ? [] : [answer];
      });
    },

    async createEvent(scope, input) {
      const memberId = checkId(input.memberId, NOT_CONNECTED);
      const [row] = await connectionsOf(scope, [memberId]);
      if (row === undefined) throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
      const live = await tokensFor(scope, row);
      if (live === undefined) throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
      const made = await live.provider.createEvent(live.tokens, {
        title: input.title,
        start: input.start,
        end: input.end,
        timeZone: input.timeZone,
        attendees: input.attendees,
        video: input.video,
        requestId: input.requestId,
        ...(input.description === undefined || input.description === '' ? {} : { description: input.description }),
        ...(input.location === undefined ? {} : { location: input.location }),
      });
      const meetingId = await writeMeeting(scope, row, made, input.bookingId);
      return {
        ...(meetingId === undefined ? {} : { meetingId }),
        providerEventId: made.id,
        ...(made.videoUrl === undefined ? {} : { videoUrl: made.videoUrl }),
      };
    },

    async moveEvent(scope, input) {
      checkRange(input.start, input.end);
      const { meetingId, row } = await sourceOf(scope, input.meetingId);
      const live = await tokensFor(scope, row);
      if (live === undefined) throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
      const moved = await live.provider.updateEvent(live.tokens, row.provider_event_id, {
        start: input.start,
        end: input.end,
        timeZone: input.timeZone,
      });
      return { meetingId: (await writeMeeting(scope, row, moved, undefined)) ?? meetingId };
    },

    async cancelEvent(scope, input) {
      const { row } = await sourceOf(scope, input.meetingId);
      const live = await tokensFor(scope, row);
      if (live === undefined) throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
      await live.provider.cancelEvent(live.tokens, row.provider_event_id);
      // The calendar no longer holds it: this copy goes now, and the meeting with its last copy.
      await runWrite(
        scope,
        async (context) => {
          context.record({ meetings: await dropSources(context.tx, row.id, { eventIds: [row.provider_event_id] }) });
        },
        deps.hooks,
      );
    },
  };
}

/** The events services' scope in a workspace: the system's, as booking and round robin call them. */
export function calendarEventsScope(db: Database, workspaceId: string): EngineScope {
  return systemScope(db, workspaceId);
}
