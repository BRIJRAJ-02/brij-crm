// The one write into the directory (spec 0005): a new workspace's directory
// row and its first member's membership row, inside the transaction that
// creates the workspace, so all of them land together or none do.
import { sql } from 'drizzle-orm';
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
 * The key of every address a workspace has held (migration 0083). A violation
 * of it means another workspace holds the address now or held it before.
 */
export const ADDRESS_CLAIM_CONSTRAINT = 'workspace_addresses_pkey';

/**
 * Claims `slug` for the workspace `tx` is set to and makes it the directory's
 * address, through `crm_claim_workspace_address` (the app's only way to
 * change the directory). The workspace keeps every address it held, so an
 * old link still finds it. Fails on `ADDRESS_CLAIM_CONSTRAINT` (or
 * `DIRECTORY_SLUG_CONSTRAINT`) when another workspace holds it.
 */
export async function claimWorkspaceAddress(tx: WorkspaceTx, slug: string): Promise<void> {
  await tx.execute(sql`select crm_claim_workspace_address(${slug})`);
}

/**
 * Writes the directory and membership rows for a workspace just created in
 * `tx` (the engine's workspace bootstrap calls it as an after write step).
 * Runs in that transaction, so a failure anywhere rolls all of it back. A slug
 * used before fails on `DIRECTORY_SLUG_CONSTRAINT` or `ADDRESS_CLAIM_CONSTRAINT`.
 */
export async function addWorkspaceToDirectory(tx: WorkspaceTx, entry: DirectoryEntry): Promise<void> {
  await tx.insert(workspaceDirectory).values({ workspaceId: entry.workspaceId, slug: entry.slug, name: entry.name });
  // Held from the start, so the address can't be taken later by a workspace that changes to it.
  await claimWorkspaceAddress(tx, entry.slug);
  await tx.insert(workspaceMembership).values({
    userId: entry.userId,
    workspaceId: entry.workspaceId,
    memberId: entry.memberId,
  });
}
