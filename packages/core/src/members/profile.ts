// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own
// member profile in one workspace, their name there and their time zone. The
// change is the caller's own row only, written with its audit row and a
// `members` outbox row, so other members' screens read the name again.
import type { MyProfile, UpdateMyProfileInput } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq } from 'drizzle-orm';
import { checkScope } from '../access/mint.ts';
import type { EngineScope } from '../engine/scope.ts';
import { inWorkspace } from '../access/run.ts';
import { touched } from '../engine/definitions.ts';
import { refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit, type AuditSource } from './audit.ts';

const { members, workspaces } = schema;

/** What only the session knows about the caller: the account's picture, from Google when it has one. */
export interface ProfileExtras {
  readonly image?: string | undefined;
}

/** The caller's member id, or a refusal: only a member has a profile. */
function selfId(scope: EngineScope): string {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member has a profile.');
  return principal.memberId;
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
  // The member's own picture (Google's, saved at sign in), else what the session knows.
  const image = safeImage(row.avatarUrl ?? undefined) ?? safeImage(extras.image);
  return {
    memberId,
    name: row.name,
    email: row.email,
    workspaceTimeZone: row.workspaceTimeZone,
    ...(row.timeZone === null ? {} : { timeZone: row.timeZone }),
    ...(image === undefined ? {} : { image }),
  };
}

/** The caller's own profile in this workspace (any active member, themself only). */
export async function getMyProfile(scope: EngineScope, extras: ProfileExtras = {}): Promise<MyProfile> {
  const memberId = selfId(scope);
  return inWorkspace(scope, (tx) => readProfile(tx, scope, memberId, extras, false));
}

/**
 * Changes the caller's own name (1 to 80 characters) and time zone in this
 * workspace (AC-821): `timeZone` null goes back to the workspace's. A change
 * that changes nothing writes nothing. Otherwise one audit row with only the
 * changed fields, and a `members` outbox row so other members' screens read
 * the name again.
 */
export async function updateMyMemberProfile(
  scope: EngineScope,
  input: Pick<UpdateMyProfileInput, 'name' | 'timeZone'> = {},
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
      if (Object.keys(after).length === 0) return now;
      await tx
        .update(members)
        .set({
          ...(name === undefined || after.name === undefined ? {} : { name }),
          ...('timeZone' in after ? { timeZone: zone ?? null } : {}),
          ...touched(scope),
        })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId)));
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
