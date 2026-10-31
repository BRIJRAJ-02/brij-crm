// Custom roles (spec 0037, job J9), against a real Postgres as the app role: who may make and change them, the name
// and catalog rules, the 20 role cap, a save's audit and `access` rows, the door reading a holder's role in their own
// statement (only grant `any` permissions, Read only data access, Member's rules not applying), `enterAsActor` and
// the audiences seeing the role as it is now, a delete moving holders and invitations, holding a role, and nothing
// crossing from one workspace to another.
import { sql } from 'drizzle-orm';
import type { Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { audiences } from '../access/audiences.ts';
import { enterAsActor, systemScope } from '../access/door.ts';
import { objectLevel } from '../access/policy.ts';
import { storedRules } from '../access/stored-rules.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { outboxHook } from '../engine/outbox.ts';
import { getMyAccess, setMemberRole, setMemberRoles } from '../members/members.ts';
import { testScope } from '../testing.ts';
import {
  copyName,
  createRole,
  deleteRole,
  duplicateRole,
  getRole,
  listRoles,
  roleOverview,
  setDefaultRole,
  updateRole,
} from './roles.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-roles-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace: Olga the owner, and people to give roles to. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Roles',
    slug: `roles-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Olga Owner', email: 'olga@example.com' },
  });
  const { workspaceId } = created;
  const as = (id: string, role: Role = 'member') => testScope({ db, workspaceId, actor: { type: 'member', id }, role });
  const owner = as(created.memberId, 'owner');
  const add = async (name: string, role: Role = 'member') => {
    const id = newId();
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, ${role}, 'system', 'system')`,
      ),
    );
    return id;
  };
  /** The scope the door gives a member as they stand now (their role and custom role, read in their statement). */
  const entered = (memberId: string) =>
    enterAsActor({ db, rules: storedRules }, { workspaceId, actor: { type: 'member', id: memberId } });
  const make = (name: string, permissions: readonly string[] = [], dataAccess: 'write' | 'read' = 'write') =>
    createRole(owner, { id: newId(), name, permissions, dataAccess, startFrom: 'member' }, [outboxHook()]);
  const audit = (action: string) =>
    testQuery<{ target_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> }>(
      ownerUrl,
      `select target_id, before, after from audit_events where workspace_id = $1 and action = $2 order by at, id`,
      [workspaceId, action],
    );
  const outbox = (kind: string) =>
    testQuery<{ item_ids: string[] | null }>(
      ownerUrl,
      `select item_ids::text[] as item_ids from outbox where workspace_id = $1 and kind = $2 order by seq`,
      [workspaceId, kind],
    );
  return { ...created, as, owner, add, entered, make, audit, outbox };
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

describe('making roles (AC-1228)', () => {
  it('is for access.manage alone; every member reads the roles, a guest their names only', async () => {
    const w = await world();
    const member = await w.add('Max Member');
    const guest = await w.add('Gia Guest', 'guest');
    expect(
      await refusalOf(
        createRole(w.as(member), {
          id: newId(),
          name: 'Doctor',
          permissions: [],
          dataAccess: 'write',
          startFrom: 'member',
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    const role = await w.make('Doctor', ['booking.manage']);
    const listed = await listRoles(w.as(member));
    expect(listed.roles.map((each) => each.label)).toEqual(['Owner', 'Admin', 'Member', 'Guest', 'Doctor']);
    expect(listed.defaultRole).toBe('member');
    const full = await roleOverview(w.as(member));
    expect(full.roles.find((each) => each.id === role.id)).toMatchObject({
      permissions: ['booking.manage'],
      holders: 0,
      dataAccess: 'write',
    });
    const named = await roleOverview(w.as(guest, 'guest'));
    expect(named.roles.find((each) => each.id === role.id)).toMatchObject({ label: 'Doctor', permissions: [] });
    expect(named.roles.every((each) => each.holders === undefined)).toBe(true);
    expect((await getRole(w.as(member), { roleId: role.id })).label).toBe('Doctor');
  });

  it('refuses built in names, a taken name, and permissions only built in roles hold, naming them', async () => {
    const w = await world();
    await w.make('Sales lead');
    expect(await refusalOf(w.make('admin'))).toMatchObject({ code: 'ROLE_NAME_RESERVED' });
    expect(await refusalOf(w.make('Guest'))).toMatchObject({ code: 'ROLE_NAME_RESERVED' });
    expect(await refusalOf(w.make('sales LEAD'))).toMatchObject({ code: 'NAME_TAKEN' });
    expect(await refusalOf(w.make('Inviter', ['members.invite']))).toEqual({
      code: 'PERMISSION_NOT_ALLOWED',
      message: "Custom roles can't hold Invite people. Only built in roles can.",
      field: 'permissions',
    });
    expect(await refusalOf(w.make('Router', ['routing.manage']))).toMatchObject({ code: 'PERMISSION_NOT_ALLOWED' });
    expect(await refusalOf(w.make('Biller', ['billing.manage']))).toMatchObject({ code: 'PERMISSION_NOT_ALLOWED' });
    await expect(w.make('Ghost', ['nothing.real'])).rejects.toThrow('Pick permissions from the list.');
  });

  it('holds 20 custom roles at most, a copy counting too, and a retried create makes one', async () => {
    const w = await world();
    const id = newId();
    const input = { id, name: 'Role 0', permissions: [], dataAccess: 'write' as const, startFrom: 'member' as const };
    await createRole(w.owner, input);
    await createRole(w.owner, input);
    for (let n = 1; n < 20; n += 1) await w.make(`Role ${String(n)}`);
    expect((await listRoles(w.owner)).roles).toHaveLength(24);
    expect(await refusalOf(w.make('Role 21'))).toEqual({
      code: 'ROLE_LIMIT',
      message: 'A workspace can have at most 20 custom roles.',
    });
    expect(await refusalOf(duplicateRole(w.owner, { roleId: id, id: newId() }))).toMatchObject({ code: 'ROLE_LIMIT' });
  });

  it('copies a role as "<name> copy", then " copy 2"', async () => {
    const w = await world();
    const role = await w.make('Doctor', ['booking.manage', 'schedule.view']);
    const first = await duplicateRole(w.owner, { roleId: role.id, id: newId() });
    const second = await duplicateRole(w.owner, { roleId: role.id, id: newId() });
    expect([first.label, second.label]).toEqual(['Doctor copy', 'Doctor copy 2']);
    expect(first.permissions).toEqual(['booking.manage', 'schedule.view']);
    expect(copyName('x'.repeat(40), new Set()).length).toBeLessThanOrEqual(40);
  });
});

describe('holding a role (AC-1233 to AC-1235)', () => {
  it('lets the door read the role in the holder’s statement: only grant any permissions hold', async () => {
    const w = await world();
    const priya = await w.add('Priya Rao');
    const role = await w.make('Receptionist', ['schedule.manage', 'booking.manage']);
    await setMemberRole(w.owner, { memberId: priya, customRoleId: role.id }, [outboxHook()]);
    // Stored by hand: an admin grant and a name the code doesn't know, which grant nothing (AC-1234, AC-1248).
    await testQuery(
      ownerUrl,
      `update workspace_roles set permissions = permissions || '{members.manage,made.up}' where id = $1`,
      [role.id],
    );
    const scope = await w.entered(priya);
    expect(scope.access.principal).toMatchObject({ kind: 'member', role: 'member', customRoleId: role.id });
    expect([...scope.access.permissions].sort()).toEqual(['booking.manage', 'schedule.manage']);
    const mine = await getMyAccess(scope);
    expect(mine).toMatchObject({ role: 'member', roleLabel: 'Receptionist', customRoleId: role.id });
    expect(mine.scheduling).toMatchObject({ managesEveryone: true });
    // They can't change roles: the stored members.manage is nothing.
    const other = await w.add('Bea');
    expect(await refusalOf(setMemberRole(scope, { memberId: other, role: 'admin' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('gives a Read only role read on every object, and keeps Member’s rules off its holders', async () => {
    const w = await world();
    const vera = await w.add('Vera Viewer');
    const max = await w.add('Max Member');
    const viewer = await w.make('Viewer', [], 'read');
    await setMemberRole(w.owner, { memberId: vera, customRoleId: viewer.id });
    const people = await testQuery<{ id: string }>(
      ownerUrl,
      `select id::text from objects where workspace_id = $1 and api_slug = 'people'`,
      [w.workspaceId],
    );
    const peopleId = people[0]?.id ?? '';
    // Member's rule takes People away from Members; it doesn't reach a custom role holder.
    await testQuery(
      ownerUrl,
      `insert into access_rules (workspace_id, subject_type, subject_role, object_id, level, created_by_type, updated_by_type)
       values ($1, 'role', 'member', $2, 'none', 'system', 'system')`,
      [w.workspaceId, peopleId],
    );
    const veraScope = await w.entered(vera);
    expect(veraScope.access.data.defaultObject).toBe('read');
    expect(objectLevel(veraScope.access, peopleId)).toBe('read');
    expect(objectLevel((await w.entered(max)).access, peopleId)).toBe('none');
  });

  it('moves a guest into a custom role and several people at once, one audit row each', async () => {
    const w = await world();
    const gia = await w.add('Gia', 'guest');
    const sam = await w.add('Sam');
    const role = await w.make('Doctor', ['booking.manage']);
    const done = await setMemberRoles(w.owner, { memberIds: [gia, sam], customRoleId: role.id }, [outboxHook()]);
    expect(done.changed).toBe(2);
    const rows = await testQuery<{ role: string; custom_role_id: string }>(
      ownerUrl,
      `select role::text, custom_role_id::text from members where id = any($1::uuid[]) order by id`,
      [[gia, sam]],
    );
    expect(rows.every((row) => row.role === 'member' && row.custom_role_id === role.id)).toBe(true);
    const changed = await w.audit('member.role_changed');
    expect(changed.map((row) => row.after)).toEqual([
      { role: 'member', customRoleId: role.id, customRoleName: 'Doctor' },
      { role: 'member', customRoleId: role.id, customRoleName: 'Doctor' },
    ]);
    // Back to a built in role clears it in the same update (AC-1233).
    await setMemberRole(w.owner, { memberId: sam, role: 'admin' });
    const [back] = await testQuery<{ custom_role_id: string | null }>(
      ownerUrl,
      `select custom_role_id::text from members where id = $1`,
      [sam],
    );
    expect(back?.custom_role_id).toBeNull();
    // A role that doesn't exist is absent.
    expect(await refusalOf(setMemberRole(w.owner, { memberId: sam, customRoleId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('saving a role (AC-1231)', () => {
  it('writes one audit row with what it added and removed, and one access row naming its holders', async () => {
    const w = await world();
    const priya = await w.add('Priya');
    const role = await w.make('Sales lead', ['booking.manage']);
    await setMemberRole(w.owner, { memberId: priya, customRoleId: role.id });
    const saved = await updateRole(
      w.owner,
      { roleId: role.id, permissions: ['schedule.view.team', 'forms.manage'], updatedAt: role.updatedAt ?? '' },
      [outboxHook()],
    );
    expect(saved.affectedMembers).toBe(1);
    expect(saved.role.permissions).toEqual(['forms.manage', 'schedule.view.team']);
    const [row] = await w.audit('role.updated');
    expect(row?.after).toMatchObject({ added: ['forms.manage', 'schedule.view.team'], removed: ['booking.manage'] });
    expect((await w.outbox('access')).at(-1)?.item_ids).toEqual([priya]);
    // The next save from the old version is stale; enterAsActor sees the role as it is now (AC-1421).
    expect(
      await refusalOf(updateRole(w.owner, { roleId: role.id, name: 'Leads', updatedAt: role.updatedAt ?? '' })),
    ).toMatchObject({ code: 'STALE' });
    expect([...(await w.entered(priya)).access.permissions].sort()).toEqual(['forms.manage', 'schedule.view.team']);
  });
});

describe('deleting a role (AC-1238) and the default (AC-1237)', () => {
  it('moves its people and open invitations, falls the default back to Member, and audits it', async () => {
    const w = await world();
    const a = await w.add('A');
    const b = await w.add('B');
    const doctor = await w.make('Doctor', ['booking.manage']);
    const nurse = await w.make('Nurse');
    await setMemberRoles(w.owner, { memberIds: [a, b], customRoleId: doctor.id });
    await setDefaultRole(w.owner, { roleId: doctor.id });
    expect((await listRoles(w.owner)).defaultRole).toBe(doctor.id);
    await testQuery(
      ownerUrl,
      `insert into invitations (workspace_id, kind, email, role, custom_role_id, token_hash, max_uses, expires_at, created_by_type, updated_by_type)
       values ($1, 'email', 'new@example.com', 'member', $2, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), 1, now() + interval '7 days', 'system', 'system')`,
      [w.workspaceId, doctor.id],
    );
    expect(await refusalOf(deleteRole(w.owner, { roleId: doctor.id, moveTo: doctor.id }))).toMatchObject({
      code: 'MOVE_TO_INVALID',
    });
    const done = await deleteRole(w.owner, { roleId: doctor.id, moveTo: nurse.id }, [outboxHook()]);
    expect(done.moved).toBe(2);
    const held = await testQuery<{ n: number }>(
      ownerUrl,
      `select count(*)::int as n from members where workspace_id = $1 and custom_role_id = $2`,
      [w.workspaceId, nurse.id],
    );
    expect(held[0]?.n).toBe(2);
    const invited = await testQuery<{ custom_role_id: string }>(
      ownerUrl,
      `select custom_role_id::text from invitations where workspace_id = $1`,
      [w.workspaceId],
    );
    expect(invited[0]?.custom_role_id).toBe(nurse.id);
    expect((await listRoles(w.owner)).defaultRole).toBe('member');
    expect((await w.audit('role.deleted'))[0]?.after).toMatchObject({ moved: 2, moveTo: nurse.id });
    expect([...((await w.outbox('access')).at(-1)?.item_ids ?? [])].sort()).toEqual([a, b].sort());
  });
});

describe('audiences (AC-1247)', () => {
  it('reads each holder’s custom role in its one query: their permissions, and their own policy', async () => {
    const w = await world();
    const priya = await w.add('Priya');
    const vera = await w.add('Vera');
    const forms = await w.make('Forms', ['forms.manage']);
    const viewer = await w.make('Viewer', [], 'read');
    await setMemberRole(w.owner, { memberId: priya, customRoleId: forms.id });
    await setMemberRole(w.owner, { memberId: vera, customRoleId: viewer.id });
    const groups = await audiences(systemScope(db, w.workspaceId));
    const of = (memberId: string) => groups.find((group) => group.members.some((each) => each.memberId === memberId));
    expect(of(priya)?.members.find((each) => each.memberId === priya)?.permissions).toEqual(['forms.manage']);
    expect(of(priya)?.key).toBe('open');
    expect(of(vera)?.key).not.toBe('open');
  });
});

describe('tenancy', () => {
  it('never reads or changes another workspace’s roles', async () => {
    const one = await world();
    const two = await world();
    const role = await one.make('Doctor');
    expect(await refusalOf(getRole(two.owner, { roleId: role.id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await refusalOf(updateRole(two.owner, { roleId: role.id, name: 'Mine', updatedAt: role.updatedAt ?? '' })),
    ).toMatchObject({ code: 'NOT_FOUND' });
    const there = await two.add('Tom');
    expect(await refusalOf(setMemberRole(two.owner, { memberId: there, customRoleId: role.id }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await listRoles(two.owner)).roles).toHaveLength(4);
  });
});
