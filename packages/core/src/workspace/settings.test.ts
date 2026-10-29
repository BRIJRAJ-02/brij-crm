// Workspace › General and Account › Profile (spec 0031, slice 7, AC-821 to
// AC-823, AC-830), against a real Postgres as the app role: who may change
// what, the audit row each change writes, the soft delete the door honours,
// and the owner's restore within the window.
import { sql } from 'drizzle-orm';
import { myPicturePath, PERMISSIONS, type Role } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { enterAsActor, enterDeletedWorkspace, NO_RULE_SOURCE } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createUserWorkspace } from '../engine/workspaces.ts';
import { createForm } from '../forms/forms.ts';
import { purgeWorkspace } from './purge.ts';
import { getMyProfile, updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { deleteWorkspace, getWorkspaceSettings, restoreWorkspace, updateWorkspace } from './settings.ts';

const { appUrl, identityUrl, ownerUrl, workerUrl } = inject('testDatabase');
let db: Database;
let worker: Database;
let identity: IdentityStore;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-settings-tests' });
  worker = createDatabase({ url: workerUrl, applicationName: 'crm-settings-tests-worker' });
  identity = createIdentityStore({ url: identityUrl, applicationName: 'crm-settings-tests-identity' });
});
afterAll(async () => {
  await db.close();
  await worker.close();
  await identity.close();
});

const tag = () => newId().slice(-12);

/** A workspace whose owner (a signed in user) is joined by one member of each role given, each a real account. */
async function team(roles: readonly Role[] = ['member']) {
  const slug = `general-${tag()}`;
  const ownerUser = await createTestUser(identityUrl, { email: `ada-${tag()}@example.com`, name: 'Ada' });
  const created = await createUserWorkspace(db, {
    id: newId(),
    name: 'Acme',
    slug,
    firstMember: { userId: ownerUser, name: 'Ada', email: 'ada@example.com' },
  });
  const workspaceId = created.workspace.id;
  const ids = roles.map(() => newId());
  const users: string[] = [];
  for (const [index] of roles.entries()) {
    users.push(await createTestUser(identityUrl, { email: `m${String(index)}-${tag()}@example.com`, name: 'M' }));
  }
  await db.withWorkspace(workspaceId, async (tx) => {
    for (const [index, role] of roles.entries()) {
      await tx.execute(
        sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
            values (${workspaceId}, ${ids[index] ?? ''}, ${users[index] ?? ''}, ${`M${String(index)}`},
                    ${`m${String(index)}-${slug}@example.com`}, ${role}, 'system', 'system')`,
      );
    }
  });
  const as = (memberId: string, role: Role) =>
    testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role });
  const doorDeps = {
    db,
    rules: NO_RULE_SOURCE,
    identity: {
      findWorkspace: (wanted: string) =>
        Promise.resolve(wanted === slug ? { id: workspaceId, slug, name: 'Acme' } : undefined),
    },
  };
  return { workspaceId, owner: created.memberId, slug, ownerUser, ids, users, as, doorDeps };
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

async function auditOf(workspaceId: string) {
  return testQuery<{ action: string; target_id: string; before: unknown; after: unknown; actor_member_id: string }>(
    ownerUrl,
    'select action, target_id, before, after, actor_member_id::text from audit_events where workspace_id = $1 order by at, id',
    [workspaceId],
  );
}

describe('Account › Profile (AC-821)', () => {
  it('answers the caller’s own profile, with the workspace’s time zone and only our own or an https picture', async () => {
    const t = await team();
    // The account's picture as our own origin serves it: the api builds the path from the session (23 Oct 2026).
    const served = myPicturePath('0123456789ab');
    const profile = await getMyProfile(t.as(t.owner, 'owner'), { image: served });
    expect(profile).toEqual({
      memberId: t.owner,
      name: 'Ada',
      email: 'ada@example.com',
      workspaceTimeZone: 'UTC',
      // The workspace the page belongs to, since a link page is one membership's now (spec 0056).
      workspaceName: 'Acme',
      image: served,
      // A member with no identity has no handle, and no suggestion for one.
      bio: '',
    });
    // Without one, the member's own stored picture, and only an https one.
    const store = (url: string) =>
      db.withWorkspace(t.workspaceId, (tx) =>
        tx.execute(sql`update members set avatar_url = ${url} where id = ${t.owner}`),
      );
    await store('javascript:alert(1)');
    expect((await getMyProfile(t.as(t.owner, 'owner'), {})).image).toBeUndefined();
    await store('https://lh3.example.com/a.png');
    expect((await getMyProfile(t.as(t.owner, 'owner'), {})).image).toBe('https://lh3.example.com/a.png');
  });

  it('changes the name and time zone, writes one audit row of the changed fields, and nothing for no change', async () => {
    const t = await team();
    const scope = t.as(t.owner, 'owner');
    const updated = await updateMyMemberProfile(scope, { name: '  Ada King ', timeZone: 'Europe/Berlin' });
    expect(updated).toMatchObject({ name: 'Ada King', timeZone: 'Europe/Berlin' });
    await updateMyMemberProfile(scope, { name: 'Ada King' });
    const back = await updateMyMemberProfile(scope, { timeZone: null });
    expect(back.timeZone).toBeUndefined();
    expect(await auditOf(t.workspaceId)).toEqual([
      {
        action: 'member.profile_updated',
        target_id: t.owner,
        before: { name: 'Ada', timeZone: null },
        after: { name: 'Ada King', timeZone: 'Europe/Berlin' },
        actor_member_id: t.owner,
      },
      {
        action: 'member.profile_updated',
        target_id: t.owner,
        before: { timeZone: 'Europe/Berlin' },
        after: { timeZone: null },
        actor_member_id: t.owner,
      },
    ]);
  });

  it('changes only the caller’s own row', async () => {
    const t = await team(['member']);
    const memberId = t.ids[0] ?? '';
    await updateMyMemberProfile(t.as(memberId, 'member'), { name: 'Bea' });
    expect((await getMyProfile(t.as(t.owner, 'owner'))).name).toBe('Ada');
    expect((await getMyProfile(t.as(memberId, 'member'))).name).toBe('Bea');
  });

  it('refuses a name over 80 characters', async () => {
    const t = await team();
    expect(await refusalOf(updateMyMemberProfile(t.as(t.owner, 'owner'), { name: 'x'.repeat(81) }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });
});

describe('Workspace › General (AC-822)', () => {
  it('lets every member read the settings, and only workspace.manage change them', async () => {
    const t = await team(['member', 'admin']);
    expect(await getWorkspaceSettings(t.as(t.ids[0] ?? '', 'member'))).toEqual({
      id: t.workspaceId,
      name: 'Acme',
      slug: t.slug,
      timeZone: 'UTC',
    });
    expect(await refusalOf(updateWorkspace(t.as(t.ids[0] ?? '', 'member'), { name: 'Nope' }))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS['workspace.manage'].message,
    });
    const renamed = await updateWorkspace(t.as(t.ids[1] ?? '', 'admin'), { name: 'Acme Ltd', timeZone: 'Asia/Tokyo' });
    expect(renamed).toEqual({
      renamed: true,
      settings: { id: t.workspaceId, name: 'Acme Ltd', slug: t.slug, timeZone: 'Asia/Tokyo' },
    });
    expect((await updateWorkspace(t.as(t.owner, 'owner'), { name: 'Acme Ltd' })).renamed).toBe(false);
    expect(await auditOf(t.workspaceId)).toEqual([
      {
        action: 'workspace.updated',
        target_id: t.workspaceId,
        before: { name: 'Acme', timeZone: 'UTC' },
        after: { name: 'Acme Ltd', timeZone: 'Asia/Tokyo' },
        actor_member_id: t.ids[1],
      },
    ]);
  });
});

describe('Workspace › General: the web address', () => {
  it('moves it for owners and admins, with one audit row, and the old address still finds the workspace', async () => {
    const t = await team(['member', 'admin']);
    const moved = `moved-${tag()}`;
    expect(await refusalOf(updateWorkspace(t.as(t.ids[0] ?? '', 'member'), { slug: moved }))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS['workspace.manage'].message,
    });
    const updated = await updateWorkspace(t.as(t.ids[1] ?? '', 'admin'), { slug: moved });
    expect(updated.settings).toMatchObject({ id: t.workspaceId, slug: moved, name: 'Acme' });
    expect(updated.renamed).toBe(false);
    expect(await getWorkspaceSettings(t.as(t.owner, 'owner'))).toMatchObject({ slug: moved });
    expect(await auditOf(t.workspaceId)).toEqual([
      {
        action: 'workspace.updated',
        target_id: t.workspaceId,
        before: { slug: t.slug },
        after: { slug: moved },
        actor_member_id: t.ids[1],
      },
    ]);
    // Both addresses find it, each answering the one it has now; neither is free for anyone else.
    const wanted = { id: t.workspaceId, slug: moved, name: 'Acme' };
    expect(await identity.findWorkspace(moved)).toEqual(wanted);
    expect(await identity.findWorkspace(t.slug)).toEqual(wanted);
    // The same address again writes nothing.
    expect((await updateWorkspace(t.as(t.owner, 'owner'), { slug: moved })).settings.slug).toBe(moved);
    expect(await auditOf(t.workspaceId)).toHaveLength(1);
  });

  it('refuses an address that breaks the rule before anything is written', async () => {
    const t = await team();
    for (const slug of ['ab', 'Upper-Case', 'two--dashes', '-edge', 'a'.repeat(41)]) {
      expect(await refusalOf(updateWorkspace(t.as(t.owner, 'owner'), { slug }))).toMatchObject({
        code: 'CONFIG_INVALID',
        field: 'slug',
      });
    }
    expect(await getWorkspaceSettings(t.as(t.owner, 'owner'))).toMatchObject({ slug: t.slug });
    expect(await auditOf(t.workspaceId)).toEqual([]);
  });

  it('refuses SLUG_TAKEN for another workspace’s address, now or before, and lets it take back its own', async () => {
    const a = await team();
    const b = await team();
    const later = `later-${tag()}`;
    await updateWorkspace(b.as(b.owner, 'owner'), { slug: later });
    // B's current address, and the one it left: both stay B's.
    for (const slug of [later, b.slug]) {
      expect(await refusalOf(updateWorkspace(a.as(a.owner, 'owner'), { slug }))).toEqual({
        code: 'SLUG_TAKEN',
        message: 'That address is taken. Try another.',
        field: 'slug',
      });
    }
    expect(await getWorkspaceSettings(a.as(a.owner, 'owner'))).toMatchObject({ slug: a.slug });
    expect(await identity.findWorkspace(b.slug)).toMatchObject({ id: b.workspaceId, slug: later });
    // A new workspace can't take B's old address either.
    const user = await createTestUser(identityUrl, { email: `new-${tag()}@example.com`, name: 'New' });
    expect(
      await refusalOf(
        createUserWorkspace(db, {
          id: newId(),
          name: 'Copycat',
          slug: b.slug,
          firstMember: { userId: user, name: 'New', email: 'new@example.com' },
        }),
      ),
    ).toMatchObject({ code: 'SLUG_TAKEN' });
    // B may go back to the address it left.
    const back = await updateWorkspace(b.as(b.owner, 'owner'), { slug: b.slug });
    expect(back.settings.slug).toBe(b.slug);
    expect(await identity.findWorkspace(later)).toMatchObject({ id: b.workspaceId, slug: b.slug });
  });
});

describe('Workspace › General: how many addresses a workspace keeps', () => {
  it('refuses a 21st address LIMIT_REACHED, and still lets it go back to one it held', async () => {
    const t = await team();
    const scope = t.as(t.owner, 'owner');
    const held = Array.from({ length: 19 }, (_, index) => `held-${String(index)}-${tag()}`);
    for (const slug of held) await updateWorkspace(scope, { slug });
    expect(await refusalOf(updateWorkspace(scope, { slug: `one-more-${tag()}` }))).toMatchObject({
      code: 'LIMIT_REACHED',
      field: 'slug',
    });
    expect((await updateWorkspace(scope, { slug: t.slug })).settings.slug).toBe(t.slug);
  });
});

describe('deleting and restoring (AC-823)', () => {
  it('is owners only, and needs the name typed exactly', async () => {
    const t = await team(['admin']);
    expect(await refusalOf(deleteWorkspace(t.as(t.ids[0] ?? '', 'admin'), { confirmName: 'Acme' }))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS['workspace.delete'].message,
    });
    for (const typed of ['acme', t.slug, '']) {
      expect(await refusalOf(deleteWorkspace(t.as(t.owner, 'owner'), { confirmName: typed }))).toMatchObject({
        code: 'CONFIRM_MISMATCH',
        field: 'confirmName',
      });
    }
    expect(await getWorkspaceSettings(t.as(t.owner, 'owner'))).toMatchObject({ name: 'Acme' });
  });

  it('takes the name as a keyboard types it: straight quotes and extra spaces', async () => {
    const t = await team();
    await testQuery(ownerUrl, `update workspaces set name = 'Ada’s  workspace' where id = $1`, [t.workspaceId]);
    expect(await refusalOf(deleteWorkspace(t.as(t.owner, 'owner'), { confirmName: "ada's workspace" }))).toMatchObject({
      code: 'CONFIRM_MISMATCH',
    });
    await expect(deleteWorkspace(t.as(t.owner, 'owner'), { confirmName: " Ada's workspace " })).resolves.toMatchObject({
      deleted: { name: 'Ada’s  workspace' },
    });
  });

  it('shuts every member out, tells who to email, and lets only an owner restore it within the window', async () => {
    const t = await team(['member']);
    const memberId = t.ids[0] ?? '';
    const deletion = await deleteWorkspace(t.as(t.owner, 'owner'), { confirmName: ' Acme ' });
    expect(deletion.deleted).toMatchObject({ name: 'Acme', slug: t.slug });
    const days = (Date.parse(deletion.deleted.purgeAfter) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(deletion.deletedBy).toBe('Ada');
    expect(deletion.notify.map((person) => person.isOwner).sort()).toEqual([false, true]);
    // The door refuses everyone, as for an unknown address.
    for (const id of [t.owner, memberId]) {
      expect(
        await refusalOf(
          enterAsActor({ db, rules: NO_RULE_SOURCE }, { workspaceId: t.workspaceId, actor: { type: 'member', id } }),
        ),
      ).toMatchObject({ code: 'NOT_FOUND' });
    }
    // Only the owner finds it deleted; the member and a stranger get NOT_FOUND.
    for (const userId of [t.users[0] ?? '', newId()]) {
      expect(await refusalOf(enterDeletedWorkspace(t.doorDeps, { userId, slug: t.slug }))).toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    const entry = await enterDeletedWorkspace(t.doorDeps, { userId: t.ownerUser, slug: t.slug });
    expect(entry.purgeAfter).toBe(deletion.deleted.purgeAfter);
    const restored = await restoreWorkspace(entry.scope);
    expect(restored.settings.name).toBe('Acme');
    // Everyone told of the deletion but the owner who brought it back hears it is back (late trap #89).
    expect(restored.notify.map((person) => person.name)).not.toContain(restored.restoredBy);
    expect(restored.restoredBy).toBe('Ada');
    expect(await refusalOf(restoreWorkspace(entry.scope))).toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      enterAsActor(
        { db, rules: NO_RULE_SOURCE },
        { workspaceId: t.workspaceId, actor: { type: 'member', id: memberId } },
      ),
    ).resolves.toBeDefined();
    expect((await auditOf(t.workspaceId)).map((row) => row.action)).toEqual([
      'workspace.deleted',
      'workspace.restored',
    ]);
  });

  it('finds nothing to restore once the window has passed', async () => {
    const t = await team();
    await deleteWorkspace(t.as(t.owner, 'owner'), { confirmName: 'Acme' });
    await testQuery(ownerUrl, `update workspaces set purge_after = now() - interval '2 hours' where id = $1`, [
      t.workspaceId,
    ]);
    expect(await refusalOf(enterDeletedWorkspace(t.doorDeps, { userId: t.ownerUser, slug: t.slug }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('the audit log is append only (AC-830)', () => {
  it('refuses the app role an update or a delete, and the owner too', async () => {
    const t = await team();
    await updateWorkspace(t.as(t.owner, 'owner'), { name: 'Renamed' });
    const update = db.withWorkspace(t.workspaceId, (tx) => tx.execute(sql`update audit_events set action = 'x.y'`));
    await expect(update).rejects.toThrow();
    const remove = db.withWorkspace(t.workspaceId, (tx) => tx.execute(sql`delete from audit_events`));
    await expect(remove).rejects.toThrow();
    await expect(
      testQuery(ownerUrl, 'delete from audit_events where workspace_id = $1', [t.workspaceId]),
    ).rejects.toThrow(/AUDIT_APPEND_ONLY/);
    expect(await auditOf(t.workspaceId)).toHaveLength(1);
  });

  it('shows another workspace’s rows to nobody', async () => {
    const a = await team();
    const b = await team();
    await updateWorkspace(a.as(a.owner, 'owner'), { name: 'Renamed' });
    const seen = await db.withWorkspace(b.workspaceId, (tx) => tx.execute(sql`select id from audit_events`));
    expect(seen.rows).toEqual([]);
  });
});

describe('the purge (AC-823)', () => {
  const log = { info: () => undefined };
  const left = (workspaceId: string) =>
    testQuery<{
      workspaces: number;
      members: number;
      objects: number;
      audit: number;
      directory: number;
      memberships: number;
    }>(
      ownerUrl,
      `select (select count(*)::int from workspaces where id = $1) as workspaces,
        (select count(*)::int from members where workspace_id = $1) as members,
        (select count(*)::int from objects where workspace_id = $1) as objects,
        (select count(*)::int from audit_events where workspace_id = $1) as audit,
        (select count(*)::int from auth.workspace_directory where workspace_id = $1) as directory,
        (select count(*)::int from auth.workspace_membership where workspace_id = $1) as memberships`,
      [workspaceId],
    ).then((rows) => rows[0]);

  it('removes a workspace past its window, every row of it, and leaves one inside it and a live one alone', async () => {
    const gone = await team(['member']);
    const waiting = await team();
    const live = await team();
    await deleteWorkspace(gone.as(gone.owner, 'owner'), { confirmName: 'Acme' });
    await deleteWorkspace(waiting.as(waiting.owner, 'owner'), { confirmName: 'Acme' });
    await testQuery(ownerUrl, `update workspaces set purge_after = now() - interval '2 hours' where id = $1`, [
      gone.workspaceId,
    ]);
    const before = await left(gone.workspaceId);
    expect(before?.objects).toBeGreaterThan(0);
    expect(before?.audit).toBe(1);
    // Only the one past its window is listed, and only it is purged.
    const listed = await testQuery<{ id: string }>(workerUrl, 'select id from crm_workspaces_to_purge(50) as w(id)');
    expect(listed.map((row) => row.id)).toContain(gone.workspaceId);
    expect(listed.map((row) => row.id)).not.toContain(waiting.workspaceId);
    for (const t of [waiting, live]) {
      expect(await purgeWorkspace({ db: worker, log }, t.workspaceId, Date.now() + 60_000)).toBe('skipped');
      const begun = await testQuery<{ ok: boolean }>(workerUrl, 'select crm_purge_workspace_begin($1) as ok', [
        t.workspaceId,
      ]);
      expect(begun).toEqual([{ ok: false }]);
      expect((await left(t.workspaceId))?.workspaces).toBe(1);
    }
    expect((await left(waiting.workspaceId))?.audit).toBe(1);
    expect(await purgeWorkspace({ db: worker, log }, gone.workspaceId, Date.now() + 60_000)).toBe('done');
    expect(await left(gone.workspaceId)).toEqual({
      workspaces: 0,
      members: 0,
      objects: 0,
      audit: 0,
      directory: 0,
      memberships: 0,
    });
  });

  it('removes the files its uploads hold from the store, not only their rows', async () => {
    const t = await team();
    const owner = t.as(t.owner, 'owner');
    const form = await createForm(owner, { id: newId(), name: 'Apply' });
    const fileId = newId();
    const pathname = `forms/${t.workspaceId}/${form.id}/${fileId}.pdf`;
    await testQuery(
      ownerUrl,
      `insert into form_uploads (workspace_id, id, form_id, pathname, name, size, content_type)
       values ($1, $2, $3, $4, 'cv.pdf', 1024, 'application/pdf')`,
      [t.workspaceId, fileId, form.id, pathname],
    );
    await deleteWorkspace(owner, { confirmName: 'Acme' });
    await testQuery(ownerUrl, `update workspaces set purge_after = now() - interval '2 hours' where id = $1`, [
      t.workspaceId,
    ]);
    // A purge used to delete the rows only, after which nothing could ever find those bytes (late trap #84).
    const removed: string[] = [];
    const files = {
      remove: (pathnames: readonly string[]) => {
        removed.push(...pathnames);
        return Promise.resolve();
      },
    };
    expect(await purgeWorkspace({ db: worker, log, files }, t.workspaceId, Date.now() + 60_000)).toBe('done');
    expect(removed).toEqual([pathname]);
    expect((await left(t.workspaceId))?.workspaces).toBe(0);
  });

  it('takes its members’ link pages with it, and holds their handles rather than keeping them bound to it', async () => {
    const t = await team();
    const other = await team();
    const pagesOf = (workspaceId: string) =>
      testQuery<{ pages: number; held: number; bound: number }>(
        ownerUrl,
        `select (select count(*)::int from auth.public_profiles where workspace_id = $1) as pages,
          (select count(*)::int from auth.public_handles where workspace_id = $1 and user_id is null
            and released_at is not null) as held,
          (select count(*)::int from auth.public_handles where workspace_id = $1 and user_id is not null) as bound`,
        [workspaceId],
      ).then((rows) => rows[0]);
    const pages = () =>
      testQuery<{ pages: number; held: number; bound: number }>(
        ownerUrl,
        `select (select count(*)::int from auth.public_profiles where workspace_id = $1) as pages,
          (select count(*)::int from auth.public_handles where workspace_id = $1 and user_id is null
            and released_at is not null) as held,
          (select count(*)::int from auth.public_handles where workspace_id = $1 and user_id is not null) as bound`,
        [t.workspaceId],
      ).then((rows) => rows[0]);
    // The owner's page, made with the membership.
    expect(await pages()).toEqual({ pages: 1, held: 0, bound: 1 });
    await deleteWorkspace(t.as(t.owner, 'owner'), { confirmName: 'Acme' });
    // Deleted but inside its window: nothing of its pages goes yet.
    expect(await purgeWorkspace({ db: worker, log }, t.workspaceId, Date.now() + 60_000)).toBe('skipped');
    expect(await pages()).toEqual({ pages: 1, held: 0, bound: 1 });
    await testQuery(ownerUrl, `update workspaces set purge_after = now() - interval '2 hours' where id = $1`, [
      t.workspaceId,
    ]);
    expect(await purgeWorkspace({ db: worker, log }, t.workspaceId, Date.now() + 60_000)).toBe('done');
    // Late trap #86: the page stayed stored and its handle bound to a workspace that no longer exists, for good.
    expect(await pages()).toEqual({ pages: 0, held: 1, bound: 0 });
    // Another workspace's page and handle stand.
    expect(await pagesOf(other.workspaceId)).toEqual({ pages: 1, held: 0, bound: 1 });
  });

  it('stops where its time ran out and finishes on the next call', async () => {
    const t = await team();
    await deleteWorkspace(t.as(t.owner, 'owner'), { confirmName: 'Acme' });
    await testQuery(ownerUrl, `update workspaces set purge_after = now() - interval '2 hours' where id = $1`, [
      t.workspaceId,
    ]);
    expect(await purgeWorkspace({ db: worker, log }, t.workspaceId, Date.now() - 1)).toBe('more');
    expect((await left(t.workspaceId))?.workspaces).toBe(1);
    expect(await purgeWorkspace({ db: worker, log }, t.workspaceId, Date.now() + 60_000)).toBe('done');
    expect((await left(t.workspaceId))?.workspaces).toBe(0);
  });

  it('queues each live calendar connection’s revoke before marking it revoked, and drops an expired one at once (AC-815)', async () => {
    const t = await team(['member']);
    const member = t.ids[0] ?? '';
    const connection = async (status: string) => {
      const id = newId();
      await db.withWorkspace(t.workspaceId, (tx) =>
        tx.execute(
          sql`insert into calendar_connections (workspace_id, id, member_id, provider, account_email, status, tokens, created_by_type, created_by_id, created_by_member_id, updated_by_type)
            values (${t.workspaceId}, ${id}, ${member}, 'google', ${`m-${tag()}@example.com`}, ${status}, '\\x00'::bytea, 'member', ${member}, ${member}, 'calendar')`,
        ),
      );
      return id;
    };
    const connected = await connection('connected');
    const failed = await connection('failed');
    await connection('expired');
    await deleteWorkspace(t.as(t.owner, 'owner'), { confirmName: 'Acme' });
    await testQuery(ownerUrl, `update workspaces set purge_after = now() - interval '2 hours' where id = $1`, [
      t.workspaceId,
    ]);
    // The queue function only takes a connection that may sync: queued first, then marked, each run can end its grant.
    expect(await purgeWorkspace({ db: worker, log }, t.workspaceId, Date.now() + 60_000)).toBe('waiting');
    expect(
      await testQuery<{ id: string; status: string }>(
        ownerUrl,
        `select id::text as id, status::text as status from calendar_connections where workspace_id = $1 order by id`,
        [t.workspaceId],
      ),
    ).toEqual([
      { id: connected, status: 'revoked' },
      { id: failed, status: 'revoked' },
    ]);
    const queued = await testQuery<{ id: string }>(
      ownerUrl,
      // The calendar runs only: the owner's welcome email (26 Oct 2026) is queued for the workspace too.
      `select payload->>'connectionId' as id from graphile_worker._private_jobs where payload->>'workspaceId' = $1
         and payload->>'connectionId' is not null
       order by run_at`,
      [t.workspaceId],
    );
    expect(queued.map((row) => row.id)).toEqual([connected, failed]);
    // A call again queues nothing more, and waits while the runs are out.
    expect(await purgeWorkspace({ db: worker, log }, t.workspaceId, Date.now() + 60_000)).toBe('waiting');
    // Each run ends its grant and deletes its row; then the purge goes on.
    await testQuery(ownerUrl, `delete from calendar_connections where workspace_id = $1`, [t.workspaceId]);
    await testQuery(ownerUrl, `delete from graphile_worker._private_jobs where payload->>'workspaceId' = $1`, [
      t.workspaceId,
    ]);
    expect(await purgeWorkspace({ db: worker, log }, t.workspaceId, Date.now() + 60_000)).toBe('done');
  });

  it('is the worker’s alone', async () => {
    for (const call of ['select * from crm_workspaces_to_purge(5)', `select crm_purge_workspace_end('${newId()}')`]) {
      await expect(testQuery(appUrl, call)).rejects.toMatchObject({ code: '42501' });
    }
  });
});
