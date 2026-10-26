// Slug history (migration 0087), against the real Postgres: booking_page_slugs is a forced row level security
// tenant table kept only by the trigger crm_booking_page_slugs_keep, an old slug stays the page's across the
// person's workspaces while it redirects (the unique index refuses it to any other page of theirs), the history is
// capped at 20 old slugs, and it goes with the page, whether deleted, handed over or purged.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from './client.ts';

const { appUrl, ownerUrl } = inject('testDatabase');

let owner: pg.Client;
let db: Database;

beforeAll(async () => {
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-slugs-tests' });
});

afterAll(async () => {
  await owner.end();
  await db.close();
});

/** A person who can sign in. */
async function person(): Promise<string> {
  const userId = randomUUID();
  await owner.query(`insert into auth."user" (id, name, email) values ($1, 'Ada', $2)`, [
    userId,
    `${userId}@example.com`,
  ]);
  return userId;
}

/** A workspace with one owner member, who is `userId` when given. */
async function workspaceOf(userId?: string) {
  const workspaceId = randomUUID();
  const memberId = randomUUID();
  await db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(
      sql`insert into workspaces (id, name, slug, created_by_type, updated_by_type) values (${workspaceId}, 'Slugs', ${`slugs-${workspaceId}`}, 'system', 'system')`,
    );
    await tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, user_id, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, 'Ada', ${`ada-${memberId}@example.com`}, 'owner', ${userId ?? null}, 'system', 'system')`,
    );
  });
  return { workspaceId, memberId };
}

/** A Public page of the member's at `slug`. */
async function pageIn(at: { readonly workspaceId: string; readonly memberId: string }, slug: string) {
  const pageId = randomUUID();
  const publicKey = randomUUID().replaceAll('-', '').slice(0, 16);
  await db.withWorkspace(at.workspaceId, (tx) =>
    tx.execute(
      sql`insert into booking_pages (workspace_id, id, public_key, slug, owner_member_id, title, durations, location, availability, created_by_type, updated_by_type) values (${at.workspaceId}, ${pageId}, ${publicKey}, ${slug}, ${at.memberId}, 'Intro call', '{30}', '{"type":"video"}', '{}', 'system', 'system')`,
    ),
  );
  return pageId;
}

const rename = (workspaceId: string, pageId: string, slug: string) =>
  db.withWorkspace(workspaceId, (tx) => tx.execute(sql`update booking_pages set slug = ${slug} where id = ${pageId}`));

/** The page's slugs, as its workspace reads them. */
async function slugsOf(workspaceId: string, pageId: string): Promise<readonly string[]> {
  const found = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ slug: string }>(sql`select slug from booking_page_slugs where page_id = ${pageId} order by slug`),
  );
  return found.rows.map((row) => row.slug);
}

/** The page `/<handle>/<slug>` names for the person in one workspace, by crm_booking_page_by_address (spec 0056). */
async function addressed(userId: string, workspaceId: string, slug: string) {
  const found = await db.withWorkspace(randomUUID(), (tx) =>
    tx.execute<{ workspace_id: string; page_id: string }>(
      sql`select workspace_id::text, page_id::text from crm_booking_page_by_address(${userId}::uuid, ${workspaceId}::uuid, ${slug})`,
    ),
  );
  return found.rows;
}

describe('booking_page_slugs', () => {
  it('reads none of another workspace’s rows, and refuses a row for another workspace', async () => {
    const userId = await person();
    const a = await workspaceOf(userId);
    const b = await workspaceOf(userId);
    const inA = await pageIn(a, 'alpha');
    await pageIn(b, 'beta');
    const seen = await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute<{ workspace_id: string }>(sql`select workspace_id::text from booking_page_slugs`),
    );
    expect(seen.rows).toEqual([{ workspace_id: a.workspaceId }]);
    // From workspace B, A's page can't be seen, so the row is refused before the policy's own check would refuse it.
    await expect(
      db.withWorkspace(b.workspaceId, (tx) =>
        tx.execute(
          sql`insert into booking_page_slugs (workspace_id, page_id, owner_user_id, slug) values (${a.workspaceId}, ${inA}, ${userId}, 'alpha')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'booking_page_slugs_current' } });
    const touched = await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute(sql`update booking_page_slugs set updated_at = now() where page_id = ${inA}`),
    );
    expect(touched.rowCount).toBe(0);
    const removed = await db.withWorkspace(b.workspaceId, (tx) =>
      tx.execute(sql`delete from booking_page_slugs where page_id = ${inA}`),
    );
    expect(removed.rowCount).toBe(0);
    expect(await slugsOf(a.workspaceId, inA)).toEqual(['alpha']);
  });

  it('keeps every slug a page held, and an old one finds the page (ids only)', async () => {
    const userId = await person();
    const a = await workspaceOf(userId);
    const pageId = await pageIn(a, 'intro');
    expect(await slugsOf(a.workspaceId, pageId)).toEqual(['intro']);
    await rename(a.workspaceId, pageId, 'meet');
    expect(await slugsOf(a.workspaceId, pageId)).toEqual(['intro', 'meet']);
    expect(await addressed(userId, a.workspaceId, 'intro')).toEqual([{ workspace_id: a.workspaceId, page_id: pageId }]);
    expect(await addressed(userId, a.workspaceId, 'meet')).toEqual([{ workspace_id: a.workspaceId, page_id: pageId }]);
    expect(await addressed(userId, a.workspaceId, 'never')).toEqual([]);
  });

  it('refuses an old slug to another page of the person’s in the same workspace, and lets its own page take it back', async () => {
    const userId = await person();
    const a = await workspaceOf(userId);
    const one = await pageIn(a, 'intro');
    await rename(a.workspaceId, one, 'meet');
    await expect(pageIn(a, 'intro')).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'booking_page_slugs_owner_slug' },
    });
    const two = await pageIn(a, 'other');
    await expect(rename(a.workspaceId, two, 'intro')).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'booking_page_slugs_owner_slug' },
    });
    await rename(a.workspaceId, one, 'intro');
    expect(await addressed(userId, a.workspaceId, 'meet')).toEqual([{ workspace_id: a.workspaceId, page_id: one }]);
    // Another person may use the same slug.
    const bob = await workspaceOf(await person());
    await pageIn(bob, 'meet');
  });

  it('lets a slug repeat across a person’s workspaces, each address naming exactly one page (spec 0056, AC-5608)', async () => {
    const userId = await person();
    const a = await workspaceOf(userId);
    const b = await workspaceOf(userId);
    const inA = await pageIn(a, 'intro');
    const inB = await pageIn(b, 'intro');
    await rename(a.workspaceId, inA, 'meet');
    // The old slug stays with A's page for A's address, and B's own `intro` is a different address.
    expect(await addressed(userId, a.workspaceId, 'intro')).toEqual([{ workspace_id: a.workspaceId, page_id: inA }]);
    expect(await addressed(userId, b.workspaceId, 'intro')).toEqual([{ workspace_id: b.workspaceId, page_id: inB }]);
    expect(await addressed(userId, a.workspaceId, 'meet')).toEqual([{ workspace_id: a.workspaceId, page_id: inA }]);
    // A workspace's address never finds another workspace's page.
    expect(await addressed(userId, b.workspaceId, 'meet')).toEqual([]);
  });

  it('keeps at most 20 old slugs, the one left longest ago going first', async () => {
    const userId = await person();
    const a = await workspaceOf(userId);
    const pageId = await pageIn(a, 'slug-0');
    for (let n = 1; n <= 22; n += 1) await rename(a.workspaceId, pageId, `slug-${String(n)}`);
    const kept = await slugsOf(a.workspaceId, pageId);
    expect(kept).toHaveLength(21);
    expect(kept).not.toContain('slug-0');
    expect(kept).not.toContain('slug-1');
    expect(kept).toContain('slug-2');
    expect(await addressed(userId, a.workspaceId, 'slug-0')).toEqual([]);
    // A slug past the cap is free again.
    await pageIn(a, 'slug-0');
  });

  it('goes with the page: deleted, handed to someone else, or purged', async () => {
    const userId = await person();
    const a = await workspaceOf(userId);
    const deleted = await pageIn(a, 'gone');
    await rename(a.workspaceId, deleted, 'gone-now');
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(sql`update booking_pages set deleted_at = now() where id = ${deleted}`),
    );
    expect(await slugsOf(a.workspaceId, deleted)).toEqual([]);
    expect(await addressed(userId, a.workspaceId, 'gone')).toEqual([]);
    await pageIn(a, 'gone');

    const handed = await pageIn(a, 'handed');
    await rename(a.workspaceId, handed, 'handed-now');
    const other = randomUUID();
    const otherUser = await person();
    await db.withWorkspace(a.workspaceId, async (tx) => {
      await tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, user_id, created_by_type, updated_by_type) values (${a.workspaceId}, ${other}, 'Bob', ${`bob-${other}@example.com`}, 'member', ${otherUser}, 'system', 'system')`,
      );
      await tx.execute(sql`update booking_pages set owner_member_id = ${other} where id = ${handed}`);
    });
    expect(await slugsOf(a.workspaceId, handed)).toEqual(['handed-now']);
    expect(await addressed(userId, a.workspaceId, 'handed')).toEqual([]);

    const purged = await pageIn(a, 'purged');
    await rename(a.workspaceId, purged, 'purged-now');
    await db.withWorkspace(a.workspaceId, (tx) => tx.execute(sql`delete from booking_pages where id = ${purged}`));
    const left = await owner.query(`select 1 from booking_page_slugs where page_id = $1`, [purged]);
    expect(left.rowCount).toBe(0);
  });

  it('answers no old slug once the owner is no longer an active member there', async () => {
    const userId = await person();
    const a = await workspaceOf();
    const memberId = randomUUID();
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, user_id, created_by_type, updated_by_type) values (${a.workspaceId}, ${memberId}, 'Ada', ${`ada-${memberId}@example.com`}, 'member', ${userId}, 'system', 'system')`,
      ),
    );
    const pageId = await pageIn({ workspaceId: a.workspaceId, memberId }, 'intro');
    await rename(a.workspaceId, pageId, 'meet');
    expect(await addressed(userId, a.workspaceId, 'intro')).toEqual([{ workspace_id: a.workspaceId, page_id: pageId }]);
    await db.withWorkspace(a.workspaceId, (tx) =>
      tx.execute(sql`update members set status = 'removed', left_at = now() where id = ${memberId}`),
    );
    expect(await addressed(userId, a.workspaceId, 'intro')).toEqual([]);
    expect(await addressed(userId, a.workspaceId, 'meet')).toEqual([]);
  });

  it('takes no row but the page’s current slug under its owner, and lets the app change only when', async () => {
    const userId = await person();
    const a = await workspaceOf(userId);
    const pageId = await pageIn(a, 'intro');
    const someone = await person();
    // Not the page's owner: no write may hold a slug in someone else's name.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into booking_page_slugs (workspace_id, page_id, owner_user_id, slug) values (${a.workspaceId}, ${pageId}, ${someone}, 'intro')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'booking_page_slugs_current' } });
    // Not its current slug.
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(
          sql`insert into booking_page_slugs (workspace_id, page_id, owner_user_id, slug) values (${a.workspaceId}, ${pageId}, ${userId}, 'reserved')`,
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'booking_page_slugs_current' } });
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(sql`update booking_page_slugs set slug = 'other' where page_id = ${pageId}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      db.withWorkspace(a.workspaceId, (tx) =>
        tx.execute(sql`update booking_page_slugs set owner_user_id = ${someone} where page_id = ${pageId}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('keeps no history for an owner without an identity, who has no address', async () => {
    const a = await workspaceOf();
    const pageId = await pageIn(a, 'plain');
    await rename(a.workspaceId, pageId, 'plain-2');
    expect(await slugsOf(a.workspaceId, pageId)).toEqual([]);
  });
});
