// Deleting your own account (spec 0033, AC-902 to AC-907). Refused while the
// person is the last active owner of any workspace. Otherwise, after a fresh
// step up and the email typed in full: in each workspace, in its own
// transaction, the member is removed (`removeMember`: their private views and
// calendar connections go with it), their member row keeps its id but no
// longer names them, and one `account.deleted` audit row is written; records
// they made stay, credited to "Deleted user". Then calendar grants are revoked
// with the provider (best effort), the `auth` rows go in one transaction, live
// connections are cut, and a last email goes to the old address. Before the
// `auth` rows go, the person's open join requests in workspaces they never
// joined are closed (`closeJoinRequests`), so no admin is left deciding on
// someone who no longer exists. A deleted workspace still inside its window
// is left the same way (`enterWorkspaceToLeave`), so a restore never brings
// them back: it never blocks, since a deleted workspace needs no owner. Every
// step can run again: a workspace already left is skipped.
import {
  MEMBERS_PAGE_MAX,
  type AccountDeletionCheck,
  type DeleteAccountInput,
  type DeletionBlocker,
} from '@crm/contracts';
import { schema, type Database, type IdentityStore } from '@crm/db';
import { and, eq, sql } from 'drizzle-orm';
import { enterWorkspace, enterWorkspaceToLeave, LEAVING, type DoorDeps } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import type { CalendarTokens } from '../calendar/provider.ts';
import { openTokens, type TokenKey } from '../calendar/tokens.ts';
import { inputInvalid, isRefusal, refuse } from '../engine/refusals.ts';
import type { AfterWrite } from '../engine/write.ts';
import { writeAudit } from '../members/audit.ts';
import { listMembers, removeMember } from '../members/members.ts';
import type { SessionCaller } from './sessions.ts';
import { hasSecondFactor, requireFresh } from './step-up.ts';

const { members } = schema;

/** How long a provider's revoke may take before deletion goes on without it. */
const REVOKE_WAIT_MS = 5_000;

/** The name a deleted person's member row keeps, so their records still say who made them. */
export const DELETED_USER_NAME = 'Deleted user';

/** What a deleted person's member row holds in place of their address: a reserved domain that names no one. */
export const deletedEmail = (memberId: string): string => `deleted-${memberId}@deleted.invalid`;

/** What the email typed to confirm answers when it isn't the account's. */
export const EMAIL_MISMATCH = 'Type your account’s email exactly to confirm.';

/** What deleting answers while the person is the last owner somewhere. */
export const lastOwnerMessage = (names: readonly string[]): string =>
  `You’re the last owner of ${names.join(', ')}. Make someone else an owner, or delete the workspace, first.`;

/** A calendar grant to hand back to its provider once the person has left. */
export interface CalendarGrant {
  readonly provider: string;
  readonly tokens: CalendarTokens;
}

/** What deleting an account needs. */
export interface AccountDeletionDeps {
  readonly db: Database;
  readonly identity: Pick<
    IdentityStore,
    'findWorkspace' | 'workspacesOf' | 'allWorkspacesOf' | 'sessionVerification' | 'twoFactorState' | 'deleteUser'
  >;
  readonly rules: DoorDeps['rules'];
  /** The hooks each workspace's removal runs in its transaction (the outbox), as a background write's. */
  readonly hooks: () => readonly AfterWrite[];
  /** Cuts every live connection of the user (4501). Never throws. */
  readonly signedOut: (userId: string) => Promise<void>;
  /** Hands calendar grants back to their providers, best effort: absent where calendar sync is off. */
  readonly calendar?: {
    readonly tokenKey: TokenKey;
    readonly revoke: (grant: CalendarGrant) => Promise<void>;
  };
  /**
   * Closes the person's open workspace join requests, and blanks their name and address on every request, in every
   * workspace, before their `auth` rows go (`closeJoinRequestsOf`).
   */
  readonly closeJoinRequests: (userId: string) => Promise<void>;
  /**
   * Takes the picture they uploaded out of the private store (27 Oct 2026), before their `auth` row goes: nothing
   * else would ever point at it again. Best effort; absent where there is no store.
   */
  readonly forgetPicture?: (userId: string) => Promise<unknown>;
  /** The last email, to the old address. Never throws. */
  readonly sendFarewell: (email: string) => Promise<void>;
  readonly now?: () => number;
}

/** The person deleting their account: their session, and their address as the session says it. */
export interface DeletingCaller extends SessionCaller {
  readonly email: string;
}

/** The person's member scope in each workspace they are still in. */
async function myWorkspaces(
  deps: AccountDeletionDeps,
  userId: string,
): Promise<readonly { readonly scope: EngineScope; readonly slug: string; readonly name: string }[]> {
  const listed = await deps.identity.workspacesOf(userId);
  const entered = await Promise.all(
    listed.map(async (workspace) => {
      try {
        const scope = await enterWorkspace(
          { db: deps.db, identity: deps.identity, rules: deps.rules },
          // Leaving: a workspace's sign in rules (two factor, session length) never hold someone in it.
          { userId, slug: workspace.slug, session: LEAVING },
        );
        return { scope, slug: workspace.slug, name: workspace.name };
      } catch (error) {
        // Already left (a run that stopped part way), or the workspace is gone: nothing to do there. Anything else
        // (a database that didn't answer) fails the request, so a workspace is never skipped unseen.
        if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') return undefined;
        throw error;
      }
    }),
  );
  return entered.filter((each) => each !== undefined);
}

/**
 * The person's member scope in every other workspace they are still in, beside `seen` (the live ones already
 * judged): deleted ones inside their window, and any deleted or restored since, read in one directory list so none
 * falls between two reads. Left too, never a blocker: a deleted workspace needs no owner, and one restored meanwhile
 * has its restorer as an owner. One past its window, or already left, is skipped; anything else fails the request.
 */
async function myOtherWorkspaces(
  deps: AccountDeletionDeps,
  userId: string,
  seen: ReadonlySet<string>,
): Promise<readonly { readonly scope: EngineScope }[]> {
  const listed = (await deps.identity.allWorkspacesOf(userId)).filter((workspace) => !seen.has(workspace.id));
  const entered = await Promise.all(
    listed.map(async (workspace) => {
      try {
        return { scope: await enterWorkspaceToLeave({ db: deps.db }, { userId, workspaceId: workspace.id }) };
      } catch (error) {
        if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') return undefined;
        throw error;
      }
    }),
  );
  return entered.filter((each) => each !== undefined);
}

/** Every active member of a workspace: `listMembers` answers a page at a time (spec 0031, AC-810). */
async function everyMember(scope: EngineScope) {
  const all = [];
  let cursor: string | undefined;
  do {
    const page = await listMembers(scope, { limit: MEMBERS_PAGE_MAX, ...(cursor === undefined ? {} : { cursor }) });
    all.push(...page.members);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return all;
}

/** Where the person stands in each workspace: an owner, and the only active one (a blocker). */
async function standingIn(entered: Awaited<ReturnType<typeof myWorkspaces>>) {
  const standing = [];
  for (const entry of entered) {
    const people = await everyMember(entry.scope);
    const me = people.find((each) => each.id === entry.scope.actor.id);
    const owners = people.filter((each) => each.role === 'owner');
    standing.push({ entry, owner: me?.role === 'owner', last: me?.role === 'owner' && owners.length === 1 });
  }
  return standing;
}

/** The workspaces where the person is the only active owner. */
async function blockersOf(entered: Awaited<ReturnType<typeof myWorkspaces>>): Promise<readonly DeletionBlocker[]> {
  return (await standingIn(entered))
    .filter((each) => each.last)
    .map(({ entry }) => ({ slug: entry.slug, name: entry.name }));
}

/**
 * The deleted workspaces, still inside their restore window, the person is the only owner of (late trap #23): a
 * deleted workspace needs no owner, so deleting the account goes ahead, but nobody is left who could restore it.
 * Said beforehand, never a blocker. Their names come from the directory, read with the rest.
 */
async function lostOf(
  deps: AccountDeletionDeps,
  userId: string,
  seen: ReadonlySet<string>,
): Promise<readonly string[]> {
  const listed = (await deps.identity.allWorkspacesOf(userId)).filter((workspace) => !seen.has(workspace.id));
  const lost = await Promise.all(
    listed.map(async (workspace) => {
      let scope: EngineScope;
      try {
        scope = await enterWorkspaceToLeave({ db: deps.db }, { userId, workspaceId: workspace.id });
      } catch (error) {
        if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') return undefined;
        throw error;
      }
      const memberId = scope.actor.id;
      const owners = await inWorkspace(scope, (tx) =>
        tx.execute<{ me: boolean; others: number }>(sql`
          select
            bool_or(id = ${memberId}::uuid) as me,
            count(*) filter (where id <> ${memberId}::uuid)::int as others
          from members where role = 'owner' and status = 'active'
        `),
      );
      const [row] = owners.rows;
      return row?.me === true && row.others === 0 ? workspace.name : undefined;
    }),
  );
  return lost.filter((name) => name !== undefined);
}

/**
 * The workspaces the person is the last owner of (AC-902): deleting waits until each has another owner. And the
 * deleted ones it would leave with no one to restore them (`lost`), said but never in the way.
 */
export async function accountDeletionCheck(
  deps: AccountDeletionDeps,
  caller: SessionCaller,
): Promise<AccountDeletionCheck> {
  const entered = await myWorkspaces(deps, caller.userId);
  const seen = new Set(entered.map((each) => each.scope.workspaceId));
  return {
    blockers: [...(await blockersOf(entered))],
    lost: [...(await lostOf(deps, caller.userId, seen))],
  };
}

/** The member's calendar grants, read before the removal deletes them, so they can be handed back after. */
async function grantsOf(deps: AccountDeletionDeps, scope: EngineScope): Promise<readonly CalendarGrant[]> {
  const calendar = deps.calendar;
  if (calendar === undefined || scope.actor.type !== 'member' || scope.actor.id === null) return [];
  const memberId = scope.actor.id;
  const rows = await inWorkspace(scope, (tx) =>
    tx.execute<{ provider: string; account_email: string; tokens: Uint8Array }>(sql`
      select provider, account_email, tokens from calendar_connections where member_id = ${memberId}::uuid
    `),
  );
  return rows.rows.flatMap((row) => {
    try {
      const tokens = openTokens(calendar.tokenKey, row.tokens, {
        workspaceId: scope.workspaceId,
        memberId,
        provider: row.provider,
        accountEmail: row.account_email,
      });
      return [{ provider: row.provider, tokens }];
    } catch {
      // Tokens this key can't open can't be handed back either; the connection still goes.
      return [];
    }
  });
}

/**
 * Deletes the caller's account (AC-903 to AC-907). Needs a fresh step up
 * (with two factor on, by the second factor) and the account's email typed
 * in full; refused 409 LAST_OWNER while the person is the last owner of any
 * workspace.
 */
export async function deleteMyAccount(
  deps: AccountDeletionDeps,
  caller: DeletingCaller,
  input: DeleteAccountInput,
): Promise<{ readonly deleted: true }> {
  await requireFresh(deps, caller, { secondFactor: await hasSecondFactor(deps.identity, caller.userId) });
  if (input.email.trim().toLowerCase() !== caller.email.toLowerCase()) throw inputInvalid('email', EMAIL_MISMATCH);

  const standing = await standingIn(await myWorkspaces(deps, caller.userId));
  const blockers = standing.filter((each) => each.last).map(({ entry }) => entry.name);
  if (blockers.length > 0) throw refuse('LAST_OWNER', lastOwnerMessage(blockers));
  const seen = new Set(standing.map(({ entry }) => entry.scope.workspaceId));
  const deleted = await myOtherWorkspaces(deps, caller.userId, seen);
  // Owned workspaces first: should an owner be demoted meanwhile, `removeMember`'s own last owner guard refuses
  // before any other workspace is left. Deleted ones next: the guard passes them, unless one is restored meanwhile.
  const ordered = [
    ...standing.filter((each) => each.owner).map(({ entry }) => entry.scope),
    ...deleted.map((each) => each.scope),
    ...standing.filter((each) => !each.owner).map(({ entry }) => entry.scope),
  ];

  const grants: CalendarGrant[] = [];
  for (const scope of ordered) {
    if (scope.actor.type !== 'member' || scope.actor.id === null) continue;
    const memberId = scope.actor.id;
    grants.push(...(await grantsOf(deps, scope)));
    // In the removal's own transaction: the row stops naming them, and the audit log says why they left.
    const forget: AfterWrite = async (_change, tx) => {
      await tx
        .update(members)
        .set({ name: DELETED_USER_NAME, email: deletedEmail(memberId), userId: null, jobTitle: null })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId)));
      await writeAudit(tx, scope.workspaceId, scope.actor, {
        action: 'account.deleted',
        targetType: 'member',
        targetId: memberId,
      });
    };
    await removeMember(scope, { memberId }, [forget, ...deps.hooks()]);
  }

  // Best effort: a provider that can't be reached keeps a grant to an account that no longer exists here.
  if (deps.calendar !== undefined) {
    const calendar = deps.calendar;
    // Never long: a provider that hangs can't hold the person's deletion.
    const capped = (grant: CalendarGrant) =>
      Promise.race([
        calendar.revoke(grant).catch(() => undefined),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), REVOKE_WAIT_MS)),
      ]);
    await Promise.all(grants.map(capped));
  }
  await deps.closeJoinRequests(caller.userId);
  await deps.forgetPicture?.(caller.userId).catch(() => undefined);
  await deps.identity.deleteUser(caller.userId);
  await deps.signedOut(caller.userId);
  await deps.sendFarewell(caller.email);
  return { deleted: true };
}
