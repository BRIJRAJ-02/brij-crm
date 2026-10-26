// Migration 0113's backfill (spec 0056, AC-5614 to AC-5616), against the real Postgres: a person with handles, a
// profile, blocks and views from before the migration (no workspace on any of them) ends up with all of it in ONE
// home workspace, the one where they hold the most live Public pages, with the other workspace's page blocks deleted,
// the places closed up, and a second run changing nothing.
//
// The migration has already run on this database, so the old shape is staged inside one DO block that raises its
// answer as an exception, which rolls the whole thing back: the columns are made nullable again, the old rows are
// written without a workspace, and the migration's own backfill statements (cut out of the file, not copied) run on
// them twice.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { createBookingPage } from '../booking/pages.ts';
import { newId } from '../engine/ids.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-home-workspace-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A person and a workspace of theirs (or, with their id, another), as its owner. */
async function inWorkspace(name: string, workspace: string, userId: string) {
  count += 1;
  await testQuery(
    ownerUrl,
    `insert into auth."user" (id, name, email) values ($1, $2, $3) on conflict (id) do nothing`,
    [userId, name, `${userId}@example.com`],
  );
  const created = await createWorkspace(db, {
    name: workspace,
    slug: `home-${String(count)}-${String(Date.now())}`,
    firstMember: { name, email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  return { ...created, scope };
}

const page = (scope: ReturnType<typeof testScope>, title: string) =>
  createBookingPage(scope, { id: newId(), title, timeZone: 'Europe/London', settings: {} });

/** The migration's statements before its backfill, cut out of the file, each run as it stands. */
function beforeBackfill(): string {
  const text = readFileSync(
    new URL('../../../db/migrations/0113_link_page_per_workspace.sql', import.meta.url),
    'utf8',
  );
  const from = text.indexOf("set local lock_timeout = '5s';");
  const to = text.indexOf('do $$\ndeclare\n  moved integer;');
  return text
    .slice(from, to)
    .split('--> statement-breakpoint')
    .map((each) =>
      each
        .replace(/^\s*--.*$/gm, '')
        .trim()
        .replace(/;$/, ''),
    )
    .filter((each) => each !== '' && !each.startsWith('set local lock_timeout'))
    .map((each) => `execute $pre$${each}$pre$;`)
    .join('\n  ');
}

/** The migration's backfill block, cut out of the file: its declarations and body, to run nested. */
function backfillBlock(): string {
  const text = readFileSync(
    new URL('../../../db/migrations/0113_link_page_per_workspace.sql', import.meta.url),
    'utf8',
  );
  const marker = 'do $$\ndeclare\n  moved integer;';
  const from = text.indexOf(marker);
  const to = text.indexOf('\n$$;', from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return text.slice(from + 'do $$\n'.length, to);
}

interface Outcome {
  readonly handles: readonly string[];
  readonly profile: string;
  readonly items: readonly { readonly kind: string; readonly workspace: string; readonly position: number | null }[];
  readonly views: readonly string[];
  readonly again: unknown;
}

describe('the backfill of migration 0113', () => {
  it('moves a person’s page to the workspace where they hold the most live Public pages, and deletes the rest', async () => {
    const userId = randomUUID();
    const quiet = await inWorkspace('Ada', 'Quiet', userId);
    const busy = await inWorkspace('Ada', 'Busy', userId);
    const stray = await page(quiet.scope, 'Stray');
    const one = await page(busy.scope, 'One');
    await page(busy.scope, 'Two');
    const handles = [`old-${randomUUID().slice(0, 8)}`, `new-${randomUUID().slice(0, 8)}`];
    const [first, second] = handles;
    const day = new Date().toISOString().slice(0, 10);
    const visitor = 'a'.repeat(32);
    const sql = `
do $stage$
declare
  result json;
  before_run json;
begin
  set local row_security = off;
  alter table auth.public_handles alter column workspace_id drop not null;
  alter table auth.public_profiles drop constraint public_profiles_membership_fk;
  alter table auth.public_profiles drop constraint public_profiles_pkey;
  alter table auth.public_profiles alter column workspace_id drop not null;
  alter table auth.profile_items alter column workspace_id drop not null;
  alter table auth.profile_views drop constraint profile_views_pkey;
  alter table auth.profile_views alter column workspace_id drop not null;
  alter table auth.profile_view_days drop constraint profile_view_days_pkey;
  alter table auth.profile_view_days alter column workspace_id drop not null;
  -- The rule 0104 left, as a database before this migration holds it: the migration's own statements drop it.
  alter table auth.profile_items drop constraint profile_items_target;
  alter table auth.profile_items add constraint profile_items_target
    check ((workspace_id is null) = (page_id is null and form_id is null)) not valid;
  delete from auth.profile_items where user_id = '${userId}';
  delete from auth.public_profiles where user_id = '${userId}';
  delete from auth.public_handles where user_id = '${userId}';
  insert into auth.public_handles (handle, user_id) values ('${first}', '${userId}'), ('${second}', '${userId}');
  insert into auth.public_profiles (user_id, handle, bio) values ('${userId}', '${second}', 'hi');
  insert into auth.profile_items (id, user_id, kind, position, data, workspace_id, page_id) values
    ('${newId()}', '${userId}', 'link', 0, '{"title":"Site","url":"https://ada.dev"}', null, null),
    ('${newId()}', '${userId}', 'page', 1, '{}', '${quiet.workspaceId}', '${stray.id}'),
    ('${newId()}', '${userId}', 'heading', 2, '{"title":"Meet"}', null, null),
    ('${newId()}', '${userId}', 'page', 3, '{}', '${busy.workspaceId}', '${one.id}');
  insert into auth.profile_views (user_id, day, visitor, views) values ('${userId}', '${day}', '${visitor}', 2);
  insert into auth.profile_view_days (user_id, day, views, visitors) values ('${userId}', '${day}', 2, 1);
  ${beforeBackfill()}
  ${backfillBlock()};
  select json_build_object(
    'handles', (select json_agg(workspace_id::text) from auth.public_handles where user_id = '${userId}'),
    'profile', (select workspace_id::text from auth.public_profiles where user_id = '${userId}'),
    'items', (select json_agg(json_build_object('kind', kind, 'workspace', workspace_id::text, 'position', position) order by position)
      from auth.profile_items where user_id = '${userId}'),
    'views', (select json_agg(workspace_id::text) from auth.profile_views where user_id = '${userId}'))
  into before_run;
  ${backfillBlock()};
  select json_build_object(
    'handles', (select json_agg(workspace_id::text) from auth.public_handles where user_id = '${userId}'),
    'profile', (select workspace_id::text from auth.public_profiles where user_id = '${userId}'),
    'items', (select json_agg(json_build_object('kind', kind, 'workspace', workspace_id::text, 'position', position) order by position)
      from auth.profile_items where user_id = '${userId}'),
    'views', (select json_agg(workspace_id::text) from auth.profile_views where user_id = '${userId}'),
    'again', before_run)
  into result;
  raise exception using errcode = 'P0001', message = 'RESULT:' || result::text;
end
$stage$;`;
    let outcome: Outcome | undefined;
    try {
      await testQuery(ownerUrl, sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.startsWith('RESULT:')) throw error;
      outcome = JSON.parse(message.slice('RESULT:'.length)) as Outcome;
    }
    expect(outcome).toBeDefined();
    if (outcome === undefined) return;
    // Both handles, the profile and the views moved to the busy workspace together.
    expect(outcome.handles).toEqual([busy.workspaceId, busy.workspaceId]);
    expect(outcome.profile).toBe(busy.workspaceId);
    expect(outcome.views).toEqual([busy.workspaceId]);
    // The link and the heading went with them; the quiet workspace's page block is gone; the places closed up.
    expect(outcome.items).toEqual([
      { kind: 'link', workspace: busy.workspaceId, position: 0 },
      { kind: 'heading', workspace: busy.workspaceId, position: 1 },
      { kind: 'page', workspace: busy.workspaceId, position: 2 },
    ]);
    // A second run changes nothing (every step is guarded).
    expect(outcome.again).toEqual({
      handles: outcome.handles,
      profile: outcome.profile,
      items: outcome.items,
      views: outcome.views,
    });
  });
});
