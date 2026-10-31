// The owner rules (spec 0009, AC-137), against a real Postgres as the app
// role: who may change whose role or remove whom, self changes within the
// rules, and the last owner kept by the service and, at commit, the database.
import { sql } from 'drizzle-orm';
import { LAST_OWNER_MESSAGE, OWNER_RULES_MESSAGE, PERMISSIONS, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterAsActor, NO_RULE_SOURCE, systemScope } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isInputError, isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { getMyAccess, leaveWorkspace, listMembers, removeMember, setMemberRole, transferOwnership } from './members.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-members-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace whose creator (`owner`) is joined by one member of each role given. */
async function team(roles: readonly Role[]) {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Team',
    slug: `team-${String(made)}-${String(Date.now())}`,
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
  const roleOf = async (memberId: string) => {
    const result = await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute<{ role: string; status: string }>(sql`select role, status from members where id = ${memberId}`),
    );
    return result.rows[0];
  };
  return { ...created, owner: created.memberId, ids, as, roleOf };
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

const FORBIDDEN_MANAGE = { code: 'FORBIDDEN', message: PERMISSIONS['members.manage'].message };
const FORBIDDEN_OWNER = { code: 'FORBIDDEN', message: OWNER_RULES_MESSAGE };
const LAST_OWNER = { code: 'LAST_OWNER', message: LAST_OWNER_MESSAGE };

describe('an owner', () => {
  it('gives and takes away any role, the owner role included', async () => {
    const t = await team(['member', 'admin']);
    const [member = '', admin = ''] = t.ids;
    const owner = t.as(t.owner, 'owner');
    expect(await setMemberRole(owner, { memberId: member, role: 'admin' })).toMatchObject({
      id: member,
      role: 'admin',
    });
    await setMemberRole(owner, { memberId: admin, role: 'owner' });
    expect(await t.roleOf(admin)).toEqual({ role: 'owner', status: 'active' });
    await setMemberRole(owner, { memberId: admin, role: 'member' });
    expect(await t.roleOf(admin)).toEqual({ role: 'member', status: 'active' });
  });

  it('can’t step down or leave as the only owner, and can once another owner exists', async () => {
    const t = await team(['admin']);
    const [admin = ''] = t.ids;
    const owner = t.as(t.owner, 'owner');
    expect(await refusalOf(setMemberRole(owner, { memberId: t.owner, role: 'admin' }))).toEqual(LAST_OWNER);
    expect(await refusalOf(removeMember(owner, { memberId: t.owner }))).toEqual(LAST_OWNER);
    await setMemberRole(owner, { memberId: admin, role: 'owner' });
    await setMemberRole(owner, { memberId: t.owner, role: 'admin' });
    expect(await t.roleOf(t.owner)).toEqual({ role: 'admin', status: 'active' });
  });

  it('removes a member, who the door then refuses', async () => {
    const t = await team(['member']);
    const [member = ''] = t.ids;
    await removeMember(t.as(t.owner, 'owner'), { memberId: member });
    expect(await t.roleOf(member)).toEqual({ role: 'member', status: 'removed' });
    expect(
      await refusalOf(
        enterAsActor(
          { db, rules: NO_RULE_SOURCE },
          { workspaceId: t.workspaceId, actor: { type: 'member', id: member } },
        ),
      ),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect((await listMembers(t.as(t.owner, 'owner'))).members.map((each) => each.id)).not.toContain(member);
    // Acting on them again: they are gone.
    expect(await refusalOf(removeMember(t.as(t.owner, 'owner'), { memberId: member }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('an admin', () => {
  it('moves members and admins between member and admin, and removes them', async () => {
    const t = await team(['admin', 'member', 'admin']);
    const [admin = '', member = '', other = ''] = t.ids;
    const scope = t.as(admin, 'admin');
    await setMemberRole(scope, { memberId: member, role: 'admin' });
    await setMemberRole(scope, { memberId: other, role: 'member' });
    await removeMember(scope, { memberId: member });
    expect(await t.roleOf(member)).toEqual({ role: 'admin', status: 'removed' });
    // Their own role too.
    await setMemberRole(scope, { memberId: admin, role: 'member' });
    expect(await t.roleOf(admin)).toEqual({ role: 'member', status: 'active' });
  });

  it('never makes an owner, changes an owner or removes one, themself included', async () => {
    const t = await team(['admin', 'member']);
    const [admin = '', member = ''] = t.ids;
    const scope = t.as(admin, 'admin');
    expect(await refusalOf(setMemberRole(scope, { memberId: member, role: 'owner' }))).toEqual(FORBIDDEN_OWNER);
    expect(await refusalOf(setMemberRole(scope, { memberId: admin, role: 'owner' }))).toEqual(FORBIDDEN_OWNER);
    expect(await refusalOf(setMemberRole(scope, { memberId: t.owner, role: 'admin' }))).toEqual(FORBIDDEN_OWNER);
    expect(await refusalOf(removeMember(scope, { memberId: t.owner }))).toEqual(FORBIDDEN_OWNER);
    expect(await t.roleOf(t.owner)).toEqual({ role: 'owner', status: 'active' });
  });
});

describe('a member', () => {
  it('changes no roles, their own included, and removes nobody else', async () => {
    const t = await team(['member', 'member']);
    const [member = '', other = ''] = t.ids;
    const scope = t.as(member, 'member');
    expect(await refusalOf(setMemberRole(scope, { memberId: other, role: 'admin' }))).toEqual(FORBIDDEN_MANAGE);
    expect(await refusalOf(setMemberRole(scope, { memberId: member, role: 'admin' }))).toEqual(FORBIDDEN_MANAGE);
    expect(await refusalOf(setMemberRole(scope, { memberId: member, role: 'member' }))).toEqual(FORBIDDEN_MANAGE);
    expect(await refusalOf(removeMember(scope, { memberId: other }))).toEqual(FORBIDDEN_MANAGE);
    expect(await refusalOf(removeMember(scope, { memberId: t.owner }))).toEqual(FORBIDDEN_MANAGE);
  });

  it('may leave', async () => {
    const t = await team(['member']);
    const [member = ''] = t.ids;
    await removeMember(t.as(member, 'member'), { memberId: member });
    expect(await t.roleOf(member)).toEqual({ role: 'member', status: 'removed' });
  });

  it('sees their own role and permissions (access.mine)', async () => {
    const t = await team(['member']);
    expect(await getMyAccess(t.as(t.ids[0] ?? '', 'member'))).toEqual({
      memberId: t.ids[0],
      role: 'member',
      roleLabel: 'Member',
      permissions: ['lists.manage', 'records.export', 'booking.manage', 'availability.own'],
      // Spec 0031, AC-825: the teams they are in, none yet.
      teamIds: [],
      // Spec 0037, AC-1261: a member reaches nobody's scheduling but their own; an owner everyone's.
      scheduling: { seesOthers: false, managesOthers: false, seesEveryone: false, managesEveryone: false },
    });
    expect(await getMyAccess(t.as(t.owner, 'owner'))).toMatchObject({
      role: 'owner',
      roleLabel: 'Owner',
      scheduling: { seesOthers: true, managesOthers: true, seesEveryone: true, managesEveryone: true },
    });
  });
});

describe('the rules hold under a race and for the system', () => {
  it('lets only one of two owners demote the other at the same moment', async () => {
    const t = await team(['owner']);
    const [second = ''] = t.ids;
    const results = await Promise.allSettled([
      setMemberRole(t.as(t.owner, 'owner'), { memberId: second, role: 'member' }),
      setMemberRole(t.as(second, 'owner'), { memberId: t.owner, role: 'member' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [failed] = results.filter((result) => result.status === 'rejected');
    // The second to take the lock is no owner any more: they act with their role now, a member's.
    expect(isRefusal(failed?.reason) ? failed.reason.refusal : failed?.reason).toEqual(FORBIDDEN_MANAGE);
    const roles = await Promise.all([t.roleOf(t.owner), t.roleOf(second)]);
    expect(roles.filter((row) => row?.role === 'owner')).toHaveLength(1);
  });

  it('judges the actor by their role now, not as the door saw it, and refuses one removed since', async () => {
    const t = await team(['owner', 'owner']);
    const [second = '', third = ''] = t.ids;
    // The second owner's request entered as an owner; then they were demoted.
    const stale = t.as(second, 'owner');
    await setMemberRole(t.as(t.owner, 'owner'), { memberId: second, role: 'member' });
    expect(await refusalOf(setMemberRole(stale, { memberId: third, role: 'member' }))).toEqual(FORBIDDEN_MANAGE);
    expect(await refusalOf(removeMember(stale, { memberId: third }))).toEqual(FORBIDDEN_MANAGE);
    expect(await t.roleOf(third)).toEqual({ role: 'owner', status: 'active' });
    await removeMember(t.as(t.owner, 'owner'), { memberId: second });
    expect(await refusalOf(setMemberRole(stale, { memberId: second, role: 'admin' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lets only an owner touch a member whose stored role the code doesn’t know', async () => {
    await testQuery(ownerUrl, "alter type member_role add value if not exists 'visitor'");
    const t = await team(['admin', 'member']);
    const [admin = '', visitor = ''] = t.ids;
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(sql`update members set role = 'visitor' where id = ${visitor}`),
    );
    expect(await refusalOf(removeMember(t.as(admin, 'admin'), { memberId: visitor }))).toEqual(FORBIDDEN_OWNER);
    await removeMember(t.as(t.owner, 'owner'), { memberId: visitor });
  });

  it('lets the system make an owner, and still keeps the last one', async () => {
    const t = await team(['member']);
    const [member = ''] = t.ids;
    const scope = systemScope(db, t.workspaceId);
    await setMemberRole(scope, { memberId: member, role: 'owner' });
    await setMemberRole(scope, { memberId: t.owner, role: 'member' });
    expect(await refusalOf(setMemberRole(scope, { memberId: member, role: 'admin' }))).toEqual(LAST_OWNER);
  });

  it('refuses an unknown member and a role outside the catalog', async () => {
    const t = await team([]);
    const owner = t.as(t.owner, 'owner');
    expect(await refusalOf(setMemberRole(owner, { memberId: newId(), role: 'admin' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(setMemberRole(owner, { memberId: t.owner, role: 'viewer' as Role }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});

/** The workspace's audit rows, oldest first. */
const auditOf = (workspaceId: string) =>
  testQuery<{ action: string; target_id: string; actor_member_id: string | null; before: unknown; after: unknown }>(
    ownerUrl,
    'select action, target_id, actor_member_id::text, before, after from audit_events where workspace_id = $1 order by at, id',
    [workspaceId],
  );

describe('the Members page’s list (spec 0031, AC-810)', () => {
  it('pages by name with a cursor, each member with their role, when they joined and the count', async () => {
    const t = await team(['admin', 'member', 'member']);
    const owner = t.as(t.owner, 'owner');
    const first = await listMembers(owner, { limit: 2 });
    expect(first.total).toBe(4);
    expect(first.members.map((each) => each.name)).toEqual(['Ada', 'M0']);
    expect(first.members[0]).toMatchObject({ role: 'owner' });
    expect(first.members.every((each) => !Number.isNaN(Date.parse(each.joinedAt)))).toBe(true);
    const second = await listMembers(owner, { limit: 2, cursor: first.nextCursor ?? '' });
    expect(second.members.map((each) => each.name)).toEqual(['M1', 'M2']);
    expect(second.nextCursor).toBeUndefined();
    // Every member may read it.
    const [, member = ''] = t.ids;
    expect((await listMembers(t.as(member, 'member'))).members).toHaveLength(4);
  });

  it('searches names and emails in any case, taking % and _ literally, and refuses a cursor it didn’t make', async () => {
    const t = await team(['member', 'member']);
    const [first = '', second = ''] = t.ids;
    await testQuery(ownerUrl, `update members set name = 'Grace Hopper' where id = $1`, [first]);
    await testQuery(ownerUrl, `update members set name = '100% Linus', email = 'linus_t@example.com' where id = $1`, [
      second,
    ]);
    const owner = t.as(t.owner, 'owner');
    expect((await listMembers(owner, { search: 'GRACE' })).members.map((each) => each.id)).toEqual([first]);
    expect((await listMembers(owner, { search: first.slice(-8) })).members.map((each) => each.id)).toEqual([first]);
    expect((await listMembers(owner, { search: '100%' })).members.map((each) => each.id)).toEqual([second]);
    expect((await listMembers(owner, { search: 's_t@' })).members.map((each) => each.id)).toEqual([second]);
    expect(await listMembers(owner, { search: '%' })).toMatchObject({ total: 1 });
    expect(await listMembers(owner, { search: 'nobody here' })).toEqual({ members: [], total: 0 });
    await expect(listMembers(owner, { cursor: 'not-a-cursor' })).rejects.toSatisfy(isInputError);
  });
});

describe('the audit log for members (spec 0031, AC-830)', () => {
  it('writes one row for a role change, with only the role before and after', async () => {
    const t = await team(['member']);
    const [member = ''] = t.ids;
    const changed = await setMemberRole(t.as(t.owner, 'owner'), { memberId: member, role: 'admin' });
    expect(changed).toMatchObject({ id: member, role: 'admin' });
    expect(await auditOf(t.workspaceId)).toEqual([
      {
        action: 'member.role_changed',
        target_id: member,
        actor_member_id: t.owner,
        before: { role: 'member' },
        after: { role: 'admin' },
      },
    ]);
    // A change to the role they already hold writes nothing.
    await setMemberRole(t.as(t.owner, 'owner'), { memberId: member, role: 'admin' });
    expect(await auditOf(t.workspaceId)).toHaveLength(1);
  });

  it('writes member.removed for a removal and member.left for leaving, and answers who to forget', async () => {
    const t = await team(['member', 'member']);
    const [gone = '', leaving = ''] = t.ids;
    expect(await removeMember(t.as(t.owner, 'owner'), { memberId: gone })).toEqual({ memberId: gone });
    expect(await leaveWorkspace(t.as(leaving, 'member'))).toEqual({ memberId: leaving });
    expect((await auditOf(t.workspaceId)).map(({ action, target_id }) => ({ action, target_id }))).toEqual([
      { action: 'member.removed', target_id: gone },
      { action: 'member.left', target_id: leaving },
    ]);
    expect(await t.roleOf(leaving)).toEqual({ role: 'member', status: 'removed' });
  });

  it('refuses the only owner leaving, and anyone but a member', async () => {
    const t = await team(['member']);
    expect(await refusalOf(leaveWorkspace(t.as(t.owner, 'owner')))).toEqual(LAST_OWNER);
    expect(await refusalOf(leaveWorkspace(systemScope(db, t.workspaceId)))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await auditOf(t.workspaceId)).toEqual([]);
  });
});

describe('transferring ownership (spec 0031, AC-813)', () => {
  it('makes them an owner and the caller an admin in one step, with one audit row', async () => {
    const t = await team(['admin', 'member']);
    const [admin = '', member = ''] = t.ids;
    await transferOwnership(t.as(t.owner, 'owner'), { memberId: member });
    expect(await t.roleOf(member)).toEqual({ role: 'owner', status: 'active' });
    expect(await t.roleOf(t.owner)).toEqual({ role: 'admin', status: 'active' });
    expect((await auditOf(t.workspaceId)).map(({ action, target_id }) => ({ action, target_id }))).toEqual([
      { action: 'workspace.ownership_transferred', target_id: member },
    ]);
    // Only an owner hands it on, never to themself, and the old owner acts as the admin they are now.
    expect(await refusalOf(transferOwnership(t.as(admin, 'admin'), { memberId: admin }))).toEqual(FORBIDDEN_OWNER);
    expect(await refusalOf(transferOwnership(t.as(member, 'owner'), { memberId: member }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(transferOwnership(t.as(t.owner, 'owner'), { memberId: admin }))).toEqual(FORBIDDEN_OWNER);
    expect(await auditOf(t.workspaceId)).toHaveLength(1);
  });

  it('refuses a removed member as the target, and a member as the caller', async () => {
    const t = await team(['member', 'member']);
    const [gone = '', member = ''] = t.ids;
    await removeMember(t.as(t.owner, 'owner'), { memberId: gone });
    expect(await refusalOf(transferOwnership(t.as(t.owner, 'owner'), { memberId: gone }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await refusalOf(transferOwnership(t.as(member, 'member'), { memberId: t.owner }))).toEqual(FORBIDDEN_OWNER);
    expect(await t.roleOf(t.owner)).toEqual({ role: 'owner', status: 'active' });
  });
});
