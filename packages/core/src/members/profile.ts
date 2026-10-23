// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own
// member profile in one workspace, their name there and their time zone. The
// change is the caller's own row only, written with its audit row and a
// `members` outbox row, so other members' screens read the name again.
// The handle and bio (22 Oct 2026) are the person's, the same in every
// workspace: they live in schema auth, read and claimed through `booking/handles.ts`.
// So is whether their picture shows on their public pages (owner ask A124,
// 23 Oct 2026), read and set through `booking/picture-choice.ts`.
import { BIO_MAX, handleProblem, type MyProfile, type UpdateMyProfileInput } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq } from 'drizzle-orm';
import { checkScope } from '../access/mint.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';
import { publicProfilesOf, savePublicProfile, suggestHandle } from '../booking/handles.ts';
import { isPictureHidden, savePictureHidden } from '../booking/picture-choice.ts';
import { touched } from '../engine/definitions.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit, type AuditSource } from './audit.ts';

const { members, workspaces } = schema;

/** What only the session knows about the caller. */
export interface ProfileExtras {
  /** The account's Google picture as our own origin serves it (`/api/me/picture?v=`), when it has one. */
  readonly image?: string | undefined;
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
      avatarUrl: members.avatarUrl,
      workspaceTimeZone: workspaces.timeZone,
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
  const held = userId === undefined ? undefined : (await publicProfilesOf(tx, [userId])).get(userId);
  // While they have no handle, the field starts from a free one made from their name.
  const suggested = held === undefined && userId !== undefined ? await suggestHandle(tx, row.name) : undefined;
  // The person's choice; a member with no identity of their own has none to make.
  const pictureHidden = userId === undefined ? undefined : await isPictureHidden(tx, userId);
  return {
    memberId,
    name: row.name,
    email: row.email,
    workspaceTimeZone: row.workspaceTimeZone,
    ...(row.timeZone === null ? {} : { timeZone: row.timeZone }),
    ...(image === undefined ? {} : { image }),
    ...(held === undefined ? {} : { handle: held.handle }),
    ...(suggested === undefined ? {} : { suggestedHandle: suggested }),
    bio: held?.bio ?? '',
    ...(pictureHidden === undefined ? {} : { pictureHidden }),
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
 * (`pictureHidden`), are the person's, in every workspace. A change
 * that changes nothing writes nothing. Otherwise one audit row with only the
 * changed fields, and a `members` outbox row so other members' screens read
 * the name again.
 */
export async function updateMyMemberProfile(
  scope: EngineScope,
  input: Pick<UpdateMyProfileInput, 'name' | 'timeZone' | 'handle' | 'bio' | 'pictureHidden'> = {},
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
        await savePublicProfile(tx, userId, nextHandle, bio ?? now.bio);
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
      if (Object.keys(after).length === 0) return now;
      if (after.name !== undefined || 'timeZone' in after) {
        await tx
          .update(members)
          .set({
            ...(name === undefined || after.name === undefined ? {} : { name }),
            ...('timeZone' in after ? { timeZone: zone ?? null } : {}),
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
