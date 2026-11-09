// Team link pages (spec 0070, slice 1), against the real Postgres: the list for owners, admins and holders of
// `link_pages.manage_team` only; a member's page edited through the door's `enterTeamLinkPage` stays theirs and never
// goes live on its own; every such change is in History and the member reads "Edited by"; a handle claimed for
// someone; and nobody without the permission, nobody from another workspace and no guest reaches a page.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterTeamLinkPage, isTeamPageEdit } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { getMyProfile, showMyLinkPage, updateMyMemberProfile } from '../members/profile.ts';
import { testScope } from '../testing.ts';
import { readProfileItems, saveProfileItem } from './items.ts';
import { claimTeamHandle, listTeamLinkPages, monthOf, readLinkPageEditedBy } from './team-pages.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-team-pages-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A workspace its owner Ada made, with her own identity. */
async function workspace() {
  count += 1;
  const userId = randomUUID();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, 'Ada', $2)`, [
    userId,
    `${userId}@example.com`,
  ]);
  const created = await createWorkspace(db, {
    name: 'Team pages',
    slug: `team-pages-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: `${userId}@example.com`, userId },
  });
  const scope = testScope({
    db,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
    userId,
  });
  return { ...created, userId, scope };
}

/** Another person in `workspaceId` with their own identity and `role`, and their scope. */
async function teammate(workspaceId: string, name: string, role: 'admin' | 'member' | 'guest') {
  const userId = randomUUID();
  const memberId = newId();
  await testQuery(ownerUrl, `insert into auth."user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, name, email, role, user_id, created_by_type, updated_by_type)
     values ($1, $2, $3, $4, $5, $6, 'system', 'system')`,
    [workspaceId, memberId, name, `${userId}@example.com`, role, userId],
  );
  const scope = testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role, userId });
  return { memberId, userId, scope };
}

const handle = () => `team-${randomUUID().slice(0, 8)}`;

async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string } | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (isRefusal(error)) return { code: error.refusal.code, message: error.refusal.message };
    throw error;
  }
}

describe('who may manage team pages (AC-7001)', () => {
  it('lists every member but guests for an owner and an admin, and refuses a member', async () => {
    const ada = await workspace();
    const bea = await teammate(ada.workspaceId, 'Bea', 'admin');
    const cy = await teammate(ada.workspaceId, 'Cy', 'member');
    await teammate(ada.workspaceId, 'Gus', 'guest');
    const own = handle();
    await updateMyMemberProfile(cy.scope, { handle: own });

    const listed = await listTeamLinkPages(ada.scope);
    expect(listed.pages.map((page) => page.name)).toEqual(['Ada', 'Bea', 'Cy']);
    expect(listed.pages.find((page) => page.name === 'Cy')).toMatchObject({ handle: own, isLive: true, views: 0 });
    expect(listed.pages.find((page) => page.name === 'Ada')?.isSelf).toBe(true);
    expect((await listTeamLinkPages(bea.scope)).pages).toHaveLength(3);

    // An admin manages everyone's page but an owner's (the owner rules): Ada's is hers and other owners'.
    expect(await refusalOf(enterTeamLinkPage(bea.scope, ada.memberId))).toMatchObject({ code: 'FORBIDDEN' });
    expect(isTeamPageEdit(await enterTeamLinkPage(bea.scope, cy.memberId))).toBe(true);

    expect(await refusalOf(listTeamLinkPages(cy.scope))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(enterTeamLinkPage(cy.scope, bea.memberId))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('counts the month in UTC', () => {
    expect(monthOf(new Date('2026-02-14T23:30:00Z'))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthOf(new Date('2026-12-31T23:59:59Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe("someone else's page (AC-7002, AC-7004)", () => {
  it('edits the member’s own page, which stays theirs and private, with History and "Edited by"', async () => {
    const ada = await workspace();
    const cy = await teammate(ada.workspaceId, 'Cy', 'member');
    const own = handle();
    await updateMyMemberProfile(cy.scope, { handle: own });
    // Cy turns their page Private: a manager's edit never puts it back live.
    await showMyLinkPage(cy.scope, false);

    const page = await enterTeamLinkPage(ada.scope, cy.memberId);
    expect(isTeamPageEdit(page)).toBe(true);
    expect(isTeamPageEdit(ada.scope)).toBe(false);
    const id = newId();
    await saveProfileItem(page, { id, block: { kind: 'link', title: 'Site', url: 'https://cy.example' } });

    // The block is on Cy's own page, and not on Ada's.
    expect((await readProfileItems(cy.scope)).items.map((item) => item.id)).toEqual([id]);
    expect((await readProfileItems(ada.scope)).items.map((item) => item.id)).not.toContain(id);
    expect((await getMyProfile(page)).handle).toBe(own);
    expect((await getMyProfile(cy.scope)).isPublic).toBe(false);
    // Opening it as a manager reads where it stands and changes nothing.
    expect(await showMyLinkPage(page)).toEqual({ isPublic: false });
    expect((await getMyProfile(cy.scope)).isPublic).toBe(false);

    const rows = await testQuery<{ action: string; actor_member_id: string; target_id: string; after: unknown }>(
      ownerUrl,
      `select action, actor_member_id, target_id, after from audit_events where workspace_id = $1 and action = 'link_page.changed_for'`,
      [ada.workspaceId],
    );
    expect(rows).toEqual([
      {
        action: 'link_page.changed_for',
        actor_member_id: ada.memberId,
        target_id: cy.memberId,
        after: { change: 'blocks' },
      },
    ]);
    expect(await readLinkPageEditedBy(cy.scope)).toMatchObject({ last: { name: 'Ada' } });
    expect(await readLinkPageEditedBy(ada.scope)).toEqual({});
    // A page scope holds no permission of its own: it can't reach the list, or another page.
    expect(await refusalOf(listTeamLinkPages(page))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(enterTeamLinkPage(page, ada.memberId))).toMatchObject({ code: 'FORBIDDEN' });
    // Cy's own edits write no History row of this kind: the row is for someone else's change.
    await saveProfileItem(cy.scope, {
      id: newId(),
      block: { kind: 'link', title: 'Blog', url: 'https://cy.example/b' },
    });
    const after = await testQuery(
      ownerUrl,
      `select 1 from audit_events where workspace_id = $1 and action = 'link_page.changed_for'`,
      [ada.workspaceId],
    );
    expect(after).toHaveLength(1);
  });

  it('answers NOT_FOUND alike for another workspace’s member, a guest, a stranger and a removed member', async () => {
    const ada = await workspace();
    const other = await workspace();
    const elsewhere = await teammate(other.workspaceId, 'Eve', 'member');
    const gus = await teammate(ada.workspaceId, 'Gus', 'guest');
    const gone = await teammate(ada.workspaceId, 'Rae', 'member');
    await testQuery(ownerUrl, `update members set status = 'removed' where workspace_id = $1 and id = $2`, [
      ada.workspaceId,
      gone.memberId,
    ]);
    for (const memberId of [elsewhere.memberId, other.memberId, gus.memberId, gone.memberId, newId(), 'not-a-uuid']) {
      expect(await refusalOf(enterTeamLinkPage(ada.scope, memberId))).toEqual({
        code: 'NOT_FOUND',
        message: 'That person isn’t in this workspace.',
      });
    }
    // Naming yourself is your own page, unchanged.
    expect(await enterTeamLinkPage(ada.scope, ada.memberId)).toBe(ada.scope);
  });
});

describe('a handle claimed for someone (AC-7002)', () => {
  it('claims a private page for a member with none, writes History, and refuses a second claim', async () => {
    const ada = await workspace();
    const cy = await teammate(ada.workspaceId, 'Cy', 'member');
    const wanted = handle();
    const claimed = await claimTeamHandle(ada.scope, { member: cy.memberId, handle: wanted });
    expect(claimed).toMatchObject({ memberId: cy.memberId, handle: wanted, isLive: false, isSelf: false });
    expect((await getMyProfile(cy.scope)).handle).toBe(wanted);
    const rows = await testQuery<{ after: unknown }>(
      ownerUrl,
      `select after from audit_events where workspace_id = $1 and action = 'link_page.changed_for' and target_id = $2`,
      [ada.workspaceId, cy.memberId],
    );
    expect(rows).toEqual([{ after: { change: 'handle', handle: wanted } }]);
    expect(await refusalOf(claimTeamHandle(ada.scope, { member: cy.memberId, handle: handle() }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect(await refusalOf(claimTeamHandle(cy.scope, { member: ada.memberId, handle: handle() }))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
