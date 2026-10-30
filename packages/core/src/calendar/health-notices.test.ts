// Calendar health for teams (spec 0037, job J8): the episode's two emails (AC-1310), the outage hold's rule
// (AC-1311), Ask to reconnect's reach and 24 hours (AC-1309), and what a colleague's reads carry (AC-1425).
import { sql } from 'drizzle-orm';
import type { Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { systemScope } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { grantDelegation } from '../scheduling/delegations.ts';
import { testScope } from '../testing.ts';
import { readCalendarHealth } from './health.ts';
import { askToReconnect, isMassOutage, runCalendarHealthEmail } from './health-notices.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-health-notices-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace of Ada (owner), Bea and Priya (members), Bea with one Google account and its main calendar. */
async function team() {
  made += 1;
  const slug = `health-${String(made)}-${String(Date.now())}`;
  const created = await createWorkspace(db, {
    name: 'Health',
    slug,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const bea = newId();
  const priya = newId();
  const connectionId = newId();
  const calendarId = newId();
  await db.withWorkspace(created.workspaceId, async (tx) => {
    for (const [id, name] of [
      [bea, 'Bea Rao'],
      [priya, 'Priya Shah'],
    ] as const) {
      await tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, 'member', 'system', 'system')`,
      );
    }
    await tx.execute(sql`
      insert into calendar_connections (workspace_id, id, member_id, provider, account_email, status, tokens,
        created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
      values (${created.workspaceId}, ${connectionId}, ${bea}, 'google', 'bea.private@gmail.com', 'connected',
        '\\x00'::bytea, 'member', ${bea}, ${bea}, 'member', ${bea}, ${bea})
    `);
    await tx.execute(sql`
      insert into calendar_calendars (workspace_id, id, connection_id, member_id, provider_calendar_id, name,
        is_primary, check_conflicts, is_destination, access_role, created_by_type, updated_by_type)
      values (${created.workspaceId}, ${calendarId}, ${connectionId}, ${bea}, 'primary', 'Bea’s secret project',
        true, true, true, 'owner', 'calendar', 'calendar')
    `);
  });
  const as = (memberId: string, role: Role) =>
    testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: memberId }, role });
  const query = <T extends Record<string, unknown>>(statement: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, async (tx) => (await tx.execute<T>(statement)).rows);
  const setStatus = (status: string) =>
    query(sql`update calendar_connections set status = ${status}::calendar_status where id = ${connectionId}::uuid`);
  const episode = async () =>
    (
      await query<{ at: string | null }>(
        sql`select to_json(health_broken_at) #>> '{}' as at from calendar_connections where id = ${connectionId}::uuid`,
      )
    )[0]?.at ?? '';
  const emails = (kind: string) =>
    testQuery<{ key: string; to_member_id: string; params: Record<string, unknown> }>(
      ownerUrl,
      `select key, to_member_id::text, params from emails where workspace_id = $1 and kind = $2 order by created_at`,
      [created.workspaceId, kind],
    );
  const system = () => systemScope(db, created.workspaceId);
  return {
    ...created,
    slug,
    owner: created.memberId,
    bea,
    priya,
    connectionId,
    as,
    query,
    setStatus,
    episode,
    emails,
    system,
  };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

describe('the mass outage hold (AC-1311)', () => {
  it('holds at a quarter of the checked connections and at least 4', () => {
    expect(isMassOutage(12, 5)).toBe(true);
    expect(isMassOutage(16, 4)).toBe(true);
    expect(isMassOutage(17, 4)).toBe(false);
    expect(isMassOutage(8, 3)).toBe(false);
    expect(isMassOutage(0, 0)).toBe(false);
  });
});

describe('two emails per broken episode (AC-1310)', () => {
  it('sends the first once, the reminder once 7 days on, nothing after, and starts again after a reconnect', async () => {
    const t = await team();
    await t.setStatus('expired');
    const first = await t.episode();
    const send = (reminder: boolean, episode = first) =>
      runCalendarHealthEmail(t.system(), { connectionId: t.connectionId, episode, reminder });
    expect(await send(true)).toBe('not_due');
    expect(await send(false)).toBe('queued');
    // A retried job, or the next sweeps: nothing more.
    expect(await send(false)).toBe('not_due');
    expect(await send(true)).toBe('not_due');
    const [told] = await t.emails('calendar_disconnected');
    expect(told).toMatchObject({
      to_member_id: t.bea,
      params: {
        provider: 'google',
        accountEmail: 'bea.private@gmail.com',
        reason: 'expired',
        settingsPath: `/w/${t.slug}/settings/scheduling/calendars`,
      },
    });
    expect(told?.params).not.toHaveProperty('reminder');
    expect(told?.key).toMatch(new RegExp(`^calendar_disconnected:${t.connectionId}:\\d+:first$`));
    // A week on, still broken: the one reminder.
    await t.query(
      sql`update calendar_connections set health_notified_at = now() - interval '7 days 1 minute' where id = ${t.connectionId}::uuid`,
    );
    expect(await send(true)).toBe('queued');
    expect(await send(true)).toBe('not_due');
    const sent = await t.emails('calendar_disconnected');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.params).toMatchObject({ reminder: true });
    expect(sent[1]?.key).toMatch(/:reminder$/);
    // Reconnected: the episode is over, and a job queued for it tells nothing.
    await t.setStatus('connected');
    expect(await send(false)).toBe('healed');
    // A new break is a new episode: its own first email.
    await t.setStatus('failed');
    const second = await t.episode();
    expect(second).not.toBe(first);
    expect(await send(false, first)).toBe('healed');
    expect(await send(false, second)).toBe('queued');
    expect(await t.emails('calendar_disconnected')).toHaveLength(3);
  });

  it('is the system’s alone', async () => {
    const t = await team();
    await expect(
      runCalendarHealthEmail(t.as(t.owner, 'owner'), { connectionId: t.connectionId, episode: '', reminder: false }),
    ).rejects.toThrow(/Only the system/);
  });
});

describe('Ask to reconnect (AC-1309)', () => {
  it('lets someone with See ask once a day, emails who asked and nothing of the calendar, and audits it', async () => {
    const t = await team();
    await t.setStatus('expired');
    const priya = t.as(t.priya, 'member');
    // No reach over Bea: she is absent.
    expect(await refusalOf(askToReconnect(priya, { memberId: t.bea }))).toMatchObject({ code: 'NOT_FOUND' });
    await grantDelegation(t.as(t.owner, 'owner'), {
      delegateMemberId: t.priya,
      target: { type: 'member', memberId: t.bea },
      level: 'view',
    });
    const asked = await askToReconnect(priya, { memberId: t.bea });
    expect(asked).toMatchObject({ outcome: 'asked' });
    const [email] = await t.emails('calendar_reconnect_asked');
    expect(email).toMatchObject({
      to_member_id: t.bea,
      params: { actorName: 'Priya Shah', settingsPath: `/w/${t.slug}/settings/scheduling/calendars` },
    });
    expect(JSON.stringify(email?.params)).not.toMatch(/gmail|secret/);
    // Once per member per 24 hours, whoever asks: the owner too.
    const again = await askToReconnect(t.as(t.owner, 'owner'), { memberId: t.bea });
    expect(again).toMatchObject({ outcome: 'wait', name: 'Bea Rao' });
    if (again.outcome === 'wait') {
      expect(again.retryAfterSeconds).toBeGreaterThan(23 * 3600);
      expect(again.retryAfterSeconds).toBeLessThanOrEqual(24 * 3600);
    }
    expect(await t.emails('calendar_reconnect_asked')).toHaveLength(1);
    const audit = await testQuery<{ action: string; target_id: string; actor_member_id: string }>(
      ownerUrl,
      `select action, target_id, actor_member_id::text from audit_events where workspace_id = $1 and action = 'calendar.reconnect_asked'`,
      [t.workspaceId],
    );
    expect(audit).toEqual([{ action: 'calendar.reconnect_asked', target_id: t.bea, actor_member_id: t.priya }]);
  });

  it('lets anyone ask again once the last ask is a day old', async () => {
    const t = await team();
    await t.setStatus('failed');
    // The audit log is append only: an ask made a day and a second ago, stored as one would have been.
    await t.query(sql`
      insert into audit_events (workspace_id, actor_type, actor_id, actor_member_id, action, target_type, target_id, at)
      values (${t.workspaceId}, 'member', ${t.priya}, ${t.priya}, 'calendar.reconnect_asked', 'member', ${t.bea},
        now() - interval '24 hours 1 second')
    `);
    expect(await askToReconnect(t.as(t.owner, 'owner'), { memberId: t.bea })).toMatchObject({ outcome: 'asked' });
  });

  it('refuses a calendar that works, and your own', async () => {
    const t = await team();
    const owner = t.as(t.owner, 'owner');
    expect(await refusalOf(askToReconnect(owner, { memberId: t.bea }))).toMatchObject({ code: 'STALE' });
    expect(await refusalOf(askToReconnect(owner, { memberId: t.priya }))).toMatchObject({ code: 'STALE' });
    expect(await refusalOf(askToReconnect(owner, { memberId: t.owner }))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await t.emails('calendar_reconnect_asked')).toEqual([]);
  });
});

describe('what a colleague’s calendar reads carry (AC-1425)', () => {
  it('answers a status and a time about a colleague, never an address, a calendar name or an error', async () => {
    const t = await team();
    await t.query(
      sql`update calendar_calendars set last_error = '{"code":"CALENDAR_UNAVAILABLE","message":"Provider said 503 for bea.private@gmail.com","source":"sync"}'::jsonb, failing_since = now() where connection_id = ${t.connectionId}::uuid`,
    );
    const health = await readCalendarHealth(t.as(t.owner, 'owner'), { memberIds: [t.bea] });
    expect(health).toEqual([{ memberId: t.bea, status: 'reconnect', since: expect.any(String) as string }]);
    expect(JSON.stringify(health)).not.toMatch(/gmail|secret|503|primary/i);
  });
});
