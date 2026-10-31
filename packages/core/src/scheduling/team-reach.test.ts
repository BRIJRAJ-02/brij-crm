// Teams in scheduling reach (spec 0037, lane L3a: AC-1253, AC-1254, AC-1269, AC-1274, AC-1443), against a real
// Postgres as the app role: a team delegation reaches the team's active members at each check (never an owner or an
// admin in it), a `.team` permission reaches team mates, a membership change, a role change, a removal and a team's
// deletion each name the delegates whose reach changed in an `access` row, deleting a team deletes its delegations
// (and the foreign key cascades), and nothing crosses workspaces.
import { sql } from 'drizzle-orm';
import type { Permission, Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { mintScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { readTeamWeek } from '../availability/team-week.ts';
import { mondayOf } from '@crm/contracts/roster';
import { canActFor, schedulingReach } from '../access/scheduling.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { removeMember, setMemberRole } from '../members/members.ts';
import { changeTeamMembers, createTeam, deleteTeam } from '../teams/teams.ts';
import { testScope } from '../testing.ts';
import { grantDelegation, listDelegations } from './delegations.ts';
import { listVisibleMembers } from './visible.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-team-reach-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace whose creator (`owner`) is joined by one member of each role given, named M0, M1 and on. */
async function world(roles: readonly Role[]) {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Team reach',
    slug: `team-reach-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga', email: 'olga@example.com' },
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
  const owner = as(created.memberId, 'owner');
  const reachOf = async (memberId: string, role: Role, extra: readonly Permission[] = []) => {
    const base = as(memberId, role);
    const scope =
      extra.length === 0
        ? base
        : mintScope({
            db,
            workspaceId: created.workspaceId,
            actor: base.actor,
            access: { ...base.access, permissions: [...base.access.permissions, ...extra] },
          });
    return inWorkspace(scope, (tx) => schedulingReach(tx, scope));
  };
  const accessRows = async () =>
    (
      await testQuery<{ item_ids: string[] }>(
        ownerUrl,
        `select item_ids::text[] from outbox where workspace_id = $1 and kind = 'access' order by seq`,
        [created.workspaceId],
      )
    ).map((row) => row.item_ids);
  const auditRows = async () =>
    await testQuery<{ action: string; target_id: string; before: unknown; after: unknown }>(
      ownerUrl,
      `select action, target_id::text, before, after from audit_events
         where workspace_id = $1 and action like 'delegation.%' order by at, id`,
      [created.workspaceId],
    );
  return { ...created, ids, as, owner, reachOf, accessRows, auditRows };
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

describe('a team delegation (AC-1254)', () => {
  it('reaches the team’s active members at its level, never an owner or an admin in it', async () => {
    const w = await world(['member', 'member', 'member', 'admin']);
    const [priya = '', bea = '', cy = '', ada = ''] = w.ids;
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [bea, ada, w.memberId] }, hooks());
    const view = await grantDelegation(
      w.owner,
      { delegateMemberId: priya, target: { type: 'team', teamId: sales.id }, level: 'manage' },
      hooks(),
    );
    expect(view).toMatchObject({ target: { type: 'team', teamId: sales.id }, level: 'manage', grantedBySelf: false });
    const reach = await w.reachOf(priya, 'member');
    expect(canActFor(reach, bea, 'manage')).toBe(true);
    expect(canActFor(reach, cy, 'view')).toBe(false);
    expect(canActFor(reach, ada, 'view')).toBe(false);
    expect(canActFor(reach, w.memberId, 'view')).toBe(false);
    expect((await listVisibleMembers(w.as(priya, 'member'))).members.map((m) => m.id)).toEqual([priya, bea]);
    const [granted] = await w.auditRows();
    expect(granted).toMatchObject({
      action: 'delegation.granted',
      after: { level: 'manage', targetType: 'team', targetTeamId: sales.id },
    });
    expect((await listDelegations(w.owner, { everyone: true })).delegations).toHaveLength(1);
  });

  it('is a manager’s to give: a member is FORBIDDEN, an unknown team NOT_FOUND, another workspace’s too', async () => {
    const w = await world(['member']);
    const [priya = ''] = w.ids;
    const other = await world([]);
    const theirs = await createTeam(other.owner, { name: 'Sales' });
    for (const teamId of [newId(), theirs.id]) {
      expect(
        await refusalOf(
          grantDelegation(w.owner, { delegateMemberId: priya, target: { type: 'team', teamId }, level: 'view' }),
        ),
      ).toEqual({ code: 'NOT_FOUND', message: 'That team doesn’t exist.' });
    }
    // A plain member gives no team delegation, even over a team they're in: it's a manager's.
    const mine = await createTeam(w.owner, { name: 'Mine', memberIds: [priya] });
    expect(
      await refusalOf(
        grantDelegation(w.as(priya, 'member'), {
          delegateMemberId: w.memberId,
          target: { type: 'team', teamId: mine.id },
          level: 'view',
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(await w.auditRows()).toEqual([]);
    expect((await listDelegations(w.owner, { everyone: true })).delegations).toEqual([]);
  });

  it('follows the team: a joiner is reached at once and a leaver no more, each change naming the delegate', async () => {
    const w = await world(['member', 'member', 'member']);
    const [priya = '', bea = '', cy = ''] = w.ids;
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [bea] }, hooks());
    await grantDelegation(
      w.owner,
      { delegateMemberId: priya, target: { type: 'team', teamId: sales.id }, level: 'view' },
      hooks(),
    );
    const before = (await w.accessRows()).length;
    await changeTeamMembers(w.owner, { teamId: sales.id, add: [cy], remove: [bea] }, hooks());
    const reach = await w.reachOf(priya, 'member');
    expect(canActFor(reach, cy, 'view')).toBe(true);
    expect(canActFor(reach, bea, 'view')).toBe(false);
    const rows = (await w.accessRows()).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.arrayContaining([priya, bea, cy]));
  });

  it('names its delegate when a team member changes role or is removed', async () => {
    const w = await world(['member', 'member', 'member']);
    const [priya = '', bea = '', cy = ''] = w.ids;
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [bea, cy] }, hooks());
    await grantDelegation(
      w.owner,
      { delegateMemberId: priya, target: { type: 'team', teamId: sales.id }, level: 'manage' },
      hooks(),
    );
    let before = (await w.accessRows()).length;
    await setMemberRole(w.owner, { memberId: bea, role: 'admin' }, hooks());
    expect((await w.accessRows()).slice(before).flat()).toContain(priya);
    expect(canActFor(await w.reachOf(priya, 'member'), bea, 'view')).toBe(false);
    before = (await w.accessRows()).length;
    await removeMember(w.owner, { memberId: cy }, hooks());
    expect((await w.accessRows()).slice(before).flat()).toContain(priya);
    expect(canActFor(await w.reachOf(priya, 'member'), cy, 'view')).toBe(false);
  });
});

describe('deleting a team (AC-1269, AC-1443)', () => {
  it('deletes the delegations over it, audited, naming their delegates, and the team goes', async () => {
    const w = await world(['member', 'member', 'member']);
    const [priya = '', sam = '', bea = ''] = w.ids;
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [bea] }, hooks());
    for (const delegate of [priya, sam]) {
      await grantDelegation(
        w.owner,
        { delegateMemberId: delegate, target: { type: 'team', teamId: sales.id }, level: 'manage' },
        hooks(),
      );
    }
    const before = (await w.accessRows()).length;
    await deleteTeam(w.owner, { teamId: sales.id }, hooks());
    expect((await listDelegations(w.owner, { everyone: true })).delegations).toEqual([]);
    expect((await w.auditRows()).filter((row) => row.action === 'delegation.revoked')).toHaveLength(2);
    expect((await w.accessRows()).slice(before).flat()).toEqual(expect.arrayContaining([priya, sam, bea]));
    expect(canActFor(await w.reachOf(priya, 'member'), bea, 'view')).toBe(false);
  });

  it('holds the foreign key: a delegation can’t name a team that isn’t there, and cascades with it', async () => {
    const w = await world(['member', 'member']);
    const [priya = '', bea = ''] = w.ids;
    const insert = (teamId: string) =>
      db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(
          sql`insert into schedule_delegations (workspace_id, delegate_member_id, target_type, target_team_id, level, created_by_type, updated_by_type)
              values (${w.workspaceId}, ${priya}, 'team', ${teamId}, 'view', 'system', 'system')`,
        ),
      );
    await expect(insert(newId())).rejects.toThrow();
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [bea] });
    await insert(sales.id);
    // Straight at the table, past `deleteTeam`: the foreign key alone takes the delegation with the team.
    await db.withWorkspace(w.workspaceId, async (tx) => {
      await tx.execute(sql`delete from team_members where workspace_id = ${w.workspaceId} and team_id = ${sales.id}`);
      await tx.execute(sql`delete from teams where workspace_id = ${w.workspaceId} and id = ${sales.id}`);
    });
    expect((await listDelegations(w.owner, { everyone: true })).delegations).toEqual([]);
  });
});

describe('the Roster’s team filter (AC-1289)', () => {
  const monday = () => mondayOf(new Date().toISOString().slice(0, 10));

  it('narrows the week to one team’s people, never past the reader’s reach, and an unknown team to nobody', async () => {
    const w = await world(['member', 'member', 'member']);
    const [priya = '', bea = '', cy = ''] = w.ids;
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [bea, cy] });
    const ofWeek = async (scope: typeof w.owner, teamId?: string) =>
      (await readTeamWeek(scope, { now: () => new Date() }, { weekStart: monday(), teamId })).rows.map(
        (row) => row.memberId,
      );
    // The owner reaches everyone: the filter alone narrows.
    expect(await ofWeek(w.owner)).toHaveLength(4);
    expect([...(await ofWeek(w.owner, sales.id))].sort()).toEqual([bea, cy].sort());
    expect(await ofWeek(w.owner, newId())).toEqual([]);
    // Priya reaches only Bea: the team filter never shows her Cy.
    await grantDelegation(
      w.owner,
      { delegateMemberId: priya, target: { type: 'member', memberId: bea }, level: 'view' },
      hooks(),
    );
    expect(await ofWeek(w.as(priya, 'member'), sales.id)).toEqual([bea]);
  });
});

describe('a `.team` permission (AC-1253)', () => {
  it('reaches the active members sharing any of the caller’s teams, never an owner or an admin', async () => {
    const w = await world(['member', 'member', 'member', 'admin', 'member']);
    const [lead = '', bea = '', cy = '', ada = '', dee = ''] = w.ids;
    await createTeam(w.owner, { name: 'Sales', memberIds: [lead, bea, ada, w.memberId] });
    await createTeam(w.owner, { name: 'Support', memberIds: [lead, cy] });
    await createTeam(w.owner, { name: 'Ops', memberIds: [dee] });
    const manages = await w.reachOf(lead, 'member', ['schedule.manage.team']);
    expect(canActFor(manages, bea, 'manage')).toBe(true);
    expect(canActFor(manages, cy, 'manage')).toBe(true);
    expect(canActFor(manages, dee, 'view')).toBe(false);
    expect(canActFor(manages, ada, 'view')).toBe(false);
    expect(canActFor(manages, w.memberId, 'view')).toBe(false);
    const sees = await w.reachOf(lead, 'member', ['schedule.view.team']);
    expect(canActFor(sees, bea, 'view')).toBe(true);
    expect(canActFor(sees, bea, 'manage')).toBe(false);
    // Without the permission, sharing a team gives nothing.
    expect(canActFor(await w.reachOf(lead, 'member'), bea, 'view')).toBe(false);
  });
});
