// Workspaces as a signed in person sees them (spec 0005): the address rule,
// the summary the directory lists, and creating your own.
import { oc } from '@orpc/contract';
import * as z from 'zod';

/**
 * A workspace's web address (`/w/<slug>`): lowercase letters and digits in
 * single dash runs, 3 to 40 characters. The same rule the database checks.
 */
export const WorkspaceSlug = z
  .string()
  .regex(/^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use 3 to 40 lowercase letters and digits, with single dashes.');
/** A workspace's web address. */
export type WorkspaceSlug = z.infer<typeof WorkspaceSlug>;

/** A workspace as a member's list shows it: enough to open it, nothing from inside it. */
export const WorkspaceSummary = z.object({
  id: z.uuid(),
  slug: WorkspaceSlug,
  name: z.string(),
});
/** A workspace in a member's list. */
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>;

/**
 * The input every workspace procedure carries: which workspace, by its
 * address. The API's `member` door reads it to check the caller belongs there.
 */
export const WorkspaceScoped = z.object({
  workspace: WorkspaceSlug,
});
/** The input every workspace procedure carries. */
export type WorkspaceScoped = z.infer<typeof WorkspaceScoped>;

/**
 * Creating your own workspace (`/welcome`). `id` is a UUID v7 the browser
 * mints and the retry key: sending the same request again returns the same
 * workspace. `memberName` is your name in it, and becomes your account's name
 * if that is still empty.
 */
export const CreateWorkspaceInput = z.object({
  id: z.uuid({ version: 'v7', message: 'The workspace id must be a UUID v7.' }),
  name: z.string().trim().min(1, 'Name the workspace.').max(80, 'Use at most 80 characters.'),
  slug: WorkspaceSlug,
  memberName: z.string().trim().min(1, 'Enter your name.').max(80, 'Use at most 80 characters.'),
});
/** Creating your own workspace. */
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInput>;

/** The workspace just made (or made by an earlier try of the same request). */
export const CreatedWorkspace = z.object({
  workspace: WorkspaceSummary,
});
/** The workspace just made. */
export type CreatedWorkspace = z.infer<typeof CreatedWorkspace>;

/**
 * Workspaces before you are in one: `create` needs a session and a verified
 * email, and refuses `SLUG_TAKEN` (on the `slug` field) and `ID_TAKEN`.
 */
export const workspacesContract = {
  create: oc.input(CreateWorkspaceInput).output(CreatedWorkspace),
};
