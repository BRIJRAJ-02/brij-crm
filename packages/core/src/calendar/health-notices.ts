// Calendar health for teams (spec 0037, job J8): who hears that a calendar is
// broken, and how often.
//
// Two emails per broken episode at most (AC-1310). A connection's move to
// `expired` or `failed` opens an episode (`health_broken_at`, kept by the
// trigger of migration 0134 whatever code moves the status), and the move back
// to `connected` closes it. The worker's sweep (`crm_cron_calendar_health`)
// reads the connections owed an email across workspaces, ids only, holds every
// email during a mass outage (`isMassOutage`, AC-1311) and otherwise queues
// at most 200 `crm_calendar_health_email` jobs, each keyed by connection,
// episode and which email. Each job runs `runCalendarHealthEmail` here, as the
// system in its workspace: it reads the connection under its row lock, checks
// the episode is still the one it was queued for and still owed that email,
// queues one `calendar_disconnected` email (keyed the same way, so a retry
// never sends twice) and marks the episode, all in one transaction. Only the
// member hears the account's address and provider; nothing here reaches a
// colleague.
//
// "Ask to reconnect" (AC-1309): someone with See over a member (owners and
// admins see everyone, so `booking.admin` is covered) presses it while the
// member's status is Reconnect needed or Some calendars skipped. Once per
// member per 24 hours, whoever asks, read from the audit log's latest
// `calendar.reconnect_asked` row for that member (the `audit_events_target`
// index), under a lock per member so two presses can't both pass. The audit
// row and the `calendar_reconnect_asked` email commit together.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { PERMISSIONS } from '@crm/contracts';
import type { CalendarReconnectAskedEmail } from '@crm/contracts/emails';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { actingFor } from '../access/scheduling.ts';
import { lockKey } from '../booking/locks.ts';
import { queueCalendarDisconnected, queueEmail } from '../emails/queue.ts';
import { isUuid } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit } from '../members/audit.ts';
import { foldMembers, healthRows } from './health.ts';

/** The numbers of the health emails (spec 0037, "Numbers"): one sweep's cap, the hold, the reminder, the ask. */
export const CALENDAR_HEALTH = {
  /** The most health emails one sweep queues; the rest go next sweep. */
  emailsPerSweep: 200,
  /** A mass outage: at least this share of checked connections newly broken... */
  massFraction: 0.25,
  /** ...and at least this many. */
  massCount: 4,
  /** The reminder, this many days after the first email, while still broken. */
  reminderDays: 7,
  /** Ask to reconnect, once per member in this many hours. */
  askEveryHours: 24,
} as const;

/**
 * Whether one sweep's newly broken connections look like a provider's outage rather than members' own grants (pure,
 * AC-1311): at least a quarter of the checked connections, and at least 4. A held sweep sends nothing.
 */
export function isMassOutage(checked: number, newlyBroken: number): boolean {
  return newlyBroken >= CALENDAR_HEALTH.massCount && newlyBroken >= checked * CALENDAR_HEALTH.massFraction;
}

/** Where a member reconnects their calendars: Settings › Calendars of their workspace. */
const settingsPathOf = (slug: string) => `/w/${encodeURIComponent(slug)}/settings/scheduling/calendars`;

/** What one health email job did. */
export type CalendarHealthEmailOutcome =
  /** Queued now, or found queued by an earlier try. */
  | 'queued'
  | 'exists'
  /** The episode ended (reconnected) or another began: nothing to tell. */
  | 'healed'
  /** Not owed: the first email went already, or the reminder isn't due or went. */
  | 'not_due'
  /** The member left, or the connection is gone. */
  | 'gone'
  /** The params didn't fit the template: a fault to see. */
  | 'refused';

/** The connection as the health email reads it, under its row lock. */
interface EpisodeRow extends Record<string, unknown> {
  readonly member_id: string;
  readonly provider: 'google' | 'microsoft';
  readonly account_email: string;
  readonly status: string;
  readonly notified: boolean;
  readonly reminded: boolean;
  readonly reminder_due: boolean;
  readonly broken_micros: string;
  readonly member_active: boolean;
  readonly slug: string;
}

/**
 * The worker's `crm_calendar_health_email` (AC-1310), as the system in the connection's workspace: one episode's first
 * email or its reminder, when still owed, queued and marked in one transaction.
 */
export async function runCalendarHealthEmail(
  scope: EngineScope,
  input: { readonly connectionId: string; readonly episode: string; readonly reminder: boolean },
): Promise<CalendarHealthEmailOutcome> {
  checkScope(scope);
  if (scope.access.principal.kind !== 'system') {
    throw new Error('Only the system tells a member their calendar is broken (the worker’s task).');
  }
  if (!isUuid(input.connectionId) || Number.isNaN(Date.parse(input.episode))) return 'gone';
  return inWorkspace(scope, async (tx) => {
    const found = await tx.execute<EpisodeRow>(sql`
      select c.member_id::text as member_id, c.provider::text as provider, c.account_email, c.status::text as status,
        c.health_notified_at is not null as notified, c.health_reminded_at is not null as reminded,
        coalesce(c.health_notified_at <= now() - make_interval(days => ${CALENDAR_HEALTH.reminderDays}), false)
          as reminder_due,
        floor(extract(epoch from c.health_broken_at) * 1000000)::bigint::text as broken_micros,
        m.status = 'active' as member_active, w.slug
      from calendar_connections c
      join members m on m.workspace_id = c.workspace_id and m.id = c.member_id
      join workspaces w on w.id = c.workspace_id
      where c.id = ${input.connectionId}::uuid and c.health_broken_at = ${input.episode}::timestamptz
      for update of c
    `);
    const [row] = found.rows;
    if (row === undefined) return 'healed';
    if (row.status !== 'expired' && row.status !== 'failed') return 'healed';
    if (!row.member_active) return 'gone';
    if (input.reminder ? !row.notified || row.reminded || !row.reminder_due : row.notified) return 'not_due';
    const queued = await queueCalendarDisconnected(tx, {
      connectionId: input.connectionId,
      memberId: row.member_id,
      episodeMicros: row.broken_micros,
      reminder: input.reminder,
      params: {
        provider: row.provider,
        accountEmail: row.account_email,
        reason: row.status,
        settingsPath: settingsPathOf(row.slug),
        ...(input.reminder ? { reminder: true as const } : {}),
      },
    });
    if (queued.outcome === 'refused') return 'refused';
    await markEpisode(tx, input.connectionId, input.reminder);
    return queued.outcome;
  });
}

/** Marks an episode's first email or its reminder as gone; only the health columns change, never `updated_at`. */
async function markEpisode(tx: WorkspaceTx, connectionId: string, reminder: boolean): Promise<void> {
  await tx.execute(
    reminder
      ? sql`update calendar_connections set health_reminded_at = now() where id = ${connectionId}::uuid`
      : sql`update calendar_connections set health_notified_at = now() where id = ${connectionId}::uuid`,
  );
}

/** What Ask to reconnect answers: asked now, or the wait before anyone may ask again. */
export type ReconnectAskOutcome =
  | { readonly outcome: 'asked'; readonly askedAt: string }
  | { readonly outcome: 'wait'; readonly retryAfterSeconds: number; readonly name: string };

/**
 * Ask to reconnect (AC-1309): the caller, with See over `memberId` (or an owner or admin, who see everyone), asks a
 * colleague whose calendar is Reconnect needed or Some calendars skipped to reconnect it. Outside reach, or not an
 * active member: NOT_FOUND. The member's calendar working again: STALE. Once per member per 24 hours: `wait`, which
 * the procedure answers 429 `RATE_LIMITED` with the wait. Writes the audit row and queues the email together.
 */
export async function askToReconnect(
  scope: EngineScope,
  input: { readonly memberId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<ReconnectAskOutcome> {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  const actor = principal.memberId;
  const member = input.memberId.toLowerCase();
  if (member === actor) {
    throw refuse('FORBIDDEN', 'This is your own calendar. Reconnect it in Settings › Calendars.');
  }
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      await actingFor(tx, scope, member, 'view');
      // One press at a time per member, so two presses can't both read "not asked yet".
      await lockKey(tx, `calendar:reconnect:${scope.workspaceId}:${member}`);
      const people = await tx.execute<{ id: string; name: string; slug: string }>(sql`
        select m.id::text as id, m.name, w.slug from members m join workspaces w on w.id = m.workspace_id
        where m.id in (${actor}::uuid, ${member}::uuid)
      `);
      const name = people.rows.find((row) => row.id === member)?.name ?? 'This person';
      const [health] = foldMembers([member], await healthRows(tx, [member]));
      if (health?.status !== 'reconnect' && health?.status !== 'skipped') {
        throw refuse('STALE', `${name}’s calendar is working now, so there’s nothing to ask.`);
      }
      const last = await tx.execute<{ wait: number }>(sql`
        select ceil(extract(epoch from (a.at + make_interval(hours => ${CALENDAR_HEALTH.askEveryHours}) - now())))::int
          as wait
        from audit_events a
        where a.target_type = 'member' and a.target_id = ${member} and a.action = 'calendar.reconnect_asked'
        order by a.at desc nulls last
        limit 1
      `);
      const wait = last.rows[0]?.wait ?? 0;
      if (wait > 0) return { outcome: 'wait' as const, retryAfterSeconds: wait, name };
      await writeAudit(tx, scope.workspaceId, scope.actor, {
        action: 'calendar.reconnect_asked',
        targetType: 'member',
        targetId: member,
      });
      const at = await tx.execute<{ at: string; seconds: string }>(sql`
        select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at,
          floor(extract(epoch from now()))::bigint::text as seconds
      `);
      const askedAt = at.rows[0]?.at ?? new Date().toISOString();
      const params: CalendarReconnectAskedEmail = {
        actorName: people.rows.find((row) => row.id === actor)?.name ?? 'Someone',
        settingsPath: settingsPathOf(people.rows[0]?.slug ?? ''),
      };
      await queueEmail(tx, {
        kind: 'calendar_reconnect_asked',
        ids: [member, at.rows[0]?.seconds ?? String(Math.floor(Date.now() / 1000))],
        to: { memberId: member },
        params,
      });
      return { outcome: 'asked' as const, askedAt };
    },
    hooks,
  );
  return result;
}
