// Delegations of scheduling access (spec 0037, AC-1253 to AC-1257, AC-1261, AC-1269), against a real Postgres as
// the app role: who may grant and take back what, decision 7 (owners and admins), the caps, one audit row and one
// `access` outbox row per change, the reach they give, a removal clearing them both ways, and row level security.
import { sql } from 'drizzle-orm';
import { PERMISSIONS, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { inWorkspace } from '../access/run.ts';
import { canActFor, schedulingReach } from '../access/scheduling.ts';
import { readCalendarHealth } from '../calendar/health.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { getMyAccess, removeMember } from '../members/members.ts';
import { testScope } from '../testing.ts';
import { grantDelegation, listDelegations, revokeDelegation } from './delegations.ts';
import { listVisibleMembers } from './visible.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-delegations-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace whose creator (`owner`) is joined by one member of each role given, named M0, M1 and on. */
async function team(roles: readonly Role[]) {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Team',
    slug: `delegations-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const ids = roles.map(() => newId());
  await db.withWorkspace(created.workspaceId, async (tx) => {
    for (const [index, role] of roles.entries()) {
      const id = ids[index] ?? '';
      await tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${`M${String(index)}`}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      );
    }
  });
  const as = (memberId: string, role: Role) =>
    testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: memberId }, role });
  const auditRows = async () =>
    await testQuery<{ action: string; target_id: string; before: unknown; after: unknown }>(
      ownerUrl,
      `select action, target_id::text, before, after from audit_events
         where workspace_id = $1 and action like 'delegation.%' order by at, id`,
      [created.workspaceId],
    );
  const accessRows = async () =>
    (
      await testQuery<{ item_ids: string[] }>(
        ownerUrl,
        `select item_ids::text[] from outbox where workspace_id = $1 and kind = 'access' order by seq`,
        [created.workspaceId],
      )
    ).map((row) => row.item_ids);
  const reachOf = async (memberId: string, role: Role) => {
    const scope = as(memberId, role);
    return inWorkspace(scope, (tx) => schedulingReach(tx, scope));
  };
  return { ...created, owner: created.memberId, ids, as, auditRows, accessRows, reachOf };
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

const hooks = () => [outboxHook({ mutationId: newId() })];

describe('a member and their own scheduling (AC-1255)', () => {
  it('lets a colleague manage it, one audit row and one access row naming the delegate', async () => {
    const t = await team(['member', 'member']);
    const [bea = '', priya = ''] = t.ids;
    const view = await grantDelegation(
      t.as(bea, 'member'),
      { delegateMemberId: priya, target: { type: 'member', memberId: bea }, level: 'manage' },
      hooks(),
    );
    expect(view).toMatchObject({ delegateMemberId: priya, target: { type: 'member', memberId: bea }, level: 'manage' });
    expect(view.grantedBySelf).toBe(true);
    expect(await t.auditRows()).toEqual([
      {
        action: 'delegation.granted',
        target_id: priya,
        before: null,
        after: { level: 'manage', targetType: 'member', targetMemberId: bea },
      },
    ]);
    expect(await t.accessRows()).toEqual([[priya]]);
    // Priya now reaches Bea at Manage, and nobody else.
    const reach = await t.reachOf(priya, 'member');
    expect(canActFor(reach, bea, 'manage')).toBe(true);
    expect(canActFor(reach, t.owner, 'view')).toBe(false);
    expect(await getMyAccess(t.as(priya, 'member'))).toMatchObject({
      scheduling: { seesOthers: true, managesOthers: true, seesEveryone: false, managesEveryone: false },
    });
    expect((await listVisibleMembers(t.as(priya, 'member'))).members).toEqual([
      { id: priya, name: 'M1', canManage: true },
      { id: bea, name: 'M0', canManage: true },
    ]);
  });

  it('changes the level on a second grant (one delegation.changed row), and changes nothing on the same one', async () => {
    const t = await team(['member', 'member']);
    const [bea = '', priya = ''] = t.ids;
    const input = { delegateMemberId: priya, target: { type: 'member' as const, memberId: bea } };
    const first = await grantDelegation(t.as(bea, 'member'), { ...input, level: 'view' }, hooks());
    const again = await grantDelegation(t.as(bea, 'member'), { ...input, level: 'view' }, hooks());
    expect(again.id).toBe(first.id);
    const changed = await grantDelegation(t.as(bea, 'member'), { ...input, level: 'manage' }, hooks());
    expect(changed).toMatchObject({ id: first.id, level: 'manage' });
    expect((await t.auditRows()).map((row) => row.action)).toEqual(['delegation.granted', 'delegation.changed']);
    expect(await t.accessRows()).toEqual([[priya], [priya]]);
  });

  it('refuses a grant over someone else (FORBIDDEN) and a bad delegate (DELEGATE_INVALID)', async () => {
    const t = await team(['member', 'member']);
    const [bea = '', priya = ''] = t.ids;
    const me = t.as(bea, 'member');
    expect(
      await refusalOf(
        grantDelegation(me, { delegateMemberId: bea, target: { type: 'member', memberId: priya }, level: 'view' }),
      ),
    ).toEqual({ code: 'FORBIDDEN', message: PERMISSIONS['members.manage'].message });
    expect(
      await refusalOf(grantDelegation(me, { delegateMemberId: priya, target: { type: 'everyone' }, level: 'view' })),
    ).toEqual({ code: 'FORBIDDEN', message: PERMISSIONS['members.manage'].message });
    // Themself as their own delegate, a stranger, and a team before teams exist.
    for (const target of [
      { delegateMemberId: bea, target: { type: 'member' as const, memberId: bea } },
      { delegateMemberId: newId(), target: { type: 'member' as const, memberId: bea } },
    ]) {
      expect(await refusalOf(grantDelegation(me, { ...target, level: 'view' }))).toMatchObject({
        code: 'DELEGATE_INVALID',
      });
    }
    expect(
      await refusalOf(
        grantDelegation(me, { delegateMemberId: priya, target: { type: 'team', teamId: newId() }, level: 'view' }),
      ),
    ).toEqual({ code: 'DELEGATE_INVALID', message: 'Teams aren’t set up in this workspace yet.' });
    expect(await t.auditRows()).toEqual([]);
  });

  it('takes back their own, as the delegate may; anyone else meets it as absent', async () => {
    const t = await team(['member', 'member', 'member']);
    const [bea = '', priya = '', sam = ''] = t.ids;
    const target = { type: 'member' as const, memberId: bea };
    const one = await grantDelegation(t.as(bea, 'member'), { delegateMemberId: priya, target, level: 'manage' });
    expect(await refusalOf(revokeDelegation(t.as(sam, 'member'), { id: one.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(listDelegations(t.as(sam, 'member'), { memberId: bea }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    await revokeDelegation(t.as(bea, 'member'), { id: one.id }, hooks());
    expect(canActFor(await t.reachOf(priya, 'member'), bea, 'view')).toBe(false);
    const two = await grantDelegation(t.as(bea, 'member'), { delegateMemberId: priya, target, level: 'view' });
    await revokeDelegation(t.as(priya, 'member'), { id: two.id }, hooks());
    expect((await t.auditRows()).map((row) => row.action)).toEqual([
      'delegation.granted',
      'delegation.revoked',
      'delegation.granted',
      'delegation.revoked',
    ]);
    expect(await t.accessRows()).toEqual([[priya], [priya]]);
  });

  it('lists theirs both ways', async () => {
    const t = await team(['member', 'member']);
    const [bea = '', priya = ''] = t.ids;
    await grantDelegation(t.as(bea, 'member'), {
      delegateMemberId: priya,
      target: { type: 'member', memberId: bea },
      level: 'view',
    });
    const mine = await listDelegations(t.as(bea, 'member'));
    const theirs = await listDelegations(t.as(priya, 'member'));
    expect(mine.delegations).toHaveLength(1);
    expect(theirs.delegations).toEqual(mine.delegations);
    expect(await listDelegations(t.as(t.owner, 'owner'), { memberId: bea })).toEqual(mine);
  });
});

describe('admins and owners (AC-1253, AC-1255, decision 7)', () => {
  it('lets an admin give Manage over everyone, which never covers an owner or an admin', async () => {
    const t = await team(['admin', 'member', 'member']);
    const [admin = '', priya = '', bea = ''] = t.ids;
    await grantDelegation(
      t.as(admin, 'admin'),
      { delegateMemberId: priya, target: { type: 'everyone' }, level: 'manage' },
      hooks(),
    );
    const reach = await t.reachOf(priya, 'member');
    expect(canActFor(reach, bea, 'manage')).toBe(true);
    expect(canActFor(reach, t.owner, 'view')).toBe(false);
    expect(canActFor(reach, admin, 'view')).toBe(false);
    expect((await listVisibleMembers(t.as(priya, 'member'))).members.map((each) => each.id)).toEqual([priya, bea]);
    // Calendar health goes through the same reach: Bea's status, nothing for the owner.
    expect(
      (await readCalendarHealth(t.as(priya, 'member'), { memberIds: [bea, t.owner] })).map((h) => h.memberId),
    ).toEqual([bea]);
  });

  it('refuses an admin over an owner or another admin, and lets an owner give access over an admin', async () => {
    const t = await team(['admin', 'admin', 'member']);
    const [admin = '', other = '', priya = ''] = t.ids;
    const asAdmin = t.as(admin, 'admin');
    expect(
      await refusalOf(
        grantDelegation(asAdmin, {
          delegateMemberId: priya,
          target: { type: 'member', memberId: t.owner },
          level: 'view',
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      await refusalOf(
        grantDelegation(asAdmin, {
          delegateMemberId: priya,
          target: { type: 'member', memberId: other },
          level: 'view',
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    await grantDelegation(t.as(t.owner, 'owner'), {
      delegateMemberId: priya,
      target: { type: 'member', memberId: other },
      level: 'manage',
    });
    expect(canActFor(await t.reachOf(priya, 'member'), other, 'manage')).toBe(true);
    // The owner's own grant over themself counts too.
    await grantDelegation(t.as(t.owner, 'owner'), {
      delegateMemberId: priya,
      target: { type: 'member', memberId: t.owner },
      level: 'view',
    });
    expect(canActFor(await t.reachOf(priya, 'member'), t.owner, 'view')).toBe(true);
    expect(canActFor(await t.reachOf(priya, 'member'), t.owner, 'manage')).toBe(false);
  });

  it('acts with the admin’s role now: one demoted since the request came in is refused', async () => {
    const t = await team(['admin', 'member', 'member']);
    const [admin = '', priya = '', bea = ''] = t.ids;
    const stale = t.as(admin, 'admin');
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(sql`update members set role = 'member' where id = ${admin}`),
    );
    expect(
      await refusalOf(
        grantDelegation(stale, { delegateMemberId: priya, target: { type: 'member', memberId: bea }, level: 'view' }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('the caps (AC-1256)', () => {
  it('refuses a 21st delegate over one member, and never makes 21 when two grants race', async () => {
    const roles: Role[] = Array.from({ length: 22 }, () => 'member');
    const t = await team(roles);
    const [bea = '', ...others] = t.ids;
    const asBea = t.as(bea, 'member');
    const grant = (delegate: string) =>
      grantDelegation(asBea, { delegateMemberId: delegate, target: { type: 'member', memberId: bea }, level: 'view' });
    for (const delegate of others.slice(0, 19)) await grant(delegate);
    const raced = await Promise.allSettled([grant(others[19] ?? ''), grant(others[20] ?? '')]);
    expect(raced.filter((each) => each.status === 'fulfilled')).toHaveLength(1);
    const [count] = await testQuery<{ n: number }>(
      ownerUrl,
      `select count(*)::int as n from schedule_delegations where workspace_id = $1 and target_member_id = $2`,
      [t.workspaceId, bea],
    );
    expect(count?.n).toBe(20);
    const rejected = raced.find((each) => each.status === 'rejected');
    expect(rejected?.status === 'rejected' && isRefusal(rejected.reason) ? rejected.reason.refusal : undefined).toEqual(
      {
        code: 'DELEGATION_LIMIT',
        message: 'M0 already has 20 people managing their scheduling.',
      },
    );
  });
});

describe('a removal (AC-1269)', () => {
  it('deletes their delegations both ways, with an access row for each delegate who lost reach', async () => {
    const t = await team(['member', 'member', 'member']);
    const [bea = '', priya = '', sam = ''] = t.ids;
    await grantDelegation(t.as(bea, 'member'), {
      delegateMemberId: priya,
      target: { type: 'member', memberId: bea },
      level: 'manage',
    });
    await grantDelegation(t.as(sam, 'member'), {
      delegateMemberId: bea,
      target: { type: 'member', memberId: sam },
      level: 'view',
    });
    await removeMember(t.as(t.owner, 'owner'), { memberId: bea }, hooks());
    const left = await testQuery<{ n: number }>(
      ownerUrl,
      `select count(*)::int as n from schedule_delegations where workspace_id = $1`,
      [t.workspaceId],
    );
    expect(left[0]?.n).toBe(0);
    const rows = await t.accessRows();
    expect(rows.some((ids) => ids.includes(priya))).toBe(true);
    expect(canActFor(await t.reachOf(priya, 'member'), bea, 'view')).toBe(false);
  });
});

describe('row level security (the guard)', () => {
  it('reads no delegation of another workspace, even naming it', async () => {
    const t = await team(['member', 'member']);
    const [bea = '', priya = ''] = t.ids;
    await grantDelegation(t.as(bea, 'member'), {
      delegateMemberId: priya,
      target: { type: 'member', memberId: bea },
      level: 'manage',
    });
    const other = await team([]);
    const seen = await db.withWorkspace(other.workspaceId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from schedule_delegations where workspace_id = ${t.workspaceId}::uuid`,
      ),
    );
    expect(seen.rows[0]?.n).toBe(0);
  });
});
