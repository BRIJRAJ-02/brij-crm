// The owner rules (spec 0009, AC-137), against a real Postgres as the app
// role: who may change whose role or remove whom, self changes within the
// rules, and the last owner kept by the service and, at commit, the database.
import { sql } from 'drizzle-orm';
import { LAST_OWNER_MESSAGE, OWNER_RULES_MESSAGE, PERMISSIONS, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { enterAsActor, systemScope } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { getMyAccess, listMembers, removeMember, setMemberRole } from './members.ts';

const { appUrl } = inject('testDatabase');
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
      await refusalOf(enterAsActor({ db }, { workspaceId: t.workspaceId, actor: { type: 'member', id: member } })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    expect((await listMembers(t.as(t.owner, 'owner'))).map((each) => each.id)).not.toContain(member);
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
    expect(getMyAccess(t.as(t.ids[0] ?? '', 'member'))).toEqual({
      role: 'member',
      roleLabel: 'Member',
      permissions: ['records.export'],
    });
    expect(getMyAccess(t.as(t.owner, 'owner'))).toMatchObject({ role: 'owner', roleLabel: 'Owner' });
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
    expect(isRefusal(failed?.reason) ? failed.reason.refusal : failed?.reason).toEqual(LAST_OWNER);
    const roles = await Promise.all([t.roleOf(t.owner), t.roleOf(second)]);
    expect(roles.filter((row) => row?.role === 'owner')).toHaveLength(1);
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
    expect(await refusalOf(setMemberRole(owner, { memberId: t.owner, role: 'guest' as Role }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});
