// A person's own social links (booking socials, 25 Oct 2026), against the real Postgres: kept in schema auth and
// reached only through crm_handle's definers, the same in every workspace, set by the person alone and audited,
// checked by the same rule the editor runs; shown on a personal page whose switch is on and on the profile, never on
// a team page (AC-754).
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, enterBookingProfile, findHandleOwner } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { getMyProfile, updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { createBookingPage, updateBookingPage } from './pages.ts';
import { getPublicBookingPage, readBookingProfile } from './public.ts';
import { publicSocialsOf } from './socials.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-socials-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A signed in person and a workspace of theirs, as its owner. */
async function person(name: string) {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Socials',
    slug: `socials-${String(count)}-${String(Date.now())}`,
    firstMember: { name, email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  return { ...created, userId, scope };
}

/** The stored rows, as the owner sees them. */
async function stored(userId: string) {
  return testQuery<{ network: string; href: string; position: number; updated_at: Date }>(
    ownerUrl,
    `select network, href, position, updated_at from auth.social_links where user_id = $1 order by position`,
    [userId],
  );
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

const LINKS = [
  { network: 'linkedin', href: 'https://linkedin.com/in/ada-lovelace' },
  { network: 'website', href: 'https://ada.dev/' },
  { network: 'x', href: 'https://x.com/ada' },
] as const;

describe('a person’s social links', () => {
  it('read as none until set, then in their order, written once and never again for the same set', async () => {
    const ada = await person('Ada Lovelace');
    expect((await getMyProfile(ada.scope)).socials).toEqual([]);
    const after = await updateMyMemberProfile(ada.scope, { socials: [...LINKS] });
    expect(after.socials).toEqual(LINKS);
    const first = await stored(ada.userId);
    expect(first.map((row) => [row.network, row.position])).toEqual([
      ['linkedin', 0],
      ['website', 1],
      ['x', 2],
    ]);
    // The same set again writes nothing: every row keeps its time.
    await updateMyMemberProfile(ada.scope, { socials: [...LINKS] });
    expect((await stored(ada.userId)).map((row) => row.updated_at.getTime())).toEqual(
      first.map((row) => row.updated_at.getTime()),
    );
    // Moved and one removed: the order is the new one, the rest gone.
    await updateMyMemberProfile(ada.scope, { socials: [LINKS[2], LINKS[0]] });
    expect((await stored(ada.userId)).map((row) => [row.network, row.position])).toEqual([
      ['x', 0],
      ['linkedin', 1],
    ]);
    await updateMyMemberProfile(ada.scope, { socials: [] });
    expect(await stored(ada.userId)).toEqual([]);
  });

  it('stores the one canonical link, whatever was typed, and refuses what the editor refuses', async () => {
    const ada = await person('Ada Lovelace');
    const after = await updateMyMemberProfile(ada.scope, {
      socials: [
        { network: 'linkedin', href: 'ada-lovelace' },
        { network: 'x', href: 'https://twitter.com/ada?s=20' },
        { network: 'website', href: 'ada.dev' },
      ],
    });
    expect(after.socials).toEqual([
      { network: 'linkedin', href: 'https://linkedin.com/in/ada-lovelace' },
      { network: 'x', href: 'https://x.com/ada' },
      { network: 'website', href: 'https://ada.dev' },
    ]);
    for (const [links, field] of [
      [[{ network: 'linkedin', href: 'https://instagram.com/ada' }], 'socials.0.href'],
      [[{ network: 'linkedin', href: 'https://linkedin.com/feed' }], 'socials.0.href'],
      [[{ network: 'website', href: 'javascript:alert(1)' }], 'socials.0.href'],
      [[{ network: 'website', href: 'https://ada:secret@ada.dev' }], 'socials.0.href'],
      [
        [
          { network: 'x', href: 'ada' },
          { network: 'x', href: 'bea' },
        ],
        'socials.1.network',
      ],
      [[{ network: 'myspace', href: 'ada' }], 'socials.0.network'],
    ] as const) {
      expect(
        await refusalOf(updateMyMemberProfile(ada.scope, { socials: links as never })),
        JSON.stringify(links),
      ).toMatchObject({ code: 'CONFIG_INVALID', field });
    }
    const eleven = Array.from({ length: 11 }, () => ({ network: 'x' as const, href: 'ada' }));
    expect(await refusalOf(updateMyMemberProfile(ada.scope, { socials: eleven }))).toMatchObject({
      code: 'LIMIT_REACHED',
    });
    // Nothing refused was kept.
    expect((await getMyProfile(ada.scope)).socials).toHaveLength(3);
  });

  it('is audited once a change, with the links before and after, and not for no change', async () => {
    const ada = await person('Ada Lovelace');
    await updateMyMemberProfile(ada.scope, { socials: [LINKS[0]] });
    await updateMyMemberProfile(ada.scope, { socials: [LINKS[0]] });
    await updateMyMemberProfile(ada.scope, { socials: [LINKS[0], LINKS[1]] });
    const rows = await testQuery<{ before: unknown; after: unknown }>(
      ownerUrl,
      `select before, after from audit_events where workspace_id = $1 and action = 'member.profile_updated' order by at, id`,
      [ada.workspaceId],
    );
    expect(rows).toEqual([
      { before: { socials: [] }, after: { socials: [LINKS[0].href] } },
      { before: { socials: [LINKS[0].href] }, after: { socials: [LINKS[0].href, LINKS[1].href] } },
    ]);
  });

  it('is the person’s in every workspace, and theirs alone to set', async () => {
    const ada = await person('Ada Lovelace');
    const second = await createWorkspace(db, {
      name: 'Second',
      slug: `socials-second-${String(Date.now())}-${String(count)}`,
      firstMember: { name: 'Ada Lovelace', email: `${ada.userId}@example.com`, userId: ada.userId },
    });
    const there = testScope({
      db,
      workspaceId: second.workspaceId,
      actor: { type: 'member', id: second.memberId },
      userId: ada.userId,
    });
    await updateMyMemberProfile(ada.scope, { socials: [LINKS[0]] });
    expect((await getMyProfile(there)).socials).toEqual([LINKS[0]]);

    // A colleague's change is their own set; an API key, a visitor and a member with no sign in have none.
    const beaUser = randomUUID();
    await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, 'Bea', $2)`, [
      beaUser,
      `${beaUser}@example.com`,
    ]);
    const beaId = newId();
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
            values (${ada.workspaceId}, ${beaId}, ${beaUser}, 'Bea', ${`${beaUser}@example.com`}, 'admin', 'system', 'system')`,
      ),
    );
    const bea = testScope({
      db,
      workspaceId: ada.workspaceId,
      actor: { type: 'member', id: beaId },
      role: 'admin',
      userId: beaUser,
    });
    await updateMyMemberProfile(bea, { socials: [LINKS[2]] });
    expect((await getMyProfile(bea)).socials).toEqual([LINKS[2]]);
    expect((await getMyProfile(ada.scope)).socials).toEqual([LINKS[0]]);
    const key = testScope({ db, workspaceId: ada.workspaceId, actor: { type: 'api_key', id: newId() } });
    expect(await refusalOf(updateMyMemberProfile(key, { socials: [] }))).toMatchObject({ code: 'FORBIDDEN' });
    const page = await createBookingPage(ada.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const visitor = (await enterBookingPage({ db }, page.publicKey)).scope;
    expect(await refusalOf(updateMyMemberProfile(visitor, { socials: [] }))).toMatchObject({ code: 'FORBIDDEN' });
    const unsigned = testScope({ db, workspaceId: ada.workspaceId, actor: { type: 'member', id: ada.memberId } });
    expect((await getMyProfile(unsigned)).socials).toBeUndefined();
    expect(await refusalOf(updateMyMemberProfile(unsigned, { socials: [LINKS[1]] }))).toEqual({
      code: 'FORBIDDEN',
      field: 'socials',
    });
    expect((await getMyProfile(ada.scope)).socials).toEqual([LINKS[0]]);
  });

  it('takes two saves at once from two workspaces in turn: the last wins whole, never a mix or a failure', async () => {
    const ada = await person('Ada Lovelace');
    const second = await createWorkspace(db, {
      name: 'Second',
      slug: `socials-race-${String(Date.now())}-${String(count)}`,
      firstMember: { name: 'Ada Lovelace', email: `${ada.userId}@example.com`, userId: ada.userId },
    });
    const there = testScope({
      db,
      workspaceId: second.workspaceId,
      actor: { type: 'member', id: second.memberId },
      userId: ada.userId,
    });
    const one = [LINKS[0], LINKS[1]];
    const two = [LINKS[1], LINKS[2]];
    await Promise.all([
      updateMyMemberProfile(ada.scope, { socials: one }),
      updateMyMemberProfile(there, { socials: two }),
    ]);
    const now = (await getMyProfile(ada.scope)).socials;
    expect([JSON.stringify(one), JSON.stringify(two)]).toContain(JSON.stringify(now));
  });

  it('is out of the app login’s own reach: no grant on the table, only the two functions', async () => {
    const ada = await person('Ada Lovelace');
    await expect(
      db.withWorkspace(ada.workspaceId, (tx) => tx.execute(sql`select * from auth.social_links`)),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      db.withWorkspace(ada.workspaceId, (tx) =>
        tx.execute(
          sql`insert into auth.social_links (user_id, network, href, position) values (${ada.userId}::uuid, 'x', 'https://x.com/a', 0)`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    // The table holds its own rules, whoever calls: a scheme other than http or https, or an eleventh, never lands.
    await expect(
      db.withWorkspace(ada.workspaceId, (tx) =>
        tx.execute(
          sql`select crm_save_social_links(${ada.userId}::uuid, array['website'], array['javascript:alert(1)'])`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'social_links_href' } });
    await expect(
      db.withWorkspace(ada.workspaceId, (tx) =>
        tx.execute(
          sql`select crm_save_social_links(${ada.userId}::uuid, array['myspace'], array['https://myspace.com/a'])`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'social_links_network' } });
    await expect(
      db.withWorkspace(ada.workspaceId, (tx) =>
        tx.execute(
          sql`select crm_save_social_links(${ada.userId}::uuid, array['x','x'], array['https://x.com/a','https://x.com/b'])`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });
});

describe('the links on the public pages', () => {
  it('show on a personal page in the person’s order, labelled, and go when its switch is off', async () => {
    const ada = await person('Ada Lovelace');
    const page = await createBookingPage(ada.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    expect(page.showSocials).toBe(true);
    const entry = await enterBookingPage({ db }, page.publicKey);
    expect((await getPublicBookingPage(entry)).socials).toBeUndefined();
    await updateMyMemberProfile(ada.scope, { socials: [...LINKS] });
    expect((await getPublicBookingPage(entry)).socials).toEqual([
      { network: 'linkedin', href: 'https://linkedin.com/in/ada-lovelace', label: 'ada-lovelace' },
      { network: 'website', href: 'https://ada.dev/', label: 'ada.dev' },
      { network: 'x', href: 'https://x.com/ada', label: '@ada' },
    ]);
    const off = await updateBookingPage(ada.scope, { pageId: page.id, settings: { showSocials: false } });
    expect(off.showSocials).toBe(false);
    expect((await getPublicBookingPage(entry)).socials).toBeUndefined();
  });

  it('let only the page’s owner turn them on or off', async () => {
    const ada = await person('Ada Lovelace');
    const page = await createBookingPage(ada.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const beaId = newId();
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
            values (${ada.workspaceId}, ${beaId}, 'Bea', ${`${beaId}@example.com`}, 'admin', 'system', 'system')`,
      ),
    );
    const bea = testScope({ db, workspaceId: ada.workspaceId, actor: { type: 'member', id: beaId }, role: 'admin' });
    expect(await refusalOf(updateBookingPage(bea, { pageId: page.id, settings: { showSocials: false } }))).toEqual({
      code: 'FORBIDDEN',
      field: 'showSocials',
    });
    // Her other changes to the page still go through.
    await updateBookingPage(bea, { pageId: page.id, settings: { title: 'Intro' } });
  });

  it('never show on a team page, which names no member (AC-754)', async () => {
    const ada = await person('Ada Lovelace');
    await updateMyMemberProfile(ada.scope, { socials: [...LINKS] });
    const page = await createBookingPage(ada.scope, { id: newId(), title: 'Panel', timeZone: 'UTC' });
    await db.withWorkspace(ada.workspaceId, async (tx) => {
      await tx.execute(sql`update booking_pages set kind = 'collective' where id = ${page.id}::uuid`);
      await tx.execute(sql`delete from booking_page_members where page_id = ${page.id}::uuid`);
      await tx.execute(
        sql`insert into booking_page_members (workspace_id, page_id, member_id, position) values (${ada.workspaceId}, ${page.id}, ${ada.memberId}, 0)`,
      );
    });
    const facts = await getPublicBookingPage(await enterBookingPage({ db }, page.publicKey));
    expect(facts.team).toBeDefined();
    expect(facts.socials).toBeUndefined();
  });

  it('show on the profile under the current handle, from the same read', async () => {
    const ada = await person('Ada Lovelace');
    const handle = `ada-${randomUUID().slice(0, 8)}`;
    await updateMyMemberProfile(ada.scope, { handle });
    expect((await readBookingProfile(await enterBookingProfile({ db }, handle, { max: 21 }))).socials).toBeUndefined();
    await updateMyMemberProfile(ada.scope, { socials: [LINKS[2]] });
    const profile = await readBookingProfile(await enterBookingProfile({ db }, handle, { max: 21 }));
    expect(profile.socials).toEqual([{ network: 'x', href: 'https://x.com/ada', label: '@ada' }]);
    // Only the profile reads them: the picture route's lookup never does.
    expect((await findHandleOwner({ db }, handle)).socials).toEqual([]);
    // The one reusable read (a link page asks the same).
    const direct = await db.withWorkspace(ada.workspaceId, (tx) => publicSocialsOf(tx, ada.userId));
    expect(direct).toEqual(profile.socials);
  });

  it('go with the account: deleting the person deletes their links', async () => {
    const ada = await person('Ada Lovelace');
    await updateMyMemberProfile(ada.scope, { socials: [LINKS[0]] });
    await testQuery(ownerUrl, `delete from auth.workspace_membership where user_id = $1`, [ada.userId]);
    await testQuery(ownerUrl, `update members set user_id = null where user_id = $1`, [ada.userId]);
    await testQuery(ownerUrl, `delete from auth."user" where id = $1`, [ada.userId]);
    expect(await stored(ada.userId)).toEqual([]);
  });
});
