// Who a link page is from (3 Nov 2026), against the real Postgres: the job title shown only when its owner switches
// it on, the workspace's lockup only once they give a site, their own line above the foot, each kept in schema auth
// through crm_handle's two definers, checked on the way in, audited, and shown on the link page and their personal
// booking pages, never a team page.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, enterLinkPage, findLockupLogo } from '../access/door.ts';
import { setLinkPageLive } from '../booking/handles.ts';
import { createBookingPage } from '../booking/pages.ts';
import { getPublicBookingPage, readLinkPage } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { getMyProfile, updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-identity-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A signed in person with a handle in a workspace of theirs, as its owner. */
async function person(name: string) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Northwind',
    slug: `identity-${String(count)}-${String(Date.now())}`,
    firstMember: { name, email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  const handle = `ada-${randomUUID().slice(0, 8)}`;
  await updateMyMemberProfile(scope, { handle });
  return { ...created, userId, scope, handle };
}

/** A refusal's code and field, or what else the call ended in. */
async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, field: error.refusal.field };
    throw error;
  }
  throw new Error('It was let through.');
}

const page = (handle: string) => enterLinkPage({ db }, handle, { max: 21 }).then((found) => readLinkPage(found));

describe('who a link page is from', () => {
  it('shows nothing new until its owner chooses, then each choice as they made it', async () => {
    const ada = await person('Ada Lovelace');
    const before = await page(ada.handle);
    expect(before).not.toHaveProperty('role');
    expect(before).not.toHaveProperty('brand');
    expect(before).not.toHaveProperty('footLine');
    expect(await getMyProfile(ada.scope)).toMatchObject({ showJobTitle: false });

    // A job title alone shows nowhere: it is the team's until switched on.
    await updateMyMemberProfile(ada.scope, { jobTitle: 'Head of partnerships' });
    expect(await page(ada.handle)).not.toHaveProperty('role');
    const saved = await updateMyMemberProfile(ada.scope, {
      showJobTitle: true,
      site: 'northwind.com',
      footLine: '  Replies within a day.  ',
    });
    expect(saved).toMatchObject({
      showJobTitle: true,
      site: 'https://northwind.com/',
      footLine: 'Replies within a day.',
    });
    const after = await page(ada.handle);
    expect(after.role).toBe('Head of partnerships');
    // No logo in the kit yet: the name stands alone.
    expect(after.brand).toEqual({ name: 'Northwind', site: 'https://northwind.com/' });
    expect(after.footLine).toBe('Replies within a day.');

    // Cleared one at a time, each back to drawing nothing.
    await updateMyMemberProfile(ada.scope, { site: '', footLine: '', showJobTitle: false });
    const cleared = await page(ada.handle);
    expect(cleared).not.toHaveProperty('role');
    expect(cleared).not.toHaveProperty('brand');
    expect(cleared).not.toHaveProperty('footLine');
  });

  it('serves the workspace logo for the lockup only while there is a site to link to', async () => {
    const ada = await person('Ada Lovelace');
    const path = `logos/${ada.workspaceId}/${randomUUID()}.png`;
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`insert into workspace_brands (workspace_id, logo_path, logo_type, logo_version, updated_by)
            values (${ada.workspaceId}, ${path}, 'image/png', 'abcdef012345', ${ada.memberId})`,
      ),
    );
    expect((await findLockupLogo({ db }, ada.handle)).logo).toBeUndefined();
    await updateMyMemberProfile(ada.scope, { site: 'https://northwind.com' });
    expect((await findLockupLogo({ db }, ada.handle)).logo).toEqual({
      path,
      type: 'image/png',
      version: 'abcdef012345',
    });
    expect((await page(ada.handle)).brand?.logo).toBe(`/api/public/profiles/${ada.handle}/logo?v=abcdef012345`);
  });

  it('refuses a site that isn’t https, a line over 80 characters, and keeps nothing refused', async () => {
    const ada = await person('Ada Lovelace');
    for (const site of [
      'http://northwind.com',
      'javascript:alert(1)',
      'https://ada:secret@northwind.com',
      'localhost',
      'https://com.',
    ]) {
      expect(await refusalOf(updateMyMemberProfile(ada.scope, { site })), site).toEqual({
        code: 'CONFIG_INVALID',
        field: 'site',
      });
    }
    for (const footLine of ['x'.repeat(81), 'a\tb', 'a\u0000b']) {
      expect(await refusalOf(updateMyMemberProfile(ada.scope, { footLine })), JSON.stringify(footLine)).toEqual({
        code: 'CONFIG_INVALID',
        field: 'footLine',
      });
    }
    const profile = await getMyProfile(ada.scope);
    expect(profile.site).toBeUndefined();
    expect(profile.footLine).toBeUndefined();
    // The columns hold their own rules, whoever calls the definer.
    await expect(
      db.withWorkspace(ada.workspaceId, (tx) =>
        tx.execute(
          sql`select crm_save_profile_identity(${ada.userId}::uuid, ${ada.workspaceId}::uuid, false, 'http://a.co', null)`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'public_profiles_site' } });
    await expect(
      db.withWorkspace(ada.workspaceId, (tx) =>
        tx.execute(sql`update auth.public_profiles set foot_line = 'x' where user_id = ${ada.userId}::uuid`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('tells a visitor nothing of it while the page is Private, and its owner still everything', async () => {
    const ada = await person('Ada Lovelace');
    const stranger = randomUUID();
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`insert into workspace_brands (workspace_id, logo_path, logo_type, logo_version, updated_by)
            values (${ada.workspaceId}, ${`logos/${ada.workspaceId}/${randomUUID()}.png`}, 'image/png', 'abcdef012345', ${ada.memberId})`,
      ),
    );
    await updateMyMemberProfile(ada.scope, { site: 'https://northwind.com', footLine: 'Replies within a day.' });
    await db.withWorkspace(ada.workspaceId, (tx) => setLinkPageLive(tx, ada.userId, ada.workspaceId, false));
    for (const viewer of [undefined, stranger]) {
      const options = viewer === undefined ? {} : { viewer };
      expect(await refusalOf(findLockupLogo({ db }, ada.handle, options))).toEqual({
        code: 'NOT_FOUND',
        field: undefined,
      });
      expect(await refusalOf(enterLinkPage({ db }, ada.handle, { max: 21, ...options }))).toEqual({
        code: 'NOT_FOUND',
        field: undefined,
      });
    }
    const own = await enterLinkPage({ db }, ada.handle, { max: 21, viewer: ada.userId }).then((found) =>
      readLinkPage(found),
    );
    expect(own.brand?.name).toBe('Northwind');
    expect(own.footLine).toBe('Replies within a day.');
    expect((await findLockupLogo({ db }, ada.handle, { viewer: ada.userId })).logo?.version).toBe('abcdef012345');
  });

  it('is written for one’s own page only, never another workspace’s', async () => {
    const ada = await person('Ada Lovelace');
    const other = await person('Bea');
    await expect(
      db.withWorkspace(ada.workspaceId, (tx) =>
        tx.execute(
          sql`select crm_save_profile_identity(${other.userId}::uuid, ${other.workspaceId}::uuid, true, null, 'Mine now')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    expect((await getMyProfile(other.scope)).footLine).toBeUndefined();
  });

  it('is audited once a change, with what it was and what it became', async () => {
    const ada = await person('Ada Lovelace');
    await updateMyMemberProfile(ada.scope, { footLine: 'Hello' });
    await updateMyMemberProfile(ada.scope, { footLine: 'Hello' });
    await updateMyMemberProfile(ada.scope, { showJobTitle: true });
    const rows = await testQuery<{ before: unknown; after: unknown }>(
      ownerUrl,
      `select before, after from audit_events where workspace_id = $1 and action = 'member.profile_updated'
         and (after ? 'footLine' or after ? 'showJobTitle') order by at, id`,
      [ada.workspaceId],
    );
    expect(rows).toEqual([
      { before: { footLine: null }, after: { footLine: 'Hello' } },
      { before: { showJobTitle: false }, after: { showJobTitle: true } },
    ]);
  });

  it('puts the job title on the host’s personal booking pages while it shows, never on a team page', async () => {
    const ada = await person('Ada Lovelace');
    await updateMyMemberProfile(ada.scope, { jobTitle: 'Head of partnerships' });
    const mine = await createBookingPage(ada.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const entry = await enterBookingPage({ db }, mine.publicKey);
    expect((await getPublicBookingPage(entry)).hostRole).toBeUndefined();
    await updateMyMemberProfile(ada.scope, { showJobTitle: true });
    expect((await getPublicBookingPage(entry)).hostRole).toBe('Head of partnerships');

    const team = await createBookingPage(ada.scope, { id: newId(), title: 'Panel', timeZone: 'UTC' });
    await db.withWorkspace(ada.workspaceId, async (tx) => {
      await tx.execute(sql`update booking_pages set kind = 'collective' where id = ${team.id}::uuid`);
      await tx.execute(sql`delete from booking_page_members where page_id = ${team.id}::uuid`);
      await tx.execute(
        sql`insert into booking_page_members (workspace_id, page_id, member_id, position) values (${ada.workspaceId}, ${team.id}, ${ada.memberId}, 0)`,
      );
    });
    const facts = await getPublicBookingPage(await enterBookingPage({ db }, team.publicKey));
    expect(facts.team).toBeDefined();
    expect(facts.hostRole).toBeUndefined();
  });
});
