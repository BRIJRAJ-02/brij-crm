// Free and busy, and writing events (spec 0024, milestone 3, AC-615 to
// AC-618; per calendar from milestone 5, AC-994 to AC-998): the core services
// booking (spec 0025) and round robin (spec 0029) call as the system, never
// the browser. Every call reads the member's connections and calendars as the
// system in the workspace, opens their sealed tokens (refreshed as the sync
// does), and calls the provider outside every transaction.
//
// - `freeBusy` answers each member's busy intervals over every calendar with
//   Check for conflicts on, in all of their accounts, with one provider call
//   per account (AC-994), at most 62 days at once, each member's answer kept
//   60 seconds per range (a failure is never kept, so it is asked again;
//   `forget` clears a member's when a switch or the destination changes). Each
//   calendar's answer stands alone (AC-995): one that errors, or an account
//   that doesn't answer within 3 seconds, is skipped (`skipped`, and its
//   warning written on the calendar for its member), and the busy times come
//   from the rest. A member is `blocked` (offered nothing, fail closed) only
//   when every conflict calendar failed, or the account holding their
//   destination calendar is expired or revoked. A member with no connection
//   answers `none` (round robin treats them as unavailable; booking offers
//   their hours, AC-631). Failure is a value, never an empty list.
// - `createEvent` writes to the member's destination calendar (AC-996), or the
//   booking page's own when it names a calendar of that member they can still
//   write (AC-997), with a Meet or Teams link when asked (an Outlook account
//   that can't make Teams links makes the event without one and says so,
//   AC-1011), and writes the meeting row at once (`created_by_crm`, its source
//   marked as the copy the CRM made, attendees and records) so timelines show
//   it before the next sync. No destination: `CALENDAR_NOT_CONNECTED`.
// - `moveEvent` and `cancelEvent` act on the calendar the event was created in
//   (its marked source, AC-998), even if the destination changed since, through
//   the provider (which tells the attendees).
//
// Nothing here answers a calendar's name or an account's address: what a
// caller learns of a skipped calendar is its id and why.
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { systemScope } from '../access/door.ts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId, uuidList } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { applyEvents, dropSources } from './apply.ts';
import {
  isProviderError,
  providerError,
  type BusyInterval,
  type CalendarErrorCode,
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

/** How long one account has to answer a free and busy read before its calendars are skipped (AC-995). */
export const FREE_BUSY_TIMEOUT_MS = 3_000;

/** What `createEvent` refuses for a member with no destination they can write (AC-618). */
export const NOT_CONNECTED = 'That member has no connected calendar.';

/** What a meeting the CRM didn't make (or that is gone) answers to a move or a cancel. */
export const UNKNOWN_EVENT = 'That calendar event does not exist.';

/** The plain words a free and busy failure leaves on its calendar (the member's screens add its name and time). */
export const BUSY_SKIPPED_MESSAGE = 'Timefix couldn’t check this calendar, so it was left out.';

const DAY_MS = 86_400_000;

/** A calendar a `freeBusy` read past because it failed: the others still answered. */
export interface SkippedCalendar {
  /** The calendar's id (`calendar_calendars.id`). */
  readonly calendarId: string;
  readonly connectionId: string;
  readonly code: CalendarErrorCode;
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
  /**
   * Closed (AC-995): every conflict calendar failed, or the account holding the destination is expired or revoked.
   * Nothing is offered for them.
   */
  | { readonly memberId: string; readonly status: 'blocked'; readonly skipped?: readonly SkippedCalendar[] }
  /** Kept for callers written before milestone 5; `freeBusy` no longer answers it (every failure now closes). */
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
  /** Ask the provider for a video link (Google Meet, Microsoft Teams). */
  readonly video: boolean;
  /** Sent to the provider only; never stored (AC-613). */
  readonly description?: string;
  readonly location?: string;
  /** The idempotency key (a uuid): a retry never makes a second event or video link. */
  readonly requestId: string;
  /** The booking the event is for (spec 0025), kept on the meeting. */
  readonly bookingId?: string;
  /** The booking page, whose own "Add events to" wins when it names a calendar of this member (AC-997). */
  readonly pageId?: string;
  /**
   * The member's pick for this one event (`calendar_calendars.id`, New meeting's Calendar): wins over the page's
   * and their destination while it is still theirs to write, on an account that works; else ignored.
   */
  readonly calendarId?: string;
}

/** What `createEvent` made: the meeting row, the provider's event id, the video link, and where it went. */
export interface CreatedEvent {
  readonly meetingId?: string;
  readonly providerEventId: string;
  readonly videoUrl?: string;
  /** The calendar it went to (`calendar_calendars.id`). */
  readonly calendarId: string;
  /** A video link was asked for and the account can't make one (AC-1011): the host is told. */
  readonly videoUnavailable?: boolean;
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
  /** How long one account has to answer free and busy (tests make it short). */
  readonly timeoutMs?: number;
}

/** A connection as the events services read it. */
interface ConnectionRow extends Record<string, unknown> {
  readonly id: string;
  readonly member_id: string;
  readonly provider: 'google' | 'microsoft';
  readonly account_email: string;
  readonly tokens: Buffer;
  readonly status: string;
}

/** A calendar of a connection as free and busy reads it. */
interface BusyCalendarRow extends ConnectionRow {
  /** Null when the connection has no calendar that checks conflicts or takes bookings. */
  readonly calendar_id: string | null;
  readonly provider_calendar_id: string | null;
  readonly check_conflicts: boolean | null;
  readonly is_destination: boolean | null;
  readonly busy_error: string | null;
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
  /** Forgets a member's kept answers: a conflict switch or the destination changed (AC-994). */
  readonly forget: (workspaceId: string, memberId: string) => void;
}

/** What a scope other than the system's answers: these services are booking's and round robin's, never a member's. */
export const SYSTEM_ONLY = 'Calendar events are written by the system.';

/** Refuses any scope but the system's (`calendarEventsScope`). */
function checkSystem(scope: EngineScope): void {
  checkScope(scope);
  if (scope.access.principal.kind !== 'system') throw refuse('FORBIDDEN', SYSTEM_ONLY);
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

/** The statuses whose grant is gone until the member reconnects (AC-995's closed rule). */
const GRANT_GONE: ReadonlySet<string> = new Set(['expired', 'revoked']);

/** The statuses a connection is still read in. */
const LIVE: ReadonlySet<string> = new Set(['syncing', 'connected', 'failed']);

/** Whether a failure code means the grant is refused until the member reconnects. */
const isRefused = (code: CalendarErrorCode) =>
  code === 'CALENDAR_AUTH_REVOKED' || code === 'CALENDAR_SCOPE_DECLINED' || code === 'CALENDAR_AUTH';

/** `work`, or `CALENDAR_UNAVAILABLE` when it takes longer than `ms`. */
async function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(providerError('CALENDAR_UNAVAILABLE', 'The calendar didn’t answer in time.'));
    }, ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The free and busy times and the event writes over a deployment's providers. */
export function createCalendarEvents(deps: CalendarEventsDeps): CalendarEvents {
  const now = () => deps.now?.() ?? new Date();
  const cacheMax = deps.cacheMax ?? 2_000;
  const timeoutMs = deps.timeoutMs ?? FREE_BUSY_TIMEOUT_MS;
  const kept = new Map<string, { readonly at: number; readonly answer: MemberBusy }>();

  /** Every connection of the members, with each calendar that checks conflicts or takes bookings. */
  const calendarsOf = async (scope: EngineScope, memberIds: readonly string[]) => {
    const found = await inWorkspace(scope, (tx) =>
      tx.execute<BusyCalendarRow>(sql`
        select c.id::text as id, c.member_id::text as member_id, c.provider, c.account_email, c.tokens,
          c.status::text as status, k.id::text as calendar_id, k.provider_calendar_id, k.check_conflicts,
          k.is_destination, k.last_error ->> 'code' as busy_error
        from calendar_connections c
        left join calendar_calendars k on k.workspace_id = c.workspace_id and k.connection_id = c.id
          and (k.check_conflicts or k.is_destination)
        where c.member_id = any(${uuidList(memberIds)})
        order by c.created_at, c.id, k.is_primary desc, k.name
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

  /** One account's conflict calendars, read in one request: each calendar's busy spans or failure code. */
  const readAccount = async (
    scope: EngineScope,
    connection: ConnectionRow,
    calendars: readonly BusyCalendarRow[],
    from: string,
    to: string,
  ): Promise<
    ReadonlyMap<string, { readonly busy: readonly BusyInterval[] } | { readonly error: CalendarErrorCode }>
  > => {
    const ids = calendars.flatMap((each) => (each.provider_calendar_id === null ? [] : [each.provider_calendar_id]));
    const failAll = (code: CalendarErrorCode) => new Map(ids.map((id) => [id, { error: code }] as const));
    if (!LIVE.has(connection.status)) return failAll('CALENDAR_AUTH_REVOKED');
    try {
      return await within(
        timeoutMs,
        (async () => {
          const live = await tokensFor(scope, connection);
          if (live === undefined) return failAll('CALENDAR_UNAVAILABLE');
          return live.provider.freeBusy(live.tokens, ids, from, to);
        })(),
      );
    } catch (error) {
      if (!isProviderError(error)) throw error;
      return failAll(error.code);
    }
  };

  /** Leaves each skipped calendar's warning for its member, and clears the warning of each that answered again. */
  const noteSkips = async (
    scope: EngineScope,
    skipped: readonly SkippedCalendar[],
    answered: readonly string[],
  ): Promise<void> => {
    if (skipped.length === 0 && answered.length === 0) return;
    await inWorkspace(scope, async (tx) => {
      if (skipped.length > 0) {
        await tx.execute(sql`
          update calendar_calendars k set
            last_error = jsonb_build_object('code', x.code, 'message', ${BUSY_SKIPPED_MESSAGE}::text,
              'source', 'busy', 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
            failing_since = coalesce(k.failing_since, now())
          from jsonb_to_recordset(${JSON.stringify(skipped.map((each) => ({ id: each.calendarId, code: each.code })))}::jsonb)
            as x(id uuid, code text)
          where k.id = x.id
        `);
      }
      if (answered.length > 0) {
        await tx.execute(sql`
          update calendar_calendars set last_error = null, failing_since = null
          where id = any(${uuidList(answered)}) and last_error ->> 'source' = 'busy'
        `);
      }
    });
  };

  /** One member's busy times over every conflict calendar, by AC-994 and AC-995. */
  const busyOf = async (
    scope: EngineScope,
    memberId: string,
    rows: readonly BusyCalendarRow[],
    from: string,
    to: string,
  ): Promise<MemberBusy> => {
    const mine = rows.filter((row) => row.member_id === memberId);
    if (mine.length === 0) return { memberId, status: 'none' };
    const destination = mine.find((row) => row.is_destination === true);
    const conflicts = mine.filter((row) => row.check_conflicts === true && row.calendar_id !== null);
    const byConnection = new Map<string, BusyCalendarRow[]>();
    for (const row of conflicts) byConnection.set(row.id, [...(byConnection.get(row.id) ?? []), row]);
    const answers = await Promise.all(
      [...byConnection.values()].map(async (calendars) => {
        const [connection] = calendars;
        if (connection === undefined) return [];
        const read = await readAccount(scope, connection, calendars, from, to);
        return calendars.map((calendar) => ({
          calendar,
          answer: read.get(calendar.provider_calendar_id ?? '') ?? { error: 'CALENDAR_UNAVAILABLE' as const },
        }));
      }),
    );
    const flat = answers.flat();
    const skipped: SkippedCalendar[] = flat.flatMap(({ calendar, answer }) =>
      'error' in answer
        ? [
            {
              calendarId: calendar.calendar_id ?? '',
              connectionId: calendar.id,
              code: answer.error,
              reason: isRefused(answer.error) ? ('blocked' as const) : ('unavailable' as const),
            },
          ]
        : [],
    );
    const answered = flat.flatMap(({ calendar, answer }) =>
      'busy' in answer && calendar.busy_error !== null && calendar.calendar_id !== null ? [calendar.calendar_id] : [],
    );
    await noteSkips(scope, skipped, answered);
    // Closed: the destination's account can't take the booking (its grant expired or revoked, or refused just now),
    // or every conflict calendar failed (AC-995).
    const destinationRefused = skipped.some(
      (each) => each.connectionId === destination?.id && each.code === 'CALENDAR_AUTH_REVOKED',
    );
    if (destination !== undefined && (GRANT_GONE.has(destination.status) || destinationRefused)) {
      return { memberId, status: 'blocked', ...(skipped.length === 0 ? {} : { skipped }) };
    }
    if (flat.length > 0 && skipped.length === flat.length) return { memberId, status: 'blocked', skipped };
    const busy = flat
      .flatMap(({ answer }) => ('busy' in answer ? answer.busy : []))
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

  /** A destination as `createEvent` writes to it: its calendar, connection and the provider's calendar id. */
  interface Destination extends ConnectionRow {
    readonly calendar_id: string;
    readonly provider_calendar_id: string;
  }

  /**
   * Where a member's new event goes (AC-996, AC-997): the calendar they picked for it (New meeting), then the page's
   * own calendar when it names one of this member's, each only while they can still write it on an account that
   * works; else the member's destination, else none.
   */
  const destinationFor = async (
    scope: EngineScope,
    memberId: string,
    pageId: string | undefined,
    chosenId: string | undefined,
  ): Promise<Destination | undefined> => {
    const found = await inWorkspace(scope, (tx) =>
      tx.execute<Destination & { readonly from_page: boolean }>(sql`
        select c.id::text as id, c.member_id::text as member_id, c.provider, c.account_email, c.tokens,
          c.status::text as status, k.id::text as calendar_id, k.provider_calendar_id,
          (k.id = ${chosenId ?? null}::uuid) as chosen,
          (k.id = (select p.destination_calendar_id from booking_pages p where p.id = ${pageId ?? null}::uuid)) as from_page
        from calendar_calendars k
        join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
        where k.member_id = ${memberId}::uuid and k.access_role in ('owner', 'writer')
          and c.status in ('syncing', 'connected', 'failed')
          and (k.is_destination or k.id = ${chosenId ?? null}::uuid
            or k.id = (select p.destination_calendar_id from booking_pages p where p.id = ${pageId ?? null}::uuid))
        order by chosen desc nulls last, from_page desc nulls last
        limit 1
      `),
    );
    return found.rows[0];
  };

  /** A CRM made meeting's own copy (AC-998): its connection, calendar and the provider's event id. */
  const sourceOf = async (scope: EngineScope, meetingIdAsGiven: string) => {
    const meetingId = checkId(meetingIdAsGiven, UNKNOWN_EVENT);
    const found = await inWorkspace(scope, (tx) =>
      tx.execute<ConnectionRow & { provider_event_id: string; calendar_id: string }>(sql`
        select c.id::text as id, c.member_id::text as member_id, c.provider, c.account_email, c.tokens,
          c.status::text as status, s.provider_event_id, s.calendar_id
        from meetings m
        join meeting_sources s on s.workspace_id = m.workspace_id and s.meeting_id = m.id
        join calendar_connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
        where m.id = ${meetingId}::uuid and m.created_by_crm
        order by s.created_by_crm desc, c.created_at, c.id
        limit 1
      `),
    );
    const [row] = found.rows;
    if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_EVENT);
    if (!LIVE.has(row.status)) throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
    return { meetingId, row };
  };

  /** Writes the provider's answer as the meeting row at once, its copy marked as the one the CRM made. */
  const writeMeeting = async (
    scope: EngineScope,
    row: ConnectionRow,
    calendarId: string,
    event: ProviderEvent,
    bookingId: string | undefined,
  ): Promise<string | undefined> => {
    const { result } = await runWrite(
      scope,
      async (context) => {
        await applyEvents(
          context,
          { id: row.id, memberId: row.member_id, calendarId, syncs: true, madeByCrm: true },
          [event],
          deps.isFreeDomain,
        );
        const marked = await context.tx.execute<{ id: string }>(sql`
          update meetings m set created_by_crm = true, booking_id = coalesce(${bookingId ?? null}::uuid, m.booking_id)
          from meeting_sources s
          where s.workspace_id = m.workspace_id and s.meeting_id = m.id
            and s.connection_id = ${row.id}::uuid and s.calendar_id = ${calendarId}
            and s.provider_event_id = ${event.id}
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
      checkSystem(scope);
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
        const rows = await calendarsOf(scope, asking);
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

    forget(workspaceId, memberId) {
      const prefix = `${workspaceId}:${memberId}:`;
      for (const key of [...kept.keys()]) if (key.startsWith(prefix)) kept.delete(key);
    },

    async createEvent(scope, input) {
      checkSystem(scope);
      const memberId = checkId(input.memberId, NOT_CONNECTED);
      const pageId = input.pageId === undefined ? undefined : checkId(input.pageId, NOT_CONNECTED);
      const chosenId = input.calendarId === undefined ? undefined : checkId(input.calendarId, NOT_CONNECTED);
      const row = await destinationFor(scope, memberId, pageId, chosenId);
      if (row === undefined) throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
      const live = await tokensFor(scope, row);
      if (live === undefined) throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
      const made = await live.provider.createEvent(live.tokens, row.provider_calendar_id, {
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
      const meetingId = await writeMeeting(scope, row, row.provider_calendar_id, made, input.bookingId);
      return {
        ...(meetingId === undefined ? {} : { meetingId }),
        providerEventId: made.id,
        calendarId: row.calendar_id,
        ...(made.videoUrl === undefined ? {} : { videoUrl: made.videoUrl }),
        ...(made.videoUnavailable === true ? { videoUnavailable: true } : {}),
      };
    },

    async moveEvent(scope, input) {
      checkSystem(scope);
      checkRange(input.start, input.end);
      const { meetingId, row } = await sourceOf(scope, input.meetingId);
      const live = await tokensFor(scope, row);
      if (live === undefined) throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
      const moved = await live.provider.updateEvent(live.tokens, row.calendar_id, row.provider_event_id, {
        start: input.start,
        end: input.end,
        timeZone: input.timeZone,
      });
      return { meetingId: (await writeMeeting(scope, row, row.calendar_id, moved, undefined)) ?? meetingId };
    },

    async cancelEvent(scope, input) {
      checkSystem(scope);
      const { row } = await sourceOf(scope, input.meetingId);
      const live = await tokensFor(scope, row);
      if (live === undefined) throw refuse('CALENDAR_NOT_CONNECTED', NOT_CONNECTED);
      await live.provider.cancelEvent(live.tokens, row.calendar_id, row.provider_event_id);
      // The calendar no longer holds it: this copy goes now, and the meeting with its last copy.
      await runWrite(
        scope,
        async (context) => {
          // The caller (booking) cancels its own booking: the drop never does it for them.
          context.record({
            meetings: await dropSources(
              context.tx,
              row.id,
              row.calendar_id,
              { eventIds: [row.provider_event_id] },
              { cancelBookings: false },
            ),
          });
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
