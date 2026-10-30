// Someone changed a member's scheduling, in the member's inbox (spec 0037, AC-1264, with spec 0038), against a real
// Postgres as the app role: one notification naming only the actor, emailed already unless the member takes the
// daily digest, never for the actor themself or a member who left.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { countUnread, listNotifications, unemailedNotifications } from './inbox.ts';
import { notifySchedulingChanged } from './notify.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-scheduling-inbox-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
/** A workspace whose owner Ada manages Bea, a member; Cy has left. */
async function world() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Scheduling inbox',
    slug: `sched-inbox-${String(count)}-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const { workspaceId } = created;
  const run = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  const bea = newId();
  const cy = newId();
  await run(sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
    values (${workspaceId}, ${bea}, 'Bea', ${`bea-${bea.slice(-6)}@example.com`}, 'member', 'system', 'system')`);
  await run(sql`insert into members (workspace_id, id, name, email, role, status, created_by_type, updated_by_type)
    values (${workspaceId}, ${cy}, 'Cy', ${`cy-${cy.slice(-6)}@example.com`}, 'member', 'removed', 'system', 'system')`);
  const notify = (memberId: string, actorMemberId: string) =>
    db.withWorkspace(workspaceId, (tx) => notifySchedulingChanged(tx, { workspaceId, memberId, actorMemberId }));
  const asMember = (memberId: string) =>
    testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role: 'member' });
  return { workspaceId, ada: created.memberId, bea, cy, run, notify, asMember };
}

describe('a scheduling change in the inbox (AC-1264)', () => {
  it('names the actor, counts as unread, and was emailed already', async () => {
    const w = await world();
    expect(await w.notify(w.bea, w.ada)).toBe(true);
    const [item, ...rest] = (await listNotifications(w.asMember(w.bea), { status: 'inbox' })).items;
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ kind: 'scheduling_changed', actor: { type: 'member', id: w.ada }, excerpt: '' });
    expect(item?.record).toBeUndefined();
    expect(await countUnread(w.asMember(w.bea))).toEqual({ count: 1, atLeast: false });
    // Its own email went: no notifications email or digest holds it again.
    expect((await unemailedNotifications(w.asMember(w.bea), { digest: true })).items).toEqual([]);
    // The kind filter finds it; nobody else's inbox holds it.
    expect(
      (await listNotifications(w.asMember(w.bea), { status: 'inbox', kind: 'scheduling_changed' })).items,
    ).toHaveLength(1);
    expect((await listNotifications(w.asMember(w.ada), { status: 'inbox' })).items).toEqual([]);
  });

  it('waits for the daily digest of a member who takes one', async () => {
    const w = await world();
    await w.run(sql`insert into notification_settings (workspace_id, member_id, digest, time_zone)
      values (${w.workspaceId}, ${w.bea}, true, 'Europe/London')`);
    expect(await w.notify(w.bea, w.ada)).toBe(true);
    expect((await unemailedNotifications(w.asMember(w.bea))).items).toEqual([]);
    const digest = await unemailedNotifications(w.asMember(w.bea), { digest: true });
    expect(digest.items.map((item) => item.kind)).toEqual(['scheduling_changed']);
  });

  it('tells nobody of their own change, and nobody who left', async () => {
    const w = await world();
    expect(await w.notify(w.ada, w.ada)).toBe(false);
    expect(await w.notify(w.cy, w.ada)).toBe(false);
    const rows = await w.run<{ n: number }>(sql`select count(*)::int as n from notifications`);
    expect(rows[0]?.n).toBe(0);
  });
});
