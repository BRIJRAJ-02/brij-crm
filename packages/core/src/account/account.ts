// The signed in person's own account (spec 0005): who they are, which
// workspaces they are in, and making their first workspace. These run before
// any workspace is chosen, so they never build a member's scope; the engine's
// workspace bootstrap builds its own system scope.
import type { CreateWorkspaceInput, CreatedWorkspace, Me } from '@crm/contracts';
import type { Database, IdentityStore } from '@crm/db';
import { createUserWorkspace } from '../engine/workspaces.ts';

/** The signed in person, as the session knows them. */
export interface AccountUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/** Who is signed in and their workspaces, oldest first (from the directory, which grants nothing). */
export async function getMe(
  deps: { readonly identity: Pick<IdentityStore, 'workspacesOf'> },
  user: AccountUser,
): Promise<Me> {
  const workspaces = await deps.identity.workspacesOf(user.id);
  return {
    user: { id: user.id, name: user.name, email: user.email },
    workspaces: workspaces.map(({ id, slug, name }) => ({ id, slug, name })),
  };
}

/** What creating a workspace needs: the tenant database, and the identity store to fill in the account's name. */
export interface StartWorkspaceDeps {
  readonly db: Database;
  readonly identity: Pick<IdentityStore, 'setUserNameIfEmpty'>;
}

/**
 * Creates the signed in person's workspace (spec 0005, AC-30): the workspace,
 * its template, their member row named `memberName`, and the directory rows,
 * in one transaction, then saves `memberName` as their account's name if it is
 * still empty. Repeating it with the same `id` returns the same workspace.
 * Refuses `SLUG_TAKEN`, `ID_TAKEN` and `CONFIG_INVALID` as the engine does.
 * The caller checks the session and that the email is verified.
 */
export async function startWorkspace(
  deps: StartWorkspaceDeps,
  user: AccountUser,
  input: CreateWorkspaceInput,
): Promise<CreatedWorkspace> {
  const created = await createUserWorkspace(deps.db, {
    id: input.id,
    name: input.name,
    slug: input.slug,
    firstMember: { userId: user.id, name: input.memberName, email: user.email },
  });
  await deps.identity.setUserNameIfEmpty(user.id, input.memberName);
  return { workspace: created.workspace };
}
