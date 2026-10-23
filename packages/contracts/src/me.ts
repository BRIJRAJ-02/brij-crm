// The signed in person (spec 0005): who they are and which workspaces they
// are in, so the app knows where to go after sign in.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { WorkspaceScoped, WorkspaceSummary } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/** The signed in person. `name` is empty until they give one (an email code sign up starts without). */
export const SignedInUser = z.object({
  id: Uuid,
  name: z.string(),
  email: z.email(),
});
/** The signed in person. */
export type SignedInUser = z.infer<typeof SignedInUser>;

/**
 * Who is signed in, and their workspaces, oldest first. `lastWorkspaceId` is
 * the one they last opened (spec 0031, AC-802), only while it is still in
 * `workspaces`: `/` goes there, else to the first.
 */
export const Me = z.object({
  user: SignedInUser,
  workspaces: z.array(WorkspaceSummary),
  lastWorkspaceId: Uuid.optional(),
  /**
   * Whether the person is on `OPERATOR_EMAILS` with a verified email (spec 0047, AC-1619): the account menu shows
   * "Super admin" for them. Never access: every `operator.*` call decides again.
   */
  isOperator: z.boolean(),
});
/** Who is signed in, and their workspaces. */
export type Me = z.infer<typeof Me>;

/**
 * The signed in person: needs a session, answers 401 `UNAUTHENTICATED`
 * without one. `setLastWorkspace` (spec 0031, AC-802) remembers the workspace
 * just opened, for the caller only and only one they are an active member
 * of (else the door's NOT_FOUND).
 */
export const meContract = {
  get: oc.output(Me),
  setLastWorkspace: oc.input(WorkspaceScoped).output(z.void()),
};
