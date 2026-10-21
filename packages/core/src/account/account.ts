// The signed in person's own account (spec 0005): who they are, which
// workspaces they are in, and making their first workspace. These run before
// any workspace is chosen, so they never build a member's scope; the engine's
// workspace bootstrap builds its own system scope.
import type { CreateWorkspaceInput, CreatedWorkspace, Me, SlugAvailability } from '@crm/contracts';
import type { Database, IdentityStore } from '@crm/db';
import { enterWorkspace, type DoorLog, type RuleSource } from '../access/door.ts';
import { createUserWorkspace } from '../engine/workspaces.ts';
import type { ReachedMilestone } from '../milestones/milestones.ts';

/** The signed in person, as the session knows them. */
export interface AccountUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/**
 * Who is signed in and their workspaces, oldest first (from the directory,
 * which grants nothing), with the one they last opened while it is still
 * among them (spec 0031, AC-802).
 */
export async function getMe(
  deps: { readonly identity: Pick<IdentityStore, 'workspacesOf' | 'lastWorkspaceOf'> },
  user: AccountUser,
): Promise<Me> {
  const [workspaces, last] = await Promise.all([
    deps.identity.workspacesOf(user.id),
    deps.identity.lastWorkspaceOf(user.id),
  ]);
  const lastWorkspaceId = workspaces.some((workspace) => workspace.id === last) ? last : undefined;
  return {
    user: { id: user.id, name: user.name, email: user.email },
    workspaces: workspaces.map(({ id, slug, name }) => ({ id, slug, name })),
    ...(lastWorkspaceId === undefined ? {} : { lastWorkspaceId }),
  };
}

/** What remembering the last workspace needs: the door's deps, and the identity store to write the preference. */
export interface LastWorkspaceDeps {
  readonly db: Database;
  readonly identity: Pick<IdentityStore, 'findWorkspace' | 'setLastWorkspace'>;
  readonly log?: DoorLog;
  /** The rule source every door names (spec 0009): the api's `APP_RULES`. */
  readonly rules: RuleSource;
}

/**
 * Remembers the workspace at `slug` as the one `user` last opened (spec
 * 0031, AC-802). The access door lets them in first, so a workspace they are
 * not an active member of is refused NOT_FOUND, as every member procedure
 * refuses it, and nothing is written. The store writes only on a change.
 */
export async function setLastWorkspace(deps: LastWorkspaceDeps, user: AccountUser, slug: string): Promise<void> {
  const scope = await enterWorkspace(
    { db: deps.db, identity: deps.identity, rules: deps.rules, ...(deps.log === undefined ? {} : { log: deps.log }) },
    { userId: user.id, slug },
  );
  await deps.identity.setLastWorkspace(user.id, scope.workspaceId);
}

/** What creating a workspace needs: the tenant database, and the identity store to fill in the account's name. */
export interface StartWorkspaceDeps {
  readonly db: Database;
  readonly identity: Pick<IdentityStore, 'setUserNameIfEmpty'>;
}

/** The workspace as the contract answers it, and the milestones its creation reached (none on a replay). */
export interface StartedWorkspace extends CreatedWorkspace {
  readonly milestones: readonly ReachedMilestone[];
}

/**
 * Creates the signed in person's workspace (spec 0005, AC-30): the workspace,
 * its template, their member row named `memberName`, and the directory rows,
 * in one transaction, then saves `memberName` as their account's name if it is
 * still empty. Repeating it with the same `id` returns the same workspace.
 * Refuses `SLUG_TAKEN`, `ID_TAKEN` and `CONFIG_INVALID` as the engine does.
 * The caller checks the session and that the email is verified, answers only
 * `workspace`, and sends the milestones' product events (spec 0010, AC-175).
 */
export async function startWorkspace(
  deps: StartWorkspaceDeps,
  user: AccountUser,
  input: CreateWorkspaceInput,
): Promise<StartedWorkspace> {
  const created = await createUserWorkspace(deps.db, {
    id: input.id,
    name: input.name,
    slug: input.slug,
    firstMember: { userId: user.id, name: input.memberName, email: user.email },
  });
  await deps.identity.setUserNameIfEmpty(user.id, input.memberName);
  return { workspace: created.workspace, milestones: created.milestones };
}

/** What checking a web address needs: the directory's lookup, and nothing else. */
export interface SlugCheckDeps {
  readonly identity: Pick<IdentityStore, 'findWorkspace'>;
}

/**
 * Whether no workspace has ever used `slug` (spec 0036, AC-1215), from the
 * directory alone: it keeps every address a workspace has had, so one once
 * used is never offered again, as `createUserWorkspace` refuses it. It grants
 * nothing and reads nothing else; `create` still has the last word.
 */
export async function workspaceSlugAvailable(deps: SlugCheckDeps, slug: string): Promise<SlugAvailability> {
  return { available: (await deps.identity.findWorkspace(slug)) === undefined };
}
