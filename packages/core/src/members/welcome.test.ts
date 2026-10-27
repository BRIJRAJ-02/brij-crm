// A link page for every membership (26 Oct 2026, the owner: "create link page automatically as soon as someone
// signs up and also mention"), against a real Postgres as the app role: making a workspace and joining one each
// make the member's handle and empty page in the same transaction, unique with a short number, hidden from search
// engines, with a welcome email that names it; a second call changes nothing; a person who isn't a member gets
// none; and the definer refuses a base that isn't a handle.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { createTestUser, testQuery } from '@crm/db/testing';
import { enterContactCard, enterLinkBlocks, enterLinkPage, findHandleOwner } from '../access/door.ts';
import { ensureLinkPage } from '../booking/handles.ts';
import { isRefusal } from '../engine/refusals.ts';
import { archiveProfileItem, deleteProfileItem, saveProfileTheme } from '../profile/items.ts';
import { DEFAULT_PAGE_THEME } from '@crm/contracts';
import { showMyLinkPage, updateMyMemberProfile } from './profile.ts';
import { newId } from '../engine/ids.ts';
import { createUserWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { acceptInvite, setInviteLink } from './invitations.ts';

const { appUrl, identityUrl, ownerUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-welcome-tests' });
});
afterAll(async () => {
  await db.close();
});

const tag = () => newId().slice(-12);

async function person(name: string) {
  const email = `${tag()}@example.com`;
  const id = await createTestUser(identityUrl, { email, name });
  return { id, name, email, emailVerified: true };
}

async function workspaceOf(owner: { readonly id: string; readonly name: string; readonly email: string }) {
  const created = await createUserWorkspace(db, {
    id: newId(),
    name: 'Acme',
    slug: `acme-${tag()}`,
    firstMember: { userId: owner.id, name: owner.name, email: owner.email },
  });
  return { workspaceId: created.workspace.id, slug: created.workspace.slug, memberId: created.memberId };
}

const pageOf = (userId: string, workspaceId: string) =>
  testQuery<{ handle: string; bio: string; indexable: boolean }>(
    ownerUrl,
    'select handle, bio, indexable from auth.public_profiles where user_id = $1 and workspace_id = $2',
    [userId, workspaceId],
  );

const welcomeOf = (workspaceId: string, memberId: string) =>
  testQuery<{ kind: string; params: unknown }>(
    ownerUrl,
    `select kind, params from emails where workspace_id = $1 and to_member_id = $2 and kind = 'workspace_welcome'`,
    [workspaceId, memberId],
  );

describe('a link page for every membership', () => {
  it('is made with the workspace its owner makes, named in the welcome email, and kept out of search', async () => {
    // A name unique to this run, so the handle it makes is predictable.
    const stem = `ada-${tag()}`;
    const ada = await person(stem.replace('-', ' '));
    const w = await workspaceOf(ada);
    const [page] = await pageOf(ada.id, w.workspaceId);
    expect(page).toEqual({ handle: stem, bio: '', indexable: false });
    expect(await welcomeOf(w.workspaceId, w.memberId)).toEqual([
      {
        kind: 'workspace_welcome',
        params: {
          openPath: `/w/${w.slug}`,
          created: true,
          linkPage: { handle: stem, editPath: `/w/${w.slug}/link-page` },
        },
      },
    ]);
  });

  it('takes the next free number when the name’s handle is held', async () => {
    const stem = `grace-${tag()}`;
    const first = await person(stem.replace('-', ' '));
    const second = await person(stem.replace('-', ' '));
    const a = await workspaceOf(first);
    const b = await workspaceOf(second);
    expect((await pageOf(first.id, a.workspaceId))[0]?.handle).toBe(stem);
    expect((await pageOf(second.id, b.workspaceId))[0]?.handle).toBe(`${stem}-2`);
    // The same person's second workspace gets a page of its own, never the first one's handle.
    const another = await workspaceOf(first);
    expect((await pageOf(first.id, another.workspaceId))[0]?.handle).toBe(`${stem}-3`);
  });

  it('is made for someone who joins by the invite link, with their welcome', async () => {
    const owner = await person('Owner');
    const w = await workspaceOf(owner);
    const link = await setInviteLink(
      testScope({ db, workspaceId: w.workspaceId, actor: { type: 'member', id: w.memberId }, role: 'owner' }),
      { enabled: true },
    );
    const stem = `bea-${tag()}`;
    const bea = await person(stem.replace('-', ' '));
    const joined = await acceptInvite({ db }, bea, link.token ?? '');
    expect((await pageOf(bea.id, w.workspaceId))[0]?.handle).toBe(stem);
    const [welcome] = await welcomeOf(w.workspaceId, joined.memberId);
    expect(welcome?.params).toMatchObject({ linkPage: { handle: stem } });
  });

  it('answers the handle already held, and nothing for someone who isn’t a member', async () => {
    const ada = await person(`Cy ${tag()}`);
    const w = await workspaceOf(ada);
    const [held] = await pageOf(ada.id, w.workspaceId);
    const again = await db.withWorkspace(w.workspaceId, (tx) =>
      ensureLinkPage(tx, { userId: ada.id, workspaceId: w.workspaceId, name: 'Someone Else', email: ada.email }),
    );
    expect(again).toBe(held?.handle);
    const stranger = await person(`Dee ${tag()}`);
    const none = await db.withWorkspace(w.workspaceId, (tx) =>
      ensureLinkPage(tx, {
        userId: stranger.id,
        workspaceId: w.workspaceId,
        name: stranger.name,
        email: stranger.email,
      }),
    );
    expect(none).toBeUndefined();
    expect(await pageOf(stranger.id, w.workspaceId)).toEqual([]);
  });

  it('makes nothing in another workspace than the transaction’s own, for a real member of it', async () => {
    const ada = await person(`Fay ${tag()}`);
    const mine = await workspaceOf(ada);
    const bob = await person(`Gus ${tag()}`);
    const theirs = await workspaceOf(bob);
    // Bob's page in his own workspace was made with it; drop it so only the cross-workspace call could make one.
    await testQuery(ownerUrl, 'delete from auth.public_profiles where user_id = $1', [bob.id]);
    await testQuery(ownerUrl, 'delete from auth.public_handles where user_id = $1', [bob.id]);
    const crossed = await db.withWorkspace(mine.workspaceId, (tx) =>
      ensureLinkPage(tx, { userId: bob.id, workspaceId: theirs.workspaceId, name: bob.name, email: bob.email }),
    );
    expect(crossed).toBeUndefined();
    expect(await pageOf(bob.id, theirs.workspaceId)).toEqual([]);
  });

  it('refuses a base that isn’t a handle, and the caller’s transaction carries on', async () => {
    const ada = await person(`Eve ${tag()}`);
    const w = await workspaceOf(ada);
    const answer = await db.withWorkspace(w.workspaceId, async (tx) => {
      const refused = await tx
        .transaction((savepoint) =>
          savepoint.execute(sql`select crm_ensure_public_profile(${ada.id}::uuid, ${w.workspaceId}::uuid, 'Bad Base')`),
        )
        .then(
          () => 'ran',
          (error: unknown) => (error as { cause?: { code?: string } }).cause?.code ?? 'thrown',
        );
      const still = await tx.execute<{ one: number }>(sql`select 1 as one`);
      return { refused, still: still.rows[0]?.one };
    });
    expect(answer).toEqual({ refused: '22023', still: 1 });
  });
});

/** The refusal code a call ended with, or `answered` when it let the read through. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return 'answered';
  } catch (error) {
    if (isRefusal(error)) return error.refusals[0]?.code ?? 'refused';
    throw error;
  }
}

const shownAt = async (userId: string, workspaceId: string) =>
  (
    await testQuery<{ shown: boolean }>(
      ownerUrl,
      'select shown_at is not null as shown from auth.public_profiles where user_id = $1 and workspace_id = $2',
      [userId, workspaceId],
    )
  )[0]?.shown;

// The owner, 27 Oct 2026: a page made for someone who never asked for one is private until they edit it or share
// it. Their name and Google photo at an address made from their name is not something to publish on their behalf.
describe('a page made with a membership, until its owner acts', () => {
  async function made() {
    const ada = await person(`Hedy ${tag()}`);
    const w = await workspaceOf(ada);
    const [page] = await pageOf(ada.id, w.workspaceId);
    if (page === undefined) throw new Error('No page was made.');
    const scope = testScope({
      db,
      workspaceId: w.workspaceId,
      actor: { type: 'member', id: w.memberId },
      userId: ada.id,
    });
    return { ada, w, handle: page.handle, scope };
  }

  it('answers nothing to anyone but its owner, and the owner sees it', async () => {
    const { ada, w, handle } = await made();
    expect(await shownAt(ada.id, w.workspaceId)).toBe(false);
    // Exactly as a handle nobody holds: the link page, its picture's owner read and its contact card.
    expect(await codeOf(enterLinkPage({ db }, handle, { max: 10 }))).toBe('NOT_FOUND');
    expect(await codeOf(findHandleOwner({ db }, handle))).toBe('NOT_FOUND');
    expect(await codeOf(enterContactCard({ db }, handle))).toBe('NOT_FOUND');
    // Signed in as somebody else changes nothing.
    expect(await codeOf(enterLinkPage({ db }, handle, { max: 10, viewer: newId() }))).toBe('NOT_FOUND');
    // Its owner, signed in, sees their own page.
    expect(await codeOf(enterLinkPage({ db }, handle, { max: 10, viewer: ada.id }))).toBe('answered');
    expect(await codeOf(findHandleOwner({ db }, handle, { viewer: ada.id }))).toBe('answered');
  });

  it('keeps its blocks (the icon route’s read) to its owner too', async () => {
    const { ada, handle } = await made();
    expect(await codeOf(enterLinkBlocks({ db }, handle, { max: 10 }))).toBe('NOT_FOUND');
    expect(await codeOf(enterLinkBlocks({ db }, handle, { max: 10, viewer: newId() }))).toBe('NOT_FOUND');
    expect(await codeOf(enterLinkBlocks({ db }, handle, { max: 10, viewer: ada.id }))).toBe('answered');
  });

  it('stays private when a stale tab archives or deletes a block that isn’t there', async () => {
    const { ada, w, scope } = await made();
    expect(await codeOf(deleteProfileItem(scope, newId()))).toBe('NOT_FOUND');
    expect(await codeOf(archiveProfileItem(scope, { id: newId(), archived: true }))).toBe('NOT_FOUND');
    expect(await shownAt(ada.id, w.workspaceId)).toBe(false);
  });

  it('goes public when its owner shares it, and stays public', async () => {
    const { ada, w, handle, scope } = await made();
    expect(await showMyLinkPage(scope)).toEqual({ isPublic: true });
    expect(await shownAt(ada.id, w.workspaceId)).toBe(true);
    expect(await codeOf(enterLinkPage({ db }, handle, { max: 10 }))).toBe('answered');
    // A second share is the same answer and changes nothing.
    expect(await showMyLinkPage(scope)).toEqual({ isPublic: true });
  });

  it('goes public with its owner’s first edit of the page, and not with a name or time zone alone', async () => {
    const { ada, w, handle, scope } = await made();
    // First run sets these for everyone, so they say nothing about wanting the page up.
    await updateMyMemberProfile(scope, { name: `Hedy L ${tag()}`, timeZone: 'Europe/Vienna' });
    expect(await shownAt(ada.id, w.workspaceId)).toBe(false);
    // Hiding their photo is asking for less to show, not for the page to go up.
    await updateMyMemberProfile(scope, { pictureHidden: true });
    expect(await shownAt(ada.id, w.workspaceId)).toBe(false);
    // Choosing a look is editing the page.
    await saveProfileTheme(scope, { ...DEFAULT_PAGE_THEME, hue: 'green' });
    expect(await shownAt(ada.id, w.workspaceId)).toBe(true);
    expect(await codeOf(enterLinkPage({ db }, handle, { max: 10 }))).toBe('answered');
  });

  it('shows with a bio, the profile says whether it is public, and the existing pages were already', async () => {
    const { ada, w, scope } = await made();
    const before = await updateMyMemberProfile(scope, { timeZone: 'Europe/Paris' });
    expect(before.isPublic).toBe(false);
    const after = await updateMyMemberProfile(scope, { bio: 'Inventor' });
    expect(after.isPublic).toBe(true);
    expect(await shownAt(ada.id, w.workspaceId)).toBe(true);
  });

  it('is never shown from another workspace’s transaction, nor for someone who isn’t a member there', async () => {
    const { ada, w } = await made();
    const other = await workspaceOf(await person(`Ivy ${tag()}`));
    const crossed = await db.withWorkspace(other.workspaceId, async (tx) => {
      const answer = await tx.execute<{ shown: boolean }>(
        sql`select crm_show_public_profile(${ada.id}::uuid, ${w.workspaceId}::uuid) as shown`,
      );
      return answer.rows[0]?.shown;
    });
    expect(crossed).toBe(false);
    // Ada in a workspace they aren't in: nothing to show, and nothing written.
    const stranger = await db.withWorkspace(other.workspaceId, async (tx) => {
      const answer = await tx.execute<{ shown: boolean }>(
        sql`select crm_show_public_profile(${ada.id}::uuid, ${other.workspaceId}::uuid) as shown`,
      );
      return answer.rows[0]?.shown;
    });
    expect(stranger).toBe(false);
    expect(await shownAt(ada.id, w.workspaceId)).toBe(false);
  });
});
