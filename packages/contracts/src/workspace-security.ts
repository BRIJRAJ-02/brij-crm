// A workspace's sign in rules (spec 0033, milestone 4): Settings › Workspace ›
// Security. Whether every member needs two factor (AC-893, AC-894), how long
// a sign in lasts in the workspace, and signing everyone out of it. Reading
// and changing them takes `security.manage` (owners only).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { SESSION_LENGTH_DAYS } from './account-limits.ts';
import { WorkspaceScoped } from './workspaces.ts';

export { SESSION_LENGTH_DAYS } from './account-limits.ts';

/** How long a sign in lasts in a workspace, in days, counted from when the session last proved who it is. */
export const SessionLengthDays = z.literal(SESSION_LENGTH_DAYS);
/** How long a sign in lasts in a workspace, in days. */
export type SessionLengthDays = z.infer<typeof SessionLengthDays>;

/** What the door refuses a member without two factor in a workspace that requires it (AC-894). */
export const TWO_FACTOR_REQUIRED_MESSAGE = 'This workspace requires two factor sign in. Set it up to continue.';

/**
 * What turning off the last second factor answers while workspaces require
 * two factor (AC-885): "Acme requires two factor sign in."
 */
export function requiresTwoFactorMessage(names: readonly string[]): string {
  const [only] = names;
  if (names.length === 1 && only !== undefined) return `${only} requires two factor sign in.`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''} require two factor sign in.`;
}

/** What the door refuses a session older than the workspace allows, or signed in before everyone was signed out. */
export const SIGN_IN_AGAIN_MESSAGE = 'This workspace asks you to sign in again.';

/**
 * A workspace's sign in rules, as Settings › Workspace › Security shows them:
 * the rules, how many active members have no second factor yet (an
 * authenticator app), and whether the caller has one, since requiring it needs it.
 */
export const WorkspaceSecurity = z.object({
  requireTwoFactor: z.boolean(),
  /** Absent: no limit beyond the account's own (a sign in lasts while it is used). */
  sessionLengthDays: SessionLengthDays.optional(),
  /** When everyone was last signed out of the workspace, if ever. */
  signedOutEveryoneAt: z.iso.datetime({ offset: true }).optional(),
  /** Active members without an authenticator app. */
  membersWithout: z.number().int().min(0),
  /** Whether the caller has a second factor: requiring two factor waits until they do (AC-893). */
  youHaveTwoFactor: z.boolean(),
});
/** A workspace's sign in rules. */
export type WorkspaceSecurity = z.infer<typeof WorkspaceSecurity>;

/** Changes one or both rules; `sessionLengthDays: null` removes the limit. */
export const SetWorkspaceSecurityInput = WorkspaceScoped.extend({
  requireTwoFactor: z.boolean().optional(),
  sessionLengthDays: SessionLengthDays.nullable().optional(),
});
/** Changes one or both rules. */
export type SetWorkspaceSecurityInput = z.infer<typeof SetWorkspaceSecurityInput>;

/**
 * The workspace security procedures. `set` refuses 409 OWNER_NEEDS_TWO_FACTOR
 * when two factor is being required by someone without it; `signOutEveryone`
 * needs a fresh step up (403 STEP_UP_REQUIRED) and keeps the caller's own
 * session. Both write an audit row (AC-899).
 */
export const workspaceSecurityContract = {
  get: oc.input(WorkspaceScoped).output(WorkspaceSecurity),
  set: oc.input(SetWorkspaceSecurityInput).output(WorkspaceSecurity),
  signOutEveryone: oc.input(WorkspaceScoped).output(WorkspaceSecurity),
};
