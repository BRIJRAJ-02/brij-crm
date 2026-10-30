// Teams (spec 0031, slice 8, AC-824 to AC-827), against a real Postgres as the app role: who may change them, the
// name rules, one member in several teams, the single place membership changes (with its audit and its `members` and
// `access` outbox rows), a team no rule names deleting and one a rule names refused, a removed member leaving their
// teams, and nothing crossing from one workspace to another.
import { sql } from 'drizzle-orm';
import type { Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { outboxHook } from '../engine/outbox.ts';
import { removeMember } from '../members/members.ts';
import { testScope } from '../testing.ts';
import { changeTeamMembers, createTeam, deleteTeam, listTeams, renameTeam } from './teams.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-teams-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace: Olga the owner and members to put in teams. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Teams',
    slug: `teams-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const as = (id: string, role: Role = 'member') =>
    testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id }, role });
  const owner = as(created.memberId, 'owner');
  const add = async (name: string, role: Role = 'member') => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return id;
  };
  const audit = (action: string) =>
    testQuery<{ actor_member_id: string; target_id: string; after: Record<string, unknown> }>(
      ownerUrl,
      `select actor_member_id::text, target_id, after from audit_events where workspace_id = $1 and action = $2 order by at, id`,
      [created.workspaceId, action],
    );
  const outbox = (kind: string) =>
    testQuery<{ item_ids: string[] | null }>(
      ownerUrl,
      `select item_ids::text[] as item_ids from outbox where workspace_id = $1 and kind = $2 order by seq`,
      [created.workspaceId, kind],
    );
  return { ...created, as, owner, add, audit, outbox };
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

describe('who may change teams', () => {
  it('lets owners and admins change them, and every member read them', async () => {
    const w = await world();
    const admin = await w.add('Ada Admin', 'admin');
    const member = await w.add('Max Member');
    const team = await createTeam(w.as(admin, 'admin'), { name: 'Sales' }, [outboxHook()]);
    expect(team.name).toBe('Sales');
    const forbidden = { code: 'FORBIDDEN', message: 'Only workspace owners and admins can change teams.' };
    expect(await refusalOf(createTeam(w.as(member), { name: 'Ops' }))).toEqual(forbidden);
    expect(await refusalOf(renameTeam(w.as(member), { teamId: team.id, name: 'Ops' }))).toEqual(forbidden);
    expect(await refusalOf(changeTeamMembers(w.as(member), { teamId: team.id, add: [member] }))).toEqual(forbidden);
    expect(await refusalOf(deleteTeam(w.as(member), { teamId: team.id }))).toEqual(forbidden);
    // Nothing changed, and the member reads the list.
    expect((await listTeams(w.as(member))).teams).toEqual([{ id: team.id, name: 'Sales', memberIds: [] }]);
  });
});

describe('names', () => {
  it('trims, refuses an empty or long name, and refuses one another team has, ignoring case', async () => {
    const w = await world();
    const sales = await createTeam(w.owner, { name: '  Sales  ' });
    expect(sales.name).toBe('Sales');
    await expect(createTeam(w.owner, { name: '   ' })).rejects.toMatchObject({
      inputProblem: { field: 'name' },
    });
    await expect(createTeam(w.owner, { name: 'x'.repeat(65) })).rejects.toMatchObject({
      inputProblem: { field: 'name' },
    });
    expect(await refusalOf(createTeam(w.owner, { name: 'SALES' }))).toMatchObject({
      code: 'NAME_TAKEN',
      field: 'name',
    });
    const ops = await createTeam(w.owner, { name: 'Ops' });
    expect(await refusalOf(renameTeam(w.owner, { teamId: ops.id, name: 'sales' }))).toMatchObject({
      code: 'NAME_TAKEN',
    });
    // The same team may change its own case.
    expect((await renameTeam(w.owner, { teamId: sales.id, name: 'SALES' })).name).toBe('SALES');
  });

  it('keeps a client chosen id, so a retry or an undo brings the same team back', async () => {
    const w = await world();
    const id = newId();
    const ada = await w.add('Ada');
    const first = await createTeam(w.owner, { id, name: 'Sales', memberIds: [ada] });
    expect(first.id).toBe(id);
    await deleteTeam(w.owner, { teamId: id });
    expect((await listTeams(w.owner)).teams).toEqual([]);
    const back = await createTeam(w.owner, { id, name: 'Sales', memberIds: [ada] });
    expect(back).toEqual(first);
    // A retry of a create that landed answers the team it made and writes nothing; another name on that id is taken.
    expect(await createTeam(w.owner, { id, name: 'sales', memberIds: [ada] })).toEqual(first);
    expect(await refusalOf(createTeam(w.owner, { id, name: 'Other' }))).toMatchObject({ code: 'ID_TAKEN' });
    expect((await w.audit('team.changed')).filter((row) => row.after.change === 'created')).toHaveLength(2);
    expect(
      await refusalOf(createTeam(w.owner, { id: '00000000-0000-4000-8000-000000000001', name: 'Odd' })),
    ).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});

describe('membership', () => {
  it('puts a member in several teams, ignores repeats, and reads them in the order they joined', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const grace = await w.add('Grace');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada] });
    const support = await createTeam(w.owner, { name: 'Support' });
    expect(sales.memberIds).toEqual([ada]);
    const again = await changeTeamMembers(w.owner, { teamId: sales.id, add: [ada, grace] });
    expect(again.memberIds).toEqual([ada, grace]);
    const both = await changeTeamMembers(w.owner, { teamId: support.id, add: [ada] });
    expect(both.memberIds).toEqual([ada]);
    const taken = await changeTeamMembers(w.owner, { teamId: sales.id, remove: [ada, newId()] });
    expect(taken.memberIds).toEqual([grace]);
    expect((await listTeams(w.owner)).teams.map((team) => [team.name, team.memberIds])).toEqual([
      ['Sales', [grace]],
      ['Support', [ada]],
    ]);
  });

  it('writes one audit row and one members and one access row naming the people and their teammates', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const grace = await w.add('Grace');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada] }, [outboxHook()]);
    await changeTeamMembers(w.owner, { teamId: sales.id, add: [grace] }, [outboxHook()]);
    // Adding someone already in changes nothing: no audit row, no outbox row.
    await changeTeamMembers(w.owner, { teamId: sales.id, add: [grace] }, [outboxHook()]);
    const rows = await w.audit('team.changed');
    expect(rows.map((row) => row.after.change)).toEqual(['created', 'members', 'members']);
    expect(rows[1]?.after).toMatchObject({ name: 'Sales', joined: [ada], left: [] });
    expect(rows[2]?.after).toMatchObject({ name: 'Sales', joined: [grace], left: [] });
    expect(rows[2]?.actor_member_id).toBe(w.memberId);
    const access = await w.outbox('access');
    // The create named Ada; Grace joining named Grace and Ada (a `team` record rule shows Ada Grace's records now).
    expect(access).toHaveLength(2);
    expect(new Set(access[1]?.item_ids)).toEqual(new Set([ada, grace]));
    expect((await w.outbox('members')).length).toBeGreaterThanOrEqual(2);
  });

  it('refuses someone who is not an active member here, and changes nothing', async () => {
    const w = await world();
    const other = await world();
    const stranger = await other.add('Stranger');
    const sales = await createTeam(w.owner, { name: 'Sales' });
    expect(await refusalOf(changeTeamMembers(w.owner, { teamId: sales.id, add: [stranger] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listTeams(w.owner)).teams[0]?.memberIds).toEqual([]);
  });

  it('removes a removed member from their teams, and the teammates read again', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const grace = await w.add('Grace');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada, grace] });
    await removeMember(w.owner, { memberId: ada }, [outboxHook()]);
    expect((await listTeams(w.owner)).teams[0]?.memberIds).toEqual([grace]);
    const access = await w.outbox('access');
    expect(access.some((row) => row.item_ids?.includes(grace))).toBe(true);
    expect(sales.id).toBeTruthy();
  });
});

describe('deleting', () => {
  it('deletes a team no rule names, with its people, and writes the audit row', async () => {
    const w = await world();
    const ada = await w.add('Ada');
    const sales = await createTeam(w.owner, { name: 'Sales', memberIds: [ada] }, [outboxHook()]);
    await deleteTeam(w.owner, { teamId: sales.id }, [outboxHook()]);
    expect((await listTeams(w.owner)).teams).toEqual([]);
    const rows = await w.audit('team.changed');
    expect(rows.map((row) => row.after.change)).toEqual(['created', 'members', 'deleted']);
    // The delete says who it took out.
    expect(rows[2]?.after).toMatchObject({ left: [ada] });
    expect(await refusalOf(deleteTeam(w.owner, { teamId: sales.id }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to delete a team an access rule names, saying where (AC-826)', async () => {
    const w = await world();
    const sales = await createTeam(w.owner, { name: 'Sales' });
    const [deals] = (
      await db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute<{ id: string; plural_name: string }>(
          sql`select id, plural_name from objects where workspace_id = ${w.workspaceId} order by position limit 1`,
        ),
      )
    ).rows;
    if (deals === undefined) throw new Error('A new workspace has objects.');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(
        sql`insert into access_rules (workspace_id, subject_type, subject_team_id, object_id, level, created_by_type, updated_by_type)
            values (${w.workspaceId}, 'team', ${sales.id}, ${deals.id}, 'write', 'system', 'system')`,
      ),
    );
    const refusal = await refusalOf(deleteTeam(w.owner, { teamId: sales.id }));
    expect(refusal).toMatchObject({ code: 'IN_USE' });
    expect(refusal.message).toContain(deals.plural_name);
    expect((await listTeams(w.owner)).teams).toHaveLength(1);
  });
});

describe('workspaces stay apart', () => {
  it('lists, renames, changes and deletes nothing of another workspace’s teams', async () => {
    const a = await world();
    const b = await world();
    const mine = await createTeam(a.owner, { name: 'Sales' });
    await createTeam(b.owner, { name: 'Sales' });
    // Another workspace's team id is no team here, and the same name there is no clash here.
    expect(await refusalOf(renameTeam(b.owner, { teamId: mine.id, name: 'Other' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(deleteTeam(b.owner, { teamId: mine.id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(changeTeamMembers(b.owner, { teamId: mine.id, add: [b.memberId] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listTeams(a.owner)).teams.map((team) => team.id)).toEqual([mine.id]);
    expect((await listTeams(b.owner)).teams.map((team) => team.id)).not.toContain(mine.id);
  });
});
