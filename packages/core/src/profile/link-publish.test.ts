// Publish for link pages (spec 0068, AC-6810 to AC-6813), against the real Postgres: an edit is a draft guests never
// see until Publish; Publish keeps a version and an audit row; Discard and Restore put the rows back; and each of
// crm_handle's new definers refuses another workspace, a non member and the app calling past them.
import { randomUUID } from 'node:crypto';
import type { ProfileBlock } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { enterLinkPage } from '../access/door.ts';
import { readLinkPage } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { saveProfileItem, saveProfileTheme } from './items.ts';
import {
  discardLinkDraft,
  listLinkPageVersions,
  publishLinkPage,
  readLinkPagePublication,
  restoreLinkPageVersion,
} from './link-publish.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-link-publish-tests' });
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
    slug: `link-publish-${String(count)}-${String(Date.now())}`,
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

const link = (title: string): ProfileBlock => ({
  kind: 'link',
  title,
  url: `https://northwind.com/${encodeURIComponent(title.toLowerCase().replaceAll(' ', '-').replaceAll(',', ''))}`,
});

/** What a visitor sees: the blocks' titles and the bio. */
async function guest(handle: string) {
  const found = await readLinkPage(await enterLinkPage({ db }, handle, { max: 21 }));
  return {
    bio: found.bio,
    titles: found.items.map((item) => ('title' in item ? item.title : item.kind)),
    template: found.theme.template,
  };
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal.code;
    if (typeof error === 'object' && error !== null && 'cause' in error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      if (cause?.code !== undefined) return cause.code;
    }
    if (typeof error === 'object' && error !== null && 'code' in error) return String(error.code);
    throw error;
  }
  throw new Error('It was let through.');
}

describe('a link page’s draft', () => {
  it('keeps every edit from guests until Publish, then shows them all at once', async () => {
    const ada = await person('Ada Lovelace');
    // A page made after the move has nothing published: guests see the page with nothing on it, never the draft.
    await saveProfileItem(ada.scope, { id: newId(), block: link('Shop') });
    await updateMyMemberProfile(ada.scope, { bio: 'Maker of engines' });
    expect(await guest(ada.handle)).toMatchObject({ bio: '', titles: [] });
    const waiting = await readLinkPagePublication(ada.scope);
    expect(waiting.changes).toEqual(['Bio changed', 'Added “Shop”']);
    expect(waiting.publishedAt).toBeUndefined();

    const published = await publishLinkPage(ada.scope);
    expect(published.publication.changes).toEqual([]);
    expect(await guest(ada.handle)).toMatchObject({ bio: 'Maker of engines', titles: ['Shop'] });

    // The next edit waits again, the look among them.
    await saveProfileItem(ada.scope, { id: newId(), block: link('Blog') });
    await saveProfileTheme(ada.scope, {
      ...(await import('@crm/contracts')).DEFAULT_PAGE_THEME,
      template: 'studio',
    });
    expect(await guest(ada.handle)).toMatchObject({ titles: ['Shop'] });
    expect((await guest(ada.handle)).template).toBeUndefined();
    expect((await readLinkPagePublication(ada.scope)).changes).toEqual(
      expect.arrayContaining(['Template Workspace’s → Studio', 'Added “Blog”']),
    );
    await publishLinkPage(ada.scope);
    expect(await guest(ada.handle)).toMatchObject({ titles: ['Shop', 'Blog'], template: 'studio' });

    // Versions, newest first, and one audit row per Publish.
    const versions = await listLinkPageVersions(ada.scope);
    expect(versions.versions.map((one) => one.version)).toEqual([2, 1]);
    expect(versions.versions[0]).toMatchObject({ isCurrent: true, publishedBy: 'Ada Lovelace' });
    const audit = await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute<{ action: string }>(sql`select action from audit_events where action like 'link_page.%' order by at`),
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['link_page.published', 'link_page.published']);
  });

  it('discards the draft back to what guests see, archiving a block added since', async () => {
    const ada = await person('Ada Lovelace');
    const shop = newId();
    await saveProfileItem(ada.scope, { id: shop, block: link('Shop') });
    await publishLinkPage(ada.scope);
    await saveProfileItem(ada.scope, { id: newId(), block: link('Blog') });
    await saveProfileItem(ada.scope, { id: shop, block: link('Shop, renamed'), isEdit: true });
    expect((await readLinkPagePublication(ada.scope)).changes).toEqual(['Changed “Shop, renamed”', 'Added “Blog”']);
    const discarded = await discardLinkDraft(ada.scope);
    expect(discarded.publication.changes).toEqual([]);
    expect(await guest(ada.handle)).toMatchObject({ titles: ['Shop'] });
    const audit = await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute<{ action: string }>(sql`select action from audit_events where action = 'link_page.draft_discarded'`),
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('restores an old version as the draft, which Publish puts back', async () => {
    const ada = await person('Ada Lovelace');
    await saveProfileItem(ada.scope, { id: newId(), block: link('One') });
    await publishLinkPage(ada.scope);
    await saveProfileItem(ada.scope, { id: newId(), block: link('Two') });
    await publishLinkPage(ada.scope);
    const restored = await restoreLinkPageVersion(ada.scope, 1);
    expect(restored.publication.changes).toEqual(['Removed “Two”']);
    // Restoring is a draft: guests still see version 2 until Publish.
    expect(await guest(ada.handle)).toMatchObject({ titles: ['One', 'Two'] });
    await publishLinkPage(ada.scope);
    expect(await guest(ada.handle)).toMatchObject({ titles: ['One'] });
    expect(await refusalOf(restoreLinkPageVersion(ada.scope, 99))).toBe('NOT_FOUND');
  });
});

describe('a draft’s Preview', () => {
  it('shows the draft to its signed in owner alone; anyone else asking gets the published page', async () => {
    const ada = await person('Ada Lovelace');
    const bea = await person('Bea Rao');
    await saveProfileItem(ada.scope, { id: newId(), block: link('Shop') });
    await publishLinkPage(ada.scope);
    await saveProfileItem(ada.scope, { id: newId(), block: link('Draft only') });
    const read = async (viewer?: string) => {
      const found = await enterLinkPage({ db }, ada.handle, {
        max: 21,
        draft: true,
        ...(viewer === undefined ? {} : { viewer }),
      });
      const page = await readLinkPage(found);
      return { isDraft: found.isDraft, titles: page.items.map((item) => ('title' in item ? item.title : item.kind)) };
    };
    expect(await read()).toEqual({ isDraft: false, titles: ['Shop'] });
    expect(await read(bea.userId)).toEqual({ isDraft: false, titles: ['Shop'] });
    expect(await read(ada.userId)).toEqual({ isDraft: true, titles: ['Shop', 'Draft only'] });
  });
});

describe('the link page definers', () => {
  it('refuse another workspace, a non member and a block of someone else’s', async () => {
    const ada = await person('Ada Lovelace');
    const bea = await person('Bea Rao');
    const theirs = newId();
    await saveProfileItem(bea.scope, { id: theirs, block: link('Private') });
    // Inside Ada's workspace, nothing of Bea's (in hers) can be published, restored, discarded or read.
    const call = (statement: ReturnType<typeof sql>) =>
      refusalOf(db.withWorkspace(ada.workspaceId, (tx) => tx.execute(statement)));
    expect(await call(sql`select crm_publish_link_page(${bea.userId}::uuid, ${bea.workspaceId}::uuid)`)).toBe('42501');
    expect(await call(sql`select crm_discard_link_draft(${bea.userId}::uuid, ${bea.workspaceId}::uuid)`)).toBe('42501');
    expect(
      await call(
        sql`select crm_restore_link_page(${bea.userId}::uuid, ${bea.workspaceId}::uuid, '{"items":[]}'::jsonb)`,
      ),
    ).toBe('42501');
    // Bea is no member of Ada's workspace: naming her there is refused too.
    expect(await call(sql`select crm_publish_link_page(${bea.userId}::uuid, ${ada.workspaceId}::uuid)`)).toBe('42501');
    const state = await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(sql`select * from crm_link_page_state(${bea.userId}::uuid, ${bea.workspaceId}::uuid)`),
    );
    expect(state.rows).toEqual([]);
    // The rows reader is the definers' alone.
    expect(await call(sql`select crm_link_page_rows(${ada.userId}::uuid, ${ada.workspaceId}::uuid)`)).toBe('42501');

    // A version naming Bea's block, restored onto Ada's page, never touches it: it isn't Ada's.
    await publishLinkPage(ada.scope);
    await db.withWorkspace(ada.workspaceId, (tx) =>
      tx.execute(
        sql`select crm_restore_link_page(${ada.userId}::uuid, ${ada.workspaceId}::uuid, ${JSON.stringify({
          bio: 'Taken over',
          items: [{ id: theirs, kind: 'link', data: { title: 'Hijacked', url: 'https://evil.com' } }],
        })}::jsonb)`,
      ),
    );
    await publishLinkPage(bea.scope);
    expect(await guest(bea.handle)).toMatchObject({ titles: ['Private'] });
    expect((await readLinkPagePublication(ada.scope)).changes).toEqual(['Bio changed']);
  });

  it('checks a restored block as a save does', async () => {
    const ada = await person('Ada Lovelace');
    const shop = newId();
    await saveProfileItem(ada.scope, { id: shop, block: link('Shop') });
    await publishLinkPage(ada.scope);
    const code = await refusalOf(
      db.withWorkspace(ada.workspaceId, (tx) =>
        tx.execute(
          sql`select crm_restore_link_page(${ada.userId}::uuid, ${ada.workspaceId}::uuid, ${JSON.stringify({
            items: [{ id: shop, kind: 'link', data: { title: 'Bad', url: 'javascript:alert(1)' } }],
          })}::jsonb)`,
        ),
      ),
    );
    expect(code).toBe('22023');
    expect(await guest(ada.handle)).toMatchObject({ titles: ['Shop'] });
  });
});
