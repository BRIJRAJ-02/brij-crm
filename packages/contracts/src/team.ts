// The team around a workspace (spec 0031): invitations into it, the limits on
// them, and the audit log's action catalog. Shared by the api, the core and
// the browser through the data layer.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Role } from './access.ts';
import { INVITE_BATCH_MAX } from './team-limits.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/** How long an email invitation works after its last send (spec 0031, value sourcing). */
export const INVITE_DAYS = 7;
/** Open invitations one workspace may hold at once (AC-808): one more answers 409 `INVITES_LIMIT`. */
export const INVITES_LIMIT = 100;
export { INVITE_BATCH_MAX } from './team-limits.ts';
/** Invitation emails a workspace may send in an hour (AC-808), sends and resends alike. */
export const INVITE_SENDS_PER_WORKSPACE_HOUR = 50;
/** Invitation emails one inviter may send in an hour (AC-808). */
export const INVITE_SENDS_PER_INVITER_HOUR = 20;
/** Invitation lookups (`invitations.peek`) one IP may make in a minute (AC-808). */
export const INVITE_PEEKS_PER_IP_MINUTE = 20;
/**
 * Seats a workspace may use: active non guest members plus open non guest
 * email invitations (AC-809). Unlimited until #38 sets plan limits.
 */
export const SEAT_LIMIT = Number.POSITIVE_INFINITY;

/** What an invalid invitation answers, whatever the reason (AC-805): expired, revoked, used or unknown. */
export const INVITE_INVALID_MESSAGE = 'This invitation is no longer valid. Ask for a new one.';
/** What a full plan answers (AC-809). */
export const SEAT_LIMIT_MESSAGE = 'Your plan has no free seats.';

/**
 * Every action the audit log records (spec 0031, AC-830; specs 0032 and 0033
 * add theirs here). A row's `action` is always one of these.
 */
export const AUDIT_ACTIONS = [
  'invitation.created',
  'invitation.resent',
  'invitation.revoked',
  'invitation.accepted',
  'member.role_changed',
  'member.removed',
  'member.left',
] as const;
/** One action the audit log records. */
export const AuditAction = z.enum(AUDIT_ACTIONS);
/** One action the audit log records. */
export type AuditAction = z.infer<typeof AuditAction>;

/** An invitation link's token: 32 random bytes, base64url, never stored (only its SHA-256 is). */
export const InviteToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'That isn’t an invitation link.');
/** An invitation link's token. */
export type InviteToken = z.infer<typeof InviteToken>;

/** One open invitation as the Invitations tab lists it. Holders of `members.invite` only. */
export const InvitationView = z.object({
  id: Uuid,
  kind: z.literal('email'),
  email: z.string(),
  role: Role,
  /** Who sent it, by their name in this workspace; empty when the system did. */
  invitedBy: z.string(),
  invitedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  /** Past `expiresAt`: it no longer works, and a resend renews it. */
  isExpired: z.boolean(),
});
/** One open invitation. */
export type InvitationView = z.infer<typeof InvitationView>;

/**
 * Inviting 1 to 20 addresses with one role (AC-803). Admins invite as admin
 * or member; only owners invite as owner. `mutationId` is the write's uuid.
 */
export const InviteInput = WorkspaceScoped.extend({
  emails: z
    .array(z.email('Enter a valid email address.').max(254))
    .min(1, 'Add at least one email address.')
    .max(INVITE_BATCH_MAX, `Invite at most ${String(INVITE_BATCH_MAX)} people at once.`),
  role: Role,
  mutationId: Uuid,
});
/** Inviting people by email. */
export type InviteInput = z.infer<typeof InviteInput>;

/** An address an invite left out, and why: `ALREADY_MEMBER`. */
export const InviteRefused = z.object({
  email: z.string(),
  code: z.literal('ALREADY_MEMBER'),
  message: z.string(),
});
/** An address an invite left out. */
export type InviteRefused = z.infer<typeof InviteRefused>;

/** What an invite did: the invitations sent (new, or an open one resent), the addresses refused, and any not mailed. */
export const InviteResult = z.object({
  invited: z.array(InvitationView),
  refused: z.array(InviteRefused),
  /** Addresses whose email didn't go out; their invitation stands, and Resend tries again. */
  unsent: z.array(z.string()),
});
/** What an invite did. */
export type InviteResult = z.infer<typeof InviteResult>;

/** One invitation in the workspace, by id, for resend and revoke. */
export const InvitationInput = WorkspaceScoped.extend({ invitationId: Uuid, mutationId: Uuid });
/** One invitation in the workspace. */
export type InvitationInput = z.infer<typeof InvitationInput>;

/** What `/invite/:token` shows before accepting (AC-805): who, where, as what, and to which address, masked. */
export const InvitePeek = z.object({
  workspaceName: z.string(),
  inviterName: z.string(),
  role: Role,
  /** The invited address as `a***@example.com`. */
  invitedEmailMasked: z.string(),
});
/** What an invitation shows before accepting. */
export type InvitePeek = z.infer<typeof InvitePeek>;

/** The workspace an accepted invitation opened (AC-806). */
export const InviteAccepted = z.object({ slug: z.string() });
/** The workspace an accepted invitation opened. */
export type InviteAccepted = z.infer<typeof InviteAccepted>;

/**
 * Invitations (spec 0031, slice 2). `create`, `list`, `resend` and `revoke`
 * need `members.invite`; `peek` needs nothing (20 a minute per IP) and
 * `accept` a signed in user whose verified email is the invited one. Every
 * invalid token answers 404 `INVITE_INVALID`.
 */
export const invitationsContract = {
  create: oc.input(InviteInput).output(InviteResult),
  list: oc.input(WorkspaceScoped).output(z.array(InvitationView)),
  resend: oc.input(InvitationInput).output(z.object({ invitation: InvitationView, sent: z.boolean() })),
  revoke: oc.input(InvitationInput).output(z.void()),
  peek: oc.input(z.object({ token: InviteToken })).output(InvitePeek),
  accept: oc.input(z.object({ token: InviteToken })).output(InviteAccepted),
};

/** An address as an invitation shows it to someone who may not own it (AC-805): `a***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
