// Booking's calendar calls over spec 0024's connections (spec 0025, AC-630,
// AC-633): the busy reader unions `freeBusy` over every calendar the host has
// connected, and the event writer puts the booking on the first one with
// `createEvent`. Both read the connection as the system (the visitor has no
// scope of their own in the workspace), open its sealed tokens, refreshing
// them as calendar sync does, and turn a provider's failure into the answer
// booking expects: a refused grant `blocked` (nothing offered), a passing
// outage `unavailable` (offered as if no calendar).
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { systemScope } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import { isProviderError, type BusyInterval, type CalendarProvider } from '../calendar/provider.ts';
import { liveTokens } from '../calendar/sync.ts';
import type { TokenBinding, TokenKey } from '../calendar/tokens.ts';
import type { BookingCalendar, BusyAnswer } from './calendar.ts';

/** What the connected calendar needs, passed in by the api when calendar sync is on. */
export interface ConnectedCalendarDeps {
  readonly db: Database;
  readonly providers: Readonly<Partial<Record<'google' | 'microsoft', CalendarProvider>>>;
  readonly tokenKey: TokenKey;
  readonly now?: () => Date;
}

/** A connection as booking reads it. */
interface ConnectionRow extends Record<string, unknown> {
  readonly id: string;
  readonly provider: 'google' | 'microsoft';
  readonly account_email: string;
  readonly tokens: Buffer;
}

/** The member's live connections, oldest first (the first is where events go). */
async function connectionsOf(deps: ConnectedCalendarDeps, workspaceId: string, memberId: string) {
  const scope = systemScope(deps.db, workspaceId);
  const found = await inWorkspace(scope, (tx) =>
    tx.execute<ConnectionRow>(sql`
      select id::text as id, provider, account_email, tokens
      from calendar_connections
      where member_id = ${memberId}::uuid and status in ('connected', 'syncing')
      order by created_at, id
    `),
  );
  return { scope, rows: found.rows };
}

/** The busy times and the event writer over a workspace's connected calendars. */
export function connectedCalendar(deps: ConnectedCalendarDeps): BookingCalendar {
  const now = () => deps.now?.() ?? new Date();
  const tokensFor = async (
    scope: ReturnType<typeof systemScope>,
    workspaceId: string,
    memberId: string,
    row: ConnectionRow,
  ) => {
    const provider = deps.providers[row.provider];
    if (provider === undefined) return undefined;
    const binding: TokenBinding = { workspaceId, memberId, provider: row.provider, accountEmail: row.account_email };
    return { provider, tokens: await liveTokens(deps, scope, provider, row, binding, now()) };
  };
  return {
    async busy({ workspaceId, memberId, from, to }): Promise<BusyAnswer> {
      const { scope, rows } = await connectionsOf(deps, workspaceId, memberId);
      if (rows.length === 0) return { status: 'none' };
      const busy: BusyInterval[] = [];
      for (const row of rows) {
        try {
          const live = await tokensFor(scope, workspaceId, memberId, row);
          if (live === undefined) continue;
          busy.push(...(await live.provider.freeBusy(live.tokens, from, to)));
        } catch (error) {
          if (!isProviderError(error)) throw error;
          // A refused grant fails closed until the host reconnects; anything passing fails open.
          return error.code === 'CALENDAR_AUTH_REVOKED' || error.code === 'CALENDAR_SCOPE_DECLINED'
            ? { status: 'blocked' }
            : { status: 'unavailable' };
        }
      }
      return { status: 'read', busy };
    },
    async events(event) {
      const { scope, rows } = await connectionsOf(deps, event.workspaceId, event.hostMemberId);
      const [row] = rows;
      if (row === undefined) return {};
      const live = await tokensFor(scope, event.workspaceId, event.hostMemberId, row);
      if (live === undefined) return {};
      const made = await live.provider.createEvent(live.tokens, {
        title: event.title,
        start: event.start,
        end: event.end,
        timeZone: 'UTC',
        attendees: event.attendees,
        video: event.video,
        // The booking's id: a retry never makes a second video link.
        requestId: event.bookingId,
        ...(event.description === '' ? {} : { description: event.description }),
        ...(event.location === undefined ? {} : { location: event.location }),
      });
      // The meeting row comes with calendar sync's next run, which links it by the event.
      return made.videoUrl === undefined ? {} : { videoUrl: made.videoUrl };
    },
  };
}
