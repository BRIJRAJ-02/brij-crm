// The team around a workspace (spec 0031): invitations into it, the limits on
// them, and the audit log's action catalog. Shared by the api, the core and
// the browser through the data layer.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Role } from './access.ts';
import { INVITE_BATCH_MAX, INVITE_LINK_DAYS, INVITE_LINK_USES_MAX } from './team-limits.ts';
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
  // Settings › Account › Preferences: a member changed their own time zone, date format, week start or landing page.
  'member.preferences_changed',
  'invitation.link_set',
  'invitation.link_revoked',
  'workspace.domains_set',
  'join_request.created',
  'join_request.approved',
  'join_request.declined',
  'member.role_changed',
  'member.removed',
  'member.left',
  'workspace.ownership_transferred',
  'workspace.updated',
  'workspace.deleted',
  'workspace.restored',
  'member.profile_updated',
  // Spec 0033 (AC-904): a person deleted their own account and left the workspace with it.
  'account.deleted',
  // Round robin (spec 0037, AC-1329): a member's count adjusted in a rotation, and an adjustment undone.
  'rotation.adjusted',
  'rotation.adjustment_undone',
  // A round robin booking's seat given to someone else: a reassign, a hand on, a member who left (spec 0029).
  'booking.reassigned',
  // Lead routing (spec 0043, AC-1616): a form's or a team page's rules changed, and a booking marked or unmarked no show.
  'routing.changed',
  // Spec 0029 milestone 3: who a form's new records go to changed (a member, a round robin rotation, or nobody).
  'form.owner_changed',
  'booking.no_show',
  'booking.no_show_undone',
  // A booking linked to a record by hand from its card, and the link taken off (polish F2).
  'booking.record_linked',
  'booking.record_unlinked',
  // Spec 0033 (AC-899): an owner changed the workspace's sign in rules, or signed everyone out of it.
  'workspace_security.changed',
  'workspace_security.signed_out_everyone',
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
  /** The invited address as `a***@example.com`; absent for the invite link, which names nobody. */
  invitedEmailMasked: z.string().optional(),
});
/** What an invitation shows before accepting. */
export type InvitePeek = z.infer<typeof InvitePeek>;

export { INVITE_LINK_DAYS, INVITE_LINK_USES_MAX, type InviteLinkDays } from './team-limits.ts';

/** The roles an invite link may give (AC-818): never owner or admin (guest joins with slice 9). */
export const InviteLinkRole = Role.exclude(['owner', 'admin']);
/** A role an invite link may give. */
export type InviteLinkRole = z.infer<typeof InviteLinkRole>;

/**
 * The workspace's invite link as the Members page's card shows it (AC-818),
 * to holders of `members.invite` only. When on, its token (the page builds
 * `/invite/<token>` on its own origin), the role it gives, when it stops
 * working and how many it may let in, and how many it has.
 */
export const InviteLinkView = z.object({
  enabled: z.boolean(),
  token: InviteToken.optional(),
  role: InviteLinkRole.optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  maxUses: z.number().int().min(1).optional(),
  uses: z.number().int().min(0),
  /** On, but past `expiresAt` or at `maxUses`: it lets nobody in until it is changed or reset. */
  isSpent: z.boolean(),
});
/** The workspace's invite link. */
export type InviteLinkView = z.infer<typeof InviteLinkView>;

/**
 * Turns the invite link on or off, or changes it (AC-818). Off revokes it.
 * On creates it, or changes the open one in place: a field left out keeps
 * its value; `expiresInDays: null` and `maxUses: null` take the limit away;
 * an expiry counts from now. `reset` replaces its token, so the old link
 * stops working.
 */
export const SetInviteLinkInput = WorkspaceScoped.extend({
  enabled: z.boolean(),
  role: InviteLinkRole.optional(),
  expiresInDays: z
    .union(INVITE_LINK_DAYS.map((days) => z.literal(days)))
    .nullable()
    .optional(),
  maxUses: z.number().int().min(1).max(INVITE_LINK_USES_MAX).nullable().optional(),
  reset: z.boolean().optional(),
  mutationId: Uuid,
});
/** A change to the invite link. */
export type SetInviteLinkInput = z.infer<typeof SetInviteLinkInput>;

/** The workspace an accepted invitation opened (AC-806). */
export const InviteAccepted = z.object({ slug: z.string() });
/** The workspace an accepted invitation opened. */
export type InviteAccepted = z.infer<typeof InviteAccepted>;

/**
 * Public mail domains (spec 0031, AC-819, value sourcing): anyone can have an
 * address there, so no workspace may let everyone at one ask to join.
 */
export const PUBLIC_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.de',
  'outlook.fr',
  'outlook.es',
  'outlook.it',
  'outlook.jp',
  'outlook.in',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.de',
  'hotmail.it',
  'hotmail.es',
  'live.com',
  'live.co.uk',
  'live.fr',
  'live.de',
  'live.it',
  'live.nl',
  'live.ca',
  'msn.com',
  'passport.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'yahoo.co.jp',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.es',
  'yahoo.it',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.com.br',
  'ymail.com',
  'rocketmail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'aim.com',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'pm.me',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'gmx.at',
  'gmx.ch',
  'gmx.fr',
  'web.de',
  'mail.com',
  'email.com',
  'zoho.com',
  'zohomail.com',
  'yandex.com',
  'yandex.ru',
  'ya.ru',
  'mail.ru',
  'inbox.ru',
  'list.ru',
  'bk.ru',
  'rambler.ru',
  'qq.com',
  'foxmail.com',
  '163.com',
  '126.com',
  'yeah.net',
  'sina.com',
  'sohu.com',
  'aliyun.com',
  'naver.com',
  'hanmail.net',
  'daum.net',
  'kakao.com',
  'rediffmail.com',
  'fastmail.com',
  'fastmail.fm',
  'hey.com',
  'tutanota.com',
  'tutanota.de',
  'tuta.io',
  'tutamail.com',
  'posteo.de',
  'posteo.net',
  'mailbox.org',
  'hushmail.com',
  'runbox.com',
  'libero.it',
  'virgilio.it',
  'tiscali.it',
  'alice.it',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'laposte.net',
  'sfr.fr',
  't-online.de',
  'freenet.de',
  'arcor.de',
  'seznam.cz',
  'wp.pl',
  'o2.pl',
  'onet.pl',
  'interia.pl',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'bellsouth.net',
  'cox.net',
  'charter.net',
  'earthlink.net',
  'optonline.net',
  'btinternet.com',
  'sky.com',
  'virginmedia.com',
  'talktalk.net',
  'ntlworld.com',
  'bigpond.com',
  'optusnet.com.au',
  'shaw.ca',
  'rogers.com',
  'sympatico.ca',
  'telus.net',
  'xtra.co.nz',
  'duck.com',
  'skiff.com',
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'temp-mail.org',
  'yopmail.com',
  'sharklasers.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
];

/**
 * Brands that hand out free addresses under many country domains
 * (hotmail.se, yahoo.com.mx): any domain whose first label is one of these is
 * public too, so the list above needn't name every country.
 */
const PUBLIC_MAIL_BRANDS: readonly string[] = [
  'gmail',
  'googlemail',
  'hotmail',
  'outlook',
  'live',
  'msn',
  'yahoo',
  'ymail',
  'aol',
  'gmx',
  'yandex',
  'protonmail',
  'tutanota',
  'mailinator',
];

/** Whether anyone can have an address at `domain`, so it may never open a workspace to everyone there (AC-819). */
export function isPublicEmailDomain(domain: string): boolean {
  const wanted = domain.trim().toLowerCase();
  return PUBLIC_EMAIL_DOMAINS.includes(wanted) || PUBLIC_MAIL_BRANDS.includes(wanted.split('.')[0] ?? '');
}

/** The domain of an address, lowercase; empty for something that isn't one. */
export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at <= 0
    ? ''
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase();
}

/**
 * The workspace's email domains as Settings › Members shows them (AC-819),
 * to holders of `workspace.manage`: the domains on, and the one the reader
 * may turn on (their own verified email's), absent when it is a public mail
 * domain (`isPublic`) or unverified.
 */
export const WorkspaceDomainsView = z.object({
  domains: z.array(z.string()),
  yourDomain: z.string().optional(),
  /** The reader's own domain is a public mail domain, so no domain join for them to turn on. */
  isPublic: z.boolean(),
});
/** The workspace's email domains. */
export type WorkspaceDomainsView = z.infer<typeof WorkspaceDomainsView>;

/** Sets the workspace's email domains (AC-819): only the caller's own verified email's, never a public one. */
export const SetWorkspaceDomainsInput = WorkspaceScoped.extend({
  domains: z.array(z.string().trim().toLowerCase().max(253)).max(10),
  mutationId: Uuid,
});
/** Setting the workspace's email domains. */
export type SetWorkspaceDomainsInput = z.infer<typeof SetWorkspaceDomainsInput>;

/** One open request to join, as the Join requests tab lists it (AC-820). */
export const JoinRequestView = z.object({
  id: Uuid,
  name: z.string(),
  email: z.string(),
  requestedAt: z.iso.datetime({ offset: true }),
});
/** One open request to join. */
export type JoinRequestView = z.infer<typeof JoinRequestView>;

/** Approves (they join as a member) or declines one open request (AC-820). */
export const DecideJoinRequestInput = WorkspaceScoped.extend({
  requestId: Uuid,
  approve: z.boolean(),
  mutationId: Uuid,
});
/** A decision on a request to join. */
export type DecideJoinRequestInput = z.infer<typeof DecideJoinRequestInput>;

/**
 * A workspace the signed in person may ask to join (AC-819): its domain is
 * their verified email's. `pending` once they asked (a decline reads the
 * same for 30 days).
 */
export const Joinable = z.object({
  workspaceId: Uuid,
  name: z.string(),
  state: z.enum(['none', 'pending']),
});
/** A workspace the person may ask to join. */
export type Joinable = z.infer<typeof Joinable>;

/** `/join` (bootstrap, AC-819): the workspaces to ask to join, and asking. */
export const joinContract = {
  list: oc.output(z.array(Joinable)),
  request: oc.input(z.object({ workspaceId: Uuid })).output(Joinable),
};

/**
 * Domain join, inside a workspace (AC-819, AC-820): its email domains
 * (`workspace.manage`), and the open requests and their decisions
 * (`members.invite`).
 */
export const joinRequestsContract = {
  domains: oc.input(WorkspaceScoped).output(WorkspaceDomainsView),
  setDomains: oc.input(SetWorkspaceDomainsInput).output(WorkspaceDomainsView),
  list: oc.input(WorkspaceScoped).output(z.array(JoinRequestView)),
  decide: oc.input(DecideJoinRequestInput).output(z.void()),
};

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
  /** The invite link (slice 6, AC-818): `members.invite`. */
  link: oc.input(WorkspaceScoped).output(InviteLinkView),
  setLink: oc.input(SetInviteLinkInput).output(InviteLinkView),
};

/** An address as an invitation shows it to someone who may not own it (AC-805): `a***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}
