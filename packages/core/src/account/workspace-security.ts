// A workspace's sign in rules (spec 0033, milestone 4, AC-893 to AC-895,
// AC-899): require two factor, how long a sign in lasts here, and signing
// everyone out. One `workspace_security` row per workspace, made the first
// time an owner changes a rule; the access door reads it beside the member
// (`door.ts`). Reading and changing the rules takes `security.manage`, which
// only owners hold. Every change writes an audit row in its own transaction.
import type { SessionLengthDays, WorkspaceSecurity } from '@crm/contracts';
import { schema, type Database, type IdentityStore, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { systemScope } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { actorRow } from '../engine/scope.ts';
import { refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';

const { members, workspaces, workspaceSecurity } = schema;

/** What an owner without a second factor answers when they try to require one (AC-893). */
export const OWNER_NEEDS_TWO_FACTOR_MESSAGE = 'Set up two factor sign in for yourself first, then require it here.';

/** Who has a second factor (an authenticator app or a passkey), among these users: the identity store's answer. */
export type SecondFactorUsers = (userIds: readonly string[]) => Promise<ReadonlySet<string>>;

/** What reading or changing the rules needs beside the scope: who has a second factor, and whether the caller does. */
export interface WorkspaceSecurityDeps {
  readonly secondFactorUsers: SecondFactorUsers;
  /** Whether the person asking has a second factor. */
  readonly callerHasSecondFactor: () => Promise<boolean>;
}

/** A rules row as read, or none. */
interface RulesRow {
  readonly requireTwoFactor: boolean;
  readonly sessionLengthDays: number | null;
  readonly sessionsValidAfter: string | Date | null;
}

async function rulesOf(tx: WorkspaceTx, workspaceId: string, lock = false): Promise<RulesRow | undefined> {
  const query = tx
    .select({
      requireTwoFactor: workspaceSecurity.requireTwoFactor,
      sessionLengthDays: workspaceSecurity.sessionLengthDays,
      sessionsValidAfter: workspaceSecurity.sessionsValidAfter,
    })
    .from(workspaceSecurity)
    .where(eq(workspaceSecurity.workspaceId, workspaceId))
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/** The user ids of the workspace's active members (bounded by the plan's seats). */
async function memberUserIds(tx: WorkspaceTx, workspaceId: string): Promise<readonly string[]> {
  const rows = await tx
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.status, 'active')));
  return rows.flatMap((row) => (row.userId === null ? [] : [row.userId]));
}

const iso = (value: string | Date): string => new Date(value).toISOString();

/** The rules as the screen shows them, with the count of members who have no second factor yet. */
async function view(
  row: RulesRow | undefined,
  userIds: readonly string[],
  deps: WorkspaceSecurityDeps,
): Promise<WorkspaceSecurity> {
  const [withFactor, you] = await Promise.all([deps.secondFactorUsers(userIds), deps.callerHasSecondFactor()]);
  const days = row?.sessionLengthDays ?? null;
  return {
    requireTwoFactor: row?.requireTwoFactor ?? false,
    ...(days === null ? {} : { sessionLengthDays: days as SessionLengthDays }),
    ...(row?.sessionsValidAfter === null || row?.sessionsValidAfter === undefined
      ? {}
      : { signedOutEveryoneAt: iso(row.sessionsValidAfter) }),
    membersWithout: userIds.filter((id) => !withFactor.has(id)).length,
    youHaveTwoFactor: you,
  };
}

/** The workspace's sign in rules (Settings › Workspace › Security). Needs `security.manage`. */
export async function getWorkspaceSecurity(
  scope: EngineScope,
  _input: unknown,
  deps: WorkspaceSecurityDeps,
): Promise<WorkspaceSecurity> {
  requirePermission(scope, 'security.manage');
  const { row, userIds } = await inWorkspace(scope, async (tx) => ({
    row: await rulesOf(tx, scope.workspaceId),
    userIds: await memberUserIds(tx, scope.workspaceId),
  }));
  return view(row, userIds, deps);
}

/** A change to the rules: either or both; `sessionLengthDays: null` removes the limit. */
export interface WorkspaceSecurityChange {
  readonly requireTwoFactor?: boolean;
  readonly sessionLengthDays?: SessionLengthDays | null;
}

/** Writes the row as `next` says, making it the first time, in `tx`. */
async function putRules(
  tx: WorkspaceTx,
  scope: EngineScope,
  next: {
    readonly requireTwoFactor: boolean;
    readonly sessionLengthDays: number | null;
    readonly validAfterNow?: true;
  },
): Promise<void> {
  const by = actorRow(scope.actor);
  const stamp = {
    requireTwoFactor: next.requireTwoFactor,
    sessionLengthDays: next.sessionLengthDays,
    ...(next.validAfterNow === true ? { sessionsValidAfter: sql`now()` } : {}),
    updatedAt: sql`now()`,
    updatedByType: by.type,
    updatedById: by.id,
    updatedByMemberId: by.memberId,
  };
  await tx
    .insert(workspaceSecurity)
    .values({
      workspaceId: scope.workspaceId,
      ...stamp,
      createdByType: by.type,
      createdById: by.id,
      createdByMemberId: by.memberId,
    })
    .onConflictDoUpdate({ target: workspaceSecurity.workspaceId, set: stamp });
}

/**
 * The rules row, made with the defaults first when there is none, then locked
 * for this change: two owners changing different rules at once each see the
 * other's, so neither writes back a value it read before the other committed.
 */
async function lockRules(tx: WorkspaceTx, scope: EngineScope): Promise<RulesRow | undefined> {
  const by = actorRow(scope.actor);
  await tx
    .insert(workspaceSecurity)
    .values({
      workspaceId: scope.workspaceId,
      createdByType: by.type,
      createdById: by.id,
      createdByMemberId: by.memberId,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    })
    .onConflictDoNothing({ target: workspaceSecurity.workspaceId });
  return rulesOf(tx, scope.workspaceId, true);
}

/** Refuses a rules change in a workspace deleted meanwhile, as the door would. */
async function requireLive(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  const [live] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
  if (live === undefined) throw refuse('NOT_FOUND', "That workspace doesn't exist, or you're not a member of it.");
}

/**
 * Changes the workspace's sign in rules (AC-893, AC-899). Needs
 * `security.manage`. Requiring two factor is refused 409
 * OWNER_NEEDS_TWO_FACTOR unless the caller has a second factor themselves, so
 * an owner can't lock themselves out. Writes one audit row naming what
 * changed, before and after; a change to nothing writes nothing.
 */
export async function setWorkspaceSecurity(
  scope: EngineScope,
  input: WorkspaceSecurityChange,
  deps: WorkspaceSecurityDeps,
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<WorkspaceSecurity> {
  requirePermission(scope, 'security.manage');
  if (input.requireTwoFactor === true && !(await deps.callerHasSecondFactor())) {
    throw refuse('OWNER_NEEDS_TWO_FACTOR', OWNER_NEEDS_TWO_FACTOR_MESSAGE);
  }
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      await requireLive(tx, scope.workspaceId);
      const was = await lockRules(tx, scope);
      const before = {
        requireTwoFactor: was?.requireTwoFactor ?? false,
        sessionLengthDays: was?.sessionLengthDays ?? null,
      };
      const after = {
        requireTwoFactor: input.requireTwoFactor ?? before.requireTwoFactor,
        sessionLengthDays: input.sessionLengthDays === undefined ? before.sessionLengthDays : input.sessionLengthDays,
      };
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter((key) => after[key] !== before[key]);
      if (changed.length > 0) {
        await putRules(tx, scope, after);
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          {
            action: 'workspace_security.changed',
            targetType: 'workspace',
            targetId: scope.workspaceId,
            before: Object.fromEntries(changed.map((key) => [key, before[key]])),
            after: Object.fromEntries(changed.map((key) => [key, after[key]])),
          },
          source,
        );
      }
      return {
        row: await rulesOf(tx, scope.workspaceId),
        userIds: await memberUserIds(tx, scope.workspaceId),
      };
    },
    hooks,
  );
  return view(result.row, result.userIds, deps);
}

/**
 * Signs everyone out of the workspace (AC-899): every session that last
 * proved who it is before now must sign in again to open it, the caller's
 * included until `keepCaller` marks theirs verified again (the api does, once
 * this commits). Needs `security.manage`; the api asks for a fresh step up
 * first. Sessions stay valid for the person's other workspaces.
 */
export async function signOutEveryone(
  scope: EngineScope,
  _input: unknown,
  deps: WorkspaceSecurityDeps & { readonly keepCaller: () => Promise<void> },
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<WorkspaceSecurity> {
  requirePermission(scope, 'security.manage');
  await runWrite(
    scope,
    async ({ tx }) => {
      await requireLive(tx, scope.workspaceId);
      const was = await lockRules(tx, scope);
      await putRules(tx, scope, {
        requireTwoFactor: was?.requireTwoFactor ?? false,
        sessionLengthDays: was?.sessionLengthDays ?? null,
        validAfterNow: true,
      });
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        { action: 'workspace_security.signed_out_everyone', targetType: 'workspace', targetId: scope.workspaceId },
        source,
      );
    },
    hooks,
  );
  // After the commit, so the caller's new proof is later than the cut off by the database's own clock.
  await deps.keepCaller();
  return getWorkspaceSecurity(scope, {}, deps);
}

/** What finding the workspaces that require two factor of a person needs. */
export interface RequiredByDeps {
  readonly db: Database;
  readonly identity: Pick<IdentityStore, 'workspacesOf'>;
}

/**
 * The names of the live workspaces where this person is an active member and
 * two factor is required (AC-885): while any does, their last second factor
 * stays on. A system read in each workspace in the directory's list for them
 * (a handful) as the system, never through the door: the door would refuse
 * them in exactly these.
 */
export async function twoFactorRequiredBy(deps: RequiredByDeps, userId: string): Promise<readonly string[]> {
  const listed = await deps.identity.workspacesOf(userId);
  const found = await Promise.all(
    listed.map((workspace) =>
      inWorkspace(systemScope(deps.db, workspace.id), async (tx) => {
        const [row] = await tx
          .select({ id: members.id })
          .from(members)
          .innerJoin(workspaces, eq(workspaces.id, members.workspaceId))
          .innerJoin(workspaceSecurity, eq(workspaceSecurity.workspaceId, members.workspaceId))
          .where(
            and(
              eq(members.workspaceId, workspace.id),
              eq(members.userId, userId),
              eq(members.status, 'active'),
              isNull(workspaces.deletedAt),
              eq(workspaceSecurity.requireTwoFactor, true),
            ),
          )
          .limit(1);
        return row === undefined ? [] : [workspace.name];
      }),
    ),
  );
  return found.flat();
}
