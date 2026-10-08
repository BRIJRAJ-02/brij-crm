// The access door (spec 0005, AC-32; spec 0009) against a real Postgres as the app role:
// a member gets a scope for their workspace and nothing else, and every other
// caller gets the same NOT_FOUND, so nothing says whether a workspace exists.
import { randomUUID } from 'node:crypto';
import { PERMISSION_NAMES, ROLE_PERMISSIONS } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { listAttributes } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createUserWorkspace } from '../engine/workspaces.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { enterAsActor, enterWithKey, enterWorkspace, systemScope, type DoorLog, type RuleSource } from './door.ts';
import { mintScope } from './mint.ts';
import { NO_RULES, roleAccess } from './policy.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-door-tests' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-door-tests' });
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

const tag = () => randomUUID().slice(0, 8);

/** A signed up user with their own workspace. */
async function userWithWorkspace() {
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email });
  const created = await createUserWorkspace(db, {
    id: newId(),
    name: 'Acme',
    slug: `acme-${tag()}`,
    firstMember: { userId, name: 'Ada', email },
  });
  return { userId, ...created };
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

describe('the access door', () => {
  it("gives an active member a scope that reads their workspace, and nothing of anyone else's", async () => {
    const a = await userWithWorkspace();
    const b = await userWithWorkspace();
    const scope = await enterWorkspace({ db, identity }, { userId: a.userId, slug: a.workspace.slug });
    expect(scope).toMatchObject({ db, workspaceId: a.workspace.id, actor: { type: 'member', id: a.memberId } });
    // The workspace's creator is its owner, with the owner's permissions and the open policy (spec 0009).
    expect(scope.access.principal).toEqual({
      kind: 'member',
      memberId: a.memberId,
      userId: a.userId,
      role: 'owner',
      teamIds: [],
    });
    expect(scope.access.permissions).toEqual(ROLE_PERMISSIONS.owner);
    expect(scope.access.data.key).toBe('open');

    const seen = await db.withWorkspace(scope.workspaceId, async (tx) => ({
      workspaces: (await tx.execute<{ id: string }>(sql`select id from workspaces`)).rows.map((row) => row.id),
      members: (await tx.execute<{ id: string }>(sql`select id from members`)).rows.map((row) => row.id),
    }));
    expect(seen).toEqual({ workspaces: [a.workspace.id], members: [a.memberId] });
    expect(seen.members).not.toContain(b.memberId);

    // An engine read with the scope sees this workspace's People and not the other's.
    const peopleOf = async (workspaceId: string) =>
      db.withWorkspace(workspaceId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`select id from objects where standard_key = 'people'`);
        return rows.rows[0]?.id ?? '';
      });
    expect((await listAttributes(scope, await peopleOf(a.workspace.id))).length).toBeGreaterThan(0);
    expect(await listAttributes(scope, await peopleOf(b.workspace.id))).toEqual([]);
  });

  it('refuses a non member, a removed member, an unknown address and a deleted workspace all the same way', async () => {
    const a = await userWithWorkspace();
    const b = await userWithWorkspace();
    const removed = await userWithWorkspace();
    await db.withWorkspace(removed.workspace.id, async (tx) => {
      // Another owner stays, so the workspace keeps one (spec 0009, AC-137).
      await tx.execute(
        sql`insert into members (workspace_id, name, email, role, created_by_type, updated_by_type) values (${removed.workspace.id}, 'Keeper', ${`${tag()}@example.com`}, 'owner', 'system', 'system')`,
      );
      await tx.execute(sql`update members set status = 'removed' where id = ${removed.memberId}`);
    });
    const deleted = await userWithWorkspace();
    await db.withWorkspace(deleted.workspace.id, (tx) => tx.execute(sql`update workspaces set deleted_at = now()`));
    const nobody = await createTestUser(identityUrl, { email: `${tag()}@example.com` });

    const attempts = [
      // Workspace B's member asking for workspace A.
      { userId: b.userId, slug: a.workspace.slug },
      // A signed up user in no workspace at all.
      { userId: nobody, slug: a.workspace.slug },
      { userId: removed.userId, slug: removed.workspace.slug },
      { userId: a.userId, slug: `missing-${tag()}` },
      { userId: deleted.userId, slug: deleted.workspace.slug },
      // Not a user id at all.
      { userId: 'not-a-uuid', slug: a.workspace.slug },
      { userId: randomUUID(), slug: a.workspace.slug },
    ];
    const refusals = await Promise.all(attempts.map((input) => refusalOf(enterWorkspace({ db, identity }, input))));
    const expected = [{ code: 'NOT_FOUND', message: "That workspace doesn't exist, or you're not a member of it." }];
    for (const refusal of refusals) expect(refusal).toEqual(expected);
  });
});

/** Adds a signed up user to a workspace as a member with `role` (as #23's invites will). */
async function addMember(workspaceId: string, role: string) {
  const email = `${tag()}@example.com`;
  const userId = await createTestUser(identityUrl, { email });
  const memberId = newId();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, ${userId}, 'Bea', ${email}, ${role}::member_role, 'system', 'system')`,
    ),
  );
  return { userId, memberId };
}

/** A log that keeps what the door reports. */
function recordingLog(): DoorLog & { readonly warnings: { message: string; fields: unknown }[] } {
  const warnings: { message: string; fields: unknown }[] = [];
  return { warnings, warn: (message, fields) => warnings.push({ message, fields }) };
}

const NOT_FOUND = [{ code: 'NOT_FOUND', message: "That workspace doesn't exist, or you're not a member of it." }];

describe('roles at the door (spec 0009)', () => {
  it.each(['admin', 'member'] as const)('lets an %s in with exactly their role’s permissions', async (role) => {
    const a = await userWithWorkspace();
    const other = await addMember(a.workspace.id, role);
    const scope = await enterWorkspace({ db, identity }, { userId: other.userId, slug: a.workspace.slug });
    expect(scope.access.principal).toMatchObject({ kind: 'member', memberId: other.memberId, role });
    expect(scope.access.permissions).toEqual(ROLE_PERMISSIONS[role]);
  });

  it('refuses a role the code does not know like a non member, and reports the member id only', async () => {
    // A value a later migration might add before this code knows it.
    await testQuery(ownerUrl, "alter type member_role add value if not exists 'visitor'");
    const a = await userWithWorkspace();
    const visitor = await addMember(a.workspace.id, 'visitor');
    const log = recordingLog();
    expect(
      await refusalOf(enterWorkspace({ db, identity, log }, { userId: visitor.userId, slug: a.workspace.slug })),
    ).toEqual(NOT_FOUND);
    expect(log.warnings).toEqual([
      { message: 'Refused a member whose role the code does not know', fields: { memberId: visitor.memberId } },
    ]);
    const actor = { type: 'member', id: visitor.memberId } as const;
    expect(await refusalOf(enterAsActor({ db, log }, { workspaceId: a.workspace.id, actor }))).toEqual(NOT_FOUND);
  });
});

describe('enterAsActor (AC-147)', () => {
  it('enters a member again with their current role', async () => {
    const a = await userWithWorkspace();
    const other = await addMember(a.workspace.id, 'admin');
    const actor = { type: 'member', id: other.memberId } as const;
    const first = await enterAsActor({ db }, { workspaceId: a.workspace.id, actor });
    expect(first.access.principal).toMatchObject({ role: 'admin', memberId: other.memberId, userId: other.userId });
    expect(first.actor).toEqual(actor);
    await db.withWorkspace(a.workspace.id, (tx) =>
      tx.execute(sql`update members set role = 'member' where id = ${other.memberId}`),
    );
    const demoted = await enterAsActor({ db }, { workspaceId: a.workspace.id, actor });
    expect(demoted.access.permissions).toEqual(ROLE_PERMISSIONS.member);
  });

  it('refuses a member removed since, a deleted workspace, another workspace’s member and any non member', async () => {
    const a = await userWithWorkspace();
    const b = await userWithWorkspace();
    const removed = await addMember(a.workspace.id, 'member');
    await db.withWorkspace(a.workspace.id, (tx) =>
      tx.execute(sql`update members set status = 'removed' where id = ${removed.memberId}`),
    );
    const deleted = await userWithWorkspace();
    await db.withWorkspace(deleted.workspace.id, (tx) => tx.execute(sql`update workspaces set deleted_at = now()`));
    const attempts = [
      { workspaceId: a.workspace.id, actor: { type: 'member', id: removed.memberId } },
      { workspaceId: deleted.workspace.id, actor: { type: 'member', id: deleted.memberId } },
      { workspaceId: a.workspace.id, actor: { type: 'member', id: b.memberId } },
      { workspaceId: a.workspace.id, actor: SYSTEM_ACTOR },
      { workspaceId: a.workspace.id, actor: { type: 'api_key', id: newId() } },
      { workspaceId: 'not-a-uuid', actor: { type: 'member', id: a.memberId } },
    ] as const;
    for (const input of attempts) expect(await refusalOf(enterAsActor({ db }, input))).toEqual(NOT_FOUND);
  });
});

describe('rules at the door (spec 0009, milestone 2)', () => {
  it('reads the rules through its RuleSource inside its one tenant transaction, for the member it lets in', async () => {
    const a = await userWithWorkspace();
    const deals = newId();
    const seen: { memberId: string; role: string; workspace: string | undefined }[] = [];
    const rules: RuleSource = async (tx, member) => {
      const setting = await tx.execute<{ id: string }>(sql`select current_setting('app.workspace_id', true) as id`);
      seen.push({ ...member, workspace: setting.rows[0]?.id });
      return {
        levels: [
          {
            subject: { type: 'role', role: 'owner' },
            target: { type: 'object', objectId: deals },
            level: 'read',
          },
        ],
        records: [],
      };
    };
    const scope = await enterWorkspace({ db, identity, rules }, { userId: a.userId, slug: a.workspace.slug });
    expect(seen).toEqual([{ memberId: a.memberId, role: 'owner', workspace: a.workspace.id }]);
    expect(scope.access.data.objects).toEqual({ [deals]: 'read' });
    expect(scope.access.data.key).not.toBe('open');
    const again = await enterAsActor(
      { db, rules },
      { workspaceId: a.workspace.id, actor: { type: 'member', id: a.memberId } },
    );
    expect(again.access.data.key).toBe(scope.access.data.key);
    // With no source, nothing restricts: production's door until #24.
    const open = await enterWorkspace({ db, identity }, { userId: a.userId, slug: a.workspace.slug });
    expect(open.access.data.key).toBe('open');
  });

  it('asks the source nothing for a member it refuses', async () => {
    const a = await userWithWorkspace();
    let asked = 0;
    const rules: RuleSource = () => {
      asked += 1;
      return Promise.resolve(NO_RULES);
    };
    await refusalOf(enterWorkspace({ db, identity, rules }, { userId: randomUUID(), slug: a.workspace.slug }));
    expect(asked).toBe(0);
  });
});

describe('systemScope and enterWithKey', () => {
  it('gives the system every permission and the open policy', async () => {
    const a = await userWithWorkspace();
    const scope = systemScope(db, a.workspace.id);
    expect(scope.actor).toEqual(SYSTEM_ACTOR);
    expect(scope.access.permissions).toEqual(PERMISSION_NAMES);
    expect(scope.access.data.key).toBe('open');
  });

  it('refuses every key until #34 stores them', async () => {
    const a = await userWithWorkspace();
    expect(await refusalOf(enterWithKey({ db }, { workspaceId: a.workspace.id, keyId: newId() }))).toEqual(NOT_FOUND);
  });
});

describe('the door’s cost (AC-149)', () => {
  const p95 = (samples: readonly number[]) =>
    [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)] ?? 0;

  it('adds well under 5 ms p95 a request: the role rides the one member read, the access and seal are pure', async () => {
    const a = await userWithWorkspace();
    // What this spec added to each request, timed alone: the policy and the seal.
    const added: number[] = [];
    for (let run = 0; run < 2_000; run += 1) {
      const started = performance.now();
      const access = roleAccess({ kind: 'member', memberId: a.memberId, role: 'admin', teamIds: [] });
      mintScope({ db, workspaceId: a.workspace.id, actor: { type: 'member', id: a.memberId }, access });
      added.push(performance.now() - started);
    }
    // The whole door, for the record: one directory read and one tenant round trip, as before.
    const whole: number[] = [];
    for (let run = 0; run < 50; run += 1) {
      const started = performance.now();
      await enterWorkspace({ db, identity }, { userId: a.userId, slug: a.workspace.slug });
      whole.push(performance.now() - started);
    }
    console.warn(
      `door p95: added ${p95(added).toFixed(3)} ms (policy and seal), whole ${p95(whole).toFixed(1)} ms (two reads)`,
    );
    expect(p95(added)).toBeLessThan(5);
  });
});
