// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own
// member profile in one workspace, their name there and their time zone. The
// change is the caller's own row only, written with its audit row and a
// `members` outbox row, so other members' screens read the name again.
// The handle and bio (22 Oct 2026) are the person's, the same in every
// workspace: they live in schema auth, read and claimed through `booking/handles.ts`.
// So is whether their picture shows on their public pages (owner ask A124,
// 23 Oct 2026), read and set through `booking/picture-choice.ts`, and their social links (25 Oct 2026), through
// `booking/socials.ts`.
import {
  BIO_MAX,
  FOOT_LINE_MAX,
  JOB_TITLE_MAX,
  checkProfileSite,
  handleProblem,
  profileSharePath,
  type MyProfile,
  type UpdateMyProfileInput,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq } from 'drizzle-orm';
import { checkScope } from '../access/mint.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';
import {
  profileHandlesOf,
  publicProfilesOf,
  savePublicProfile,
  setLinkPageLive,
  showLinkPage,
  suggestHandle,
} from '../booking/handles.ts';
import { isPictureHidden, savePictureHidden } from '../booking/picture-choice.ts';
import { checkedSocialLinks, sameSocialLinks, saveSocialLinks, socialLinksOfUser } from '../booking/socials.ts';
import { touched } from '../engine/definitions.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { identityOf, saveIdentity, type ProfileIdentity } from '../profile/identity.ts';
import { writeAudit, type AuditSource } from './audit.ts';

const { members, workspaces } = schema;

/** What only the session knows about the caller. */
export interface ProfileExtras {
  /** The account's Google picture as our own origin serves it (`/api/me/picture?v=`), when it has one. */
  readonly image?: string | undefined;
  /** Whether the account has Google linked, for Sync Google photo; undefined where Google sign in is off. */
  readonly google?: 'linked' | 'unlinked' | undefined;
}

/** The caller's member id, or a refusal: only a member has a profile. */
function selfId(scope: EngineScope): string {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member has a profile.');
  return principal.memberId;
}

/** The caller's identity, which their handle belongs to; a member made without one has none. */
function selfUserId(scope: EngineScope): string | undefined {
  const { principal } = scope.access;
  return principal.kind === 'member' ? principal.userId : undefined;
}

/** A picture we may show: an https address, or nothing (initials on a colour). */
function safeImage(image: string | undefined): string | undefined {
  if (image === undefined) return undefined;
  try {
    return new URL(image).protocol === 'https:' ? image : undefined;
  } catch {
    return undefined;
  }
}

async function readProfile(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
  extras: ProfileExtras,
  lock: boolean,
): Promise<MyProfile> {
  const query = tx
    .select({
      name: members.name,
      email: members.email,
      timeZone: members.timeZone,
      jobTitle: members.jobTitle,
      avatarUrl: members.avatarUrl,
      workspaceTimeZone: workspaces.timeZone,
      workspaceName: workspaces.name,
    })
    .from(members)
    .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId), eq(members.status, 'active')));
  const [row] = lock ? await query.for('update', { of: members }) : await query;
  // The door let them in a moment ago; removed since, they are no member here.
  if (row === undefined) throw refuse('NOT_FOUND', "That workspace doesn't exist, or you're not a member of it.");
  // The account's picture as our own origin serves it (the api's path), else the member's own https one.
  const image = extras.image ?? safeImage(row.avatarUrl ?? undefined);
  const userId = selfUserId(scope);
  const held = userId === undefined ? undefined : (await publicProfilesOf(tx, scope.workspaceId, [userId])).get(userId);
  // While they have no handle, the field starts from a free one made from their name.
  const suggested = held === undefined && userId !== undefined ? await suggestHandle(tx, row.name) : undefined;
  // The person's choice; a member with no identity of their own has none to make.
  const pictureHidden = userId === undefined ? undefined : await isPictureHidden(tx, userId);
  const socials = userId === undefined ? undefined : await socialLinksOfUser(tx, userId);
  // Who their link page belongs to (3 Nov 2026): read with the page, so none without a handle.
  const identity =
    userId === undefined || held === undefined ? undefined : await identityOf(tx, userId, scope.workspaceId);
  // The person's link pages in their other workspaces (spec 0056, AC-5618), as ids. Not named here: a workspace's
  // name belongs to the directory, which is global identity, and a member handler has none (`orpc.ts`'s door takes
  // it away). The browser already holds every workspace it belongs to, from `me.get`, so it names these itself.
  const others =
    userId === undefined || held !== undefined
      ? []
      : (await profileHandlesOf(tx, userId)).flatMap((each) =>
          each.workspaceId === scope.workspaceId ? [] : [{ workspaceId: each.workspaceId }],
        );
  return {
    memberId,
    name: row.name,
    email: row.email,
    workspaceTimeZone: row.workspaceTimeZone,
    workspaceName: row.workspaceName,
    ...(others.length === 0 ? {} : { otherLinkPages: others }),
    ...(row.timeZone === null ? {} : { timeZone: row.timeZone }),
    ...(row.jobTitle === null ? {} : { jobTitle: row.jobTitle }),
    ...(image === undefined ? {} : { image }),
    ...(extras.google === undefined ? {} : { google: extras.google }),
    ...(held === undefined ? {} : { handle: held.handle }),
    ...(suggested === undefined ? {} : { suggestedHandle: suggested }),
    bio: held?.bio ?? '',
    ...(pictureHidden === undefined ? {} : { pictureHidden }),
    ...(socials === undefined ? {} : { socials: [...socials] }),
    ...(held === undefined ? {} : { theme: held.theme, indexable: held.indexable, isPublic: held.isShown }),
    ...(identity === undefined
      ? {}
      : {
          showJobTitle: identity.showJobTitle,
          ...(identity.site === undefined ? {} : { site: identity.site }),
          ...(identity.footLine === undefined ? {} : { footLine: identity.footLine }),
        }),
    // The picture a pasted link to their page shows instead of the drawn card (AC-5511): the path our own origin
    // serves it from, so the editor draws exactly what a visitor's link preview will.
    ...(held?.shareImageVersion === undefined
      ? {}
      : { shareImage: profileSharePath(held.handle, held.shareImageVersion) }),
  };
}

/** The caller's own profile in this workspace (any active member, themself only). */
export async function getMyProfile(scope: EngineScope, extras: ProfileExtras = {}): Promise<MyProfile> {
  const memberId = selfId(scope);
  return inWorkspace(scope, (tx) => readProfile(tx, scope, memberId, extras, false));
}

/**
 * Changes the caller's own name (1 to 80 characters) and time zone in this
 * workspace (AC-821): `timeZone` null goes back to the workspace's. Their
 * handle and bio, and whether their picture shows on their public pages
 * (`pictureHidden`), and their social links (`socials`, the whole set in order), are the person's, in every
 * workspace. A change
 * that changes nothing writes nothing. Otherwise one audit row with only the
 * changed fields, and a `members` outbox row so other members' screens read
 * the name again.
 */
export async function updateMyMemberProfile(
  scope: EngineScope,
  input: Pick<
    UpdateMyProfileInput,
    | 'name'
    | 'timeZone'
    | 'jobTitle'
    | 'handle'
    | 'bio'
    | 'pictureHidden'
    | 'socials'
    | 'showJobTitle'
    | 'site'
    | 'footLine'
  > = {},
  extras: ProfileExtras = {},
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<MyProfile> {
  const memberId = selfId(scope);
  const name = input.name?.trim();
  if (name !== undefined && (name.length < 1 || name.length > 80)) {
    throw refuse('CONFIG_INVALID', 'Use 1 to 80 characters for your name.');
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const now = await readProfile(tx, scope, memberId, extras, true);
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      if (name !== undefined && name !== now.name) {
        before.name = now.name;
        after.name = name;
      }
      const zone = input.timeZone === undefined ? undefined : (input.timeZone ?? null);
      if (zone !== undefined && zone !== (now.timeZone ?? null)) {
        before.timeZone = now.timeZone ?? null;
        after.timeZone = zone;
      }
      // Their job title (spec 0037, AC-1441): a label in this workspace, empty clears it.
      const title =
        input.jobTitle === undefined ? undefined : input.jobTitle.trim() === '' ? null : input.jobTitle.trim();
      if (title !== undefined && title !== null && (title.length > JOB_TITLE_MAX || /[\r\n]/.test(title))) {
        throw refuseOn(
          'CONFIG_INVALID',
          `Keep the job title to one line of ${String(JOB_TITLE_MAX)} characters.`,
          'jobTitle',
        );
      }
      if (title !== undefined && title !== (now.jobTitle ?? null)) {
        before.jobTitle = now.jobTitle ?? null;
        after.jobTitle = title;
      }
      // The handle and bio: the person's, in schema auth. An old handle keeps finding them.
      const wanted = input.handle?.trim().toLowerCase();
      const handle = wanted === undefined || wanted === now.handle ? undefined : wanted;
      const given = input.bio?.trim();
      const bio = given === undefined || given === now.bio ? undefined : given;
      // The contract checks both at the boundary; a caller in core gets the same refusals.
      const handleWrong = handle === undefined ? undefined : handleProblem(handle);
      if (handleWrong !== undefined) throw refuseOn('CONFIG_INVALID', handleWrong, 'handle');
      if (bio !== undefined && (bio.length > BIO_MAX || /[\r\n]/.test(bio))) {
        throw refuseOn('CONFIG_INVALID', `Keep your bio to one line of ${String(BIO_MAX)} characters.`, 'bio');
      }
      if (handle !== undefined || bio !== undefined) {
        const userId = selfUserId(scope);
        if (userId === undefined) throw refuseOn('FORBIDDEN', 'Only a signed in person has a handle.', 'handle');
        const nextHandle = handle ?? now.handle;
        if (nextHandle === undefined) throw refuseOn('VALUE_REQUIRED', 'Pick a handle first.', 'handle');
        await savePublicProfile(tx, userId, scope.workspaceId, nextHandle, bio ?? now.bio);
        if (handle !== undefined) {
          before.handle = now.handle ?? null;
          after.handle = handle;
        }
        if (bio !== undefined) {
          before.bio = now.bio;
          after.bio = bio;
        }
      }
      // Their picture on their public pages: the person's, in schema auth, like the handle. Only for themself.
      if (input.pictureHidden !== undefined && input.pictureHidden !== now.pictureHidden) {
        const userId = selfUserId(scope);
        if (userId === undefined) {
          throw refuseOn('FORBIDDEN', 'Only a signed in person has a photo to hide.', 'pictureHidden');
        }
        await savePictureHidden(tx, userId, input.pictureHidden);
        before.pictureHidden = now.pictureHidden ?? false;
        after.pictureHidden = input.pictureHidden;
      }
      // Their social links: the person's, in schema auth, the whole set at once. Only for themself.
      if (input.socials !== undefined) {
        const socials = checkedSocialLinks(input.socials);
        const held = now.socials ?? [];
        if (!sameSocialLinks(socials, held)) {
          const userId = selfUserId(scope);
          if (userId === undefined) {
            throw refuseOn('FORBIDDEN', 'Only a signed in person has social links.', 'socials');
          }
          await saveSocialLinks(tx, userId, socials);
          before.socials = held.map((link) => link.href);
          after.socials = socials.map((link) => link.href);
        }
      }
      // Who their link page belongs to (3 Nov 2026): the person's choices on this workspace's page, in schema auth,
      // written whole through the one definer. The contract checks the address and the line; checked again here.
      if (input.showJobTitle !== undefined || input.site !== undefined || input.footLine !== undefined) {
        const held: ProfileIdentity = {
          showJobTitle: now.showJobTitle ?? false,
          ...(now.site === undefined ? {} : { site: now.site }),
          ...(now.footLine === undefined ? {} : { footLine: now.footLine }),
        };
        // The contract checks the address at the boundary; a caller in core gets the same check, and what is kept
        // is always the checked form (`ada.dev` becomes `https://ada.dev/`), never the words as typed.
        const typed = input.site?.trim();
        let site = held.site;
        if (typed !== undefined) {
          if (typed === '') site = undefined;
          else {
            const checked = checkProfileSite(typed);
            if (!checked.ok) throw refuseOn('CONFIG_INVALID', checked.message, 'site');
            site = checked.value;
          }
        }
        const foot =
          input.footLine === undefined
            ? held.footLine
            : input.footLine.trim() === ''
              ? undefined
              : input.footLine.trim();
        if (foot !== undefined && (foot.length > FOOT_LINE_MAX || /[\r\n]/.test(foot))) {
          throw refuseOn('CONFIG_INVALID', `Keep the line to ${String(FOOT_LINE_MAX)} characters.`, 'footLine');
        }
        const show = input.showJobTitle ?? held.showJobTitle;
        if (show !== held.showJobTitle || site !== held.site || foot !== held.footLine) {
          const userId = selfUserId(scope);
          if (userId === undefined || now.handle === undefined) {
            throw refuseOn('VALUE_REQUIRED', 'Pick a handle first.', 'handle');
          }
          await saveIdentity(tx, userId, scope.workspaceId, {
            showJobTitle: show,
            ...(site === undefined ? {} : { site }),
            ...(foot === undefined ? {} : { footLine: foot }),
          });
          if (show !== held.showJobTitle) {
            before.showJobTitle = held.showJobTitle;
            after.showJobTitle = show;
          }
          if (site !== held.site) {
            before.site = held.site ?? null;
            after.site = site ?? null;
          }
          if (foot !== held.footLine) {
            before.footLine = held.footLine ?? null;
            after.footLine = foot ?? null;
          }
        }
      }
      // A handle its owner claims is live at once, as on Linktree (spec 0058, AC-23): a new one, or the one made for
      // them, which first run's Your link page claims by sending it unchanged. A page they set Private stays so
      // (`showLinkPage` never overrules their switch). Nothing else here shows the page: a name, a time zone, a bio or
      // a photo choice made in Settings is not someone opening their link page.
      const claimant = input.handle === undefined ? undefined : selfUserId(scope);
      if (Object.keys(after).length === 0) {
        if (claimant === undefined || now.isPublic !== false) return now;
        return { ...now, isPublic: await showLinkPage(tx, claimant, scope.workspaceId) };
      }
      if (claimant !== undefined) await showLinkPage(tx, claimant, scope.workspaceId);
      if (after.name !== undefined || 'timeZone' in after || 'jobTitle' in after) {
        await tx
          .update(members)
          .set({
            ...(name === undefined || after.name === undefined ? {} : { name }),
            ...('timeZone' in after ? { timeZone: zone ?? null } : {}),
            ...('jobTitle' in after ? { jobTitle: title ?? null } : {}),
            ...touched(scope),
          })
          .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId)));
      }
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        { action: 'member.profile_updated', targetType: 'member', targetId: memberId, before, after },
        source,
      );
      context.record({ members: [memberId] });
      return readProfile(tx, scope, memberId, extras, false);
    },
    hooks,
  );
  return result;
}

/**
 * The caller's own link page in this workspace, Live or Private (spec 0058, AC-23). With no `live`, they opened it:
 * a page made for them that nobody has chosen for goes live, once, and one they set Private stays so. With `live`,
 * it is their Live or Private switch. Answers whether the page is public now; false when they have no page here.
 */
export async function showMyLinkPage(scope: EngineScope, live?: boolean): Promise<{ readonly isPublic: boolean }> {
  const userId = selfUserId(scope);
  if (userId === undefined) return { isPublic: false };
  return {
    isPublic: await inWorkspace(scope, (tx) =>
      live === undefined
        ? showLinkPage(tx, userId, scope.workspaceId)
        : setLinkPageLive(tx, userId, scope.workspaceId, live),
    ),
  };
}
