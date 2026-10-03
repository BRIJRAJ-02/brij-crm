// The one write into the directory (spec 0005): a new workspace's directory
// row and its first member's membership row, inside the transaction that
// creates the workspace, so all of them land together or none do.
import type { WorkspaceTx } from '../client.ts';
import { workspaceDirectory, workspaceMembership } from '../schema/auth.ts';

/** A new workspace's directory entry and the user who made it. */
export interface DirectoryEntry {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly userId: string;
  readonly memberId: string;
}

/**
 * The unique index that keeps a slug from ever being reused (unconditional,
 * unlike `workspaces_slug`). A violation of it means the address is taken.
 */
export const DIRECTORY_SLUG_CONSTRAINT = 'workspace_directory_slug';

/**
 * Writes the directory and membership rows for a workspace just created in
 * `tx` (the engine's workspace bootstrap calls it as an after write step).
 * Runs in that transaction, so a failure anywhere rolls all of it back. A slug
 * used before fails on `DIRECTORY_SLUG_CONSTRAINT`.
 */
export async function addWorkspaceToDirectory(tx: WorkspaceTx, entry: DirectoryEntry): Promise<void> {
  await tx.insert(workspaceDirectory).values({ workspaceId: entry.workspaceId, slug: entry.slug, name: entry.name });
  await tx.insert(workspaceMembership).values({
    userId: entry.userId,
    workspaceId: entry.workspaceId,
    memberId: entry.memberId,
  });
}
