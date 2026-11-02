// Migration 0166 (spec 0064, AC-6417), on data written in the shape before it: a database migrated up to the
// migration before it, a person's link pages in two workspaces with their blocks, views, facts, bookings and handles,
// then 0166 applied. Every page becomes its person's primary page with an id of its own, and everything that hung off
// (person, workspace) now names that page, so a visitor sees exactly what they saw. A block kept with no page waits
// with none, and the person's first page there adopts it.
import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { applyMigrations } from './migrations.ts';

const MIGRATION = '0166_several_link_pages';
const folder = fileURLToPath(new URL('../migrations', import.meta.url));

const { adminUrl, ownerUrl } = inject('testDatabase');
/** A database of its own, beside the suite's: this one is built in two steps. */
const name = `${new URL(ownerUrl).pathname.slice(1)}_pages`;
const ownerOf = (database: string) => {
  const url = new URL(ownerUrl);
  url.pathname = `/${database}`;
  return url.toString();
};
let earlier: string;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${admin.escapeIdentifier(name)} with (force)`);
    await admin.query(`create database ${admin.escapeIdentifier(name)} owner crm_owner`);
  } finally {
    await admin.end();
  }
  // The migrations as they stood before this one: the same files, its own left out of the folder and the journal.
  earlier = mkdtempSync(join(tmpdir(), 'crm-0166-'));
  cpSync(folder, earlier, { recursive: true });
  rmSync(join(earlier, `${MIGRATION}.sql`));
  const journal = JSON.parse(readFileSync(join(earlier, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.tag !== MIGRATION);
  writeFileSync(join(earlier, 'meta', '_journal.json'), JSON.stringify(journal));
  await applyMigrations(ownerOf(name), 'crm-test-0166', earlier);
}, 120_000);

afterAll(async () => {
  rmSync(earlier, { recursive: true, force: true });
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${admin.escapeIdentifier(name)} with (force)`);
  } finally {
    await admin.end();
  }
});

async function query<Row extends Record<string, unknown>>(text: string, params: readonly unknown[] = []) {
  const client = new pg.Client({ connectionString: ownerOf(name) });
  await client.connect();
  try {
    return (await client.query<Row>(text, [...params])).rows;
  } finally {
    await client.end();
  }
}

describe('migration 0166, several link pages', () => {
  it('makes each existing page its person’s primary page, and moves everything that hung off it there', async () => {
    const ada = randomUUID();
    const [work, home] = [randomUUID(), randomUUID()];
    const [workHandle, oldHandle, homeHandle] = ['ada-work', 'ada-old', 'ada-home'].map(
      (stem) => `${stem}-${randomUUID().slice(0, 6)}`,
    );
    const [one, two, three, orphan] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const elsewhere = randomUUID();
    const day = '2026-10-30';
    const visitor = 'c'.repeat(32);
    await query(`insert into auth."user" (id, name, email) values ($1, 'Ada', $2)`, [ada, `${ada}@example.com`]);
    await query(
      `insert into auth.public_handles (handle, user_id, workspace_id) values ($1, $4, $5), ($2, $4, $5), ($3, $4, $6)`,
      [workHandle, oldHandle, homeHandle, ada, work, home],
    );
    await query(
      `insert into auth.public_profiles (user_id, workspace_id, handle, bio) values ($1, $2, $3, 'Work'), ($1, $4, $5, 'Home')`,
      [ada, work, workHandle, home, homeHandle],
    );
    await query(
      `insert into auth.profile_items (id, user_id, workspace_id, kind, position, data) values
        ($1, $5, $6, 'link', 0, '{"title":"Site","url":"https://ada.dev"}'),
        ($2, $5, $6, 'heading', 1, '{"title":"More"}'),
        ($3, $5, $7, 'link', 0, '{"title":"Home","url":"https://home.dev"}'),
        ($4, $5, $8, 'link', 0, '{"title":"Kept","url":"https://kept.dev"}')`,
      [one, two, three, orphan, ada, work, home, elsewhere],
    );
    await query(
      `insert into auth.profile_views (user_id, workspace_id, day, visitor, views) values ($1, $2, $3, $4, 3)`,
      [ada, work, day, visitor],
    );
    await query(
      `insert into auth.profile_view_days (user_id, workspace_id, day, views, visitors) values ($1, $2, $3, 3, 1)`,
      [ada, work, day],
    );
    await query(
      `insert into auth.profile_view_source_days (user_id, workspace_id, day, fact, value, views, visitors)
       values ($1, $2, $3, 'device', 'mobile', 3, 1)`,
      [ada, work, day],
    );
    await query(`insert into auth.profile_booking_days (user_id, workspace_id, day, bookings) values ($1, $2, $3, 2)`, [
      ada,
      work,
      day,
    ]);

    await applyMigrations(ownerOf(name), 'crm-test-0166');

    const pages = await query<{ id: string; workspace_id: string; handle: string; is_primary: boolean; name: string }>(
      `select id::text, workspace_id::text, handle, is_primary, name from auth.public_profiles where user_id = $1
       order by handle`,
      [ada],
    );
    expect(pages).toHaveLength(2);
    expect(pages.every((page) => page.is_primary && page.name === '')).toBe(true);
    const pageOf = (workspace: string) => pages.find((page) => page.workspace_id === workspace)?.id;
    const items = await query<{ id: string; profile_id: string | null; position: number }>(
      `select id::text, profile_id::text, position from auth.profile_items where user_id = $1`,
      [ada],
    );
    const itemPage = new Map(items.map((item) => [item.id, item.profile_id]));
    expect(itemPage.get(one)).toBe(pageOf(work));
    expect(itemPage.get(two)).toBe(pageOf(work));
    expect(itemPage.get(three)).toBe(pageOf(home));
    // A block kept with no page there stays put, reaching nobody, with its place.
    expect(itemPage.get(orphan)).toBeNull();
    expect(items.find((item) => item.id === one)?.position).toBe(0);
    for (const table of ['profile_views', 'profile_view_days', 'profile_view_source_days', 'profile_booking_days']) {
      const rows = await query<{ profile_id: string }>(
        `select profile_id::text from auth.${table} where user_id = $1`,
        [ada],
      );
      expect(
        rows.map((row) => row.profile_id),
        table,
      ).toEqual([pageOf(work)]);
    }
    // Each handle, current and old, names its page.
    const handles = await query<{ handle: string; profile_id: string }>(
      `select handle, profile_id::text from auth.public_handles where user_id = $1`,
      [ada],
    );
    expect(new Map(handles.map((row) => [row.handle, row.profile_id]))).toEqual(
      new Map([
        [workHandle, pageOf(work)],
        [oldHandle, pageOf(work)],
        [homeHandle, pageOf(home)],
      ]),
    );

    // The person's first page in the third workspace adopts the block kept there with no page.
    const later = `ada-later-${randomUUID().slice(0, 6)}`;
    await query(`insert into auth.public_handles (handle, user_id, workspace_id) values ($1, $2, $3)`, [
      later,
      ada,
      elsewhere,
    ]);
    const made = await query<{ id: string; is_primary: boolean }>(
      `insert into auth.public_profiles (user_id, workspace_id, handle) values ($1, $2, $3) returning id::text, is_primary`,
      [ada, elsewhere, later],
    );
    expect(made[0]?.is_primary).toBe(true);
    const adopted = await query<{ profile_id: string }>(
      `select profile_id::text from auth.profile_items where id = $1`,
      [orphan],
    );
    expect(adopted[0]?.profile_id).toBe(made[0]?.id);
  });
});
