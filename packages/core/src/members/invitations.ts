// Invitations into a workspace (spec 0031, slices 2 and 6): inviting by
// email, the open list, resend and revoke, the workspace's invite link, the
// peek `/invite/:token` shows, and accepting. Holders of `members.invite` manage them; only owners invite
// owners. A token is 32 random bytes; an email invitation's is handed back to
// the caller once, to email, and only its SHA-256 is stored, while the invite
// link keeps its own so an admin can copy it again. Every invite, resend, revoke and accept writes
// its audit row in its own transaction.
import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  INVITE_BATCH_MAX,
  INVITE_LINK_DAYS,
  INVITE_LINK_USES_MAX,
  INVITES_LIMIT,
  maskEmail,
  memberNameFor,
  OWNER_RULES_MESSAGE,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SEAT_LIMIT_MESSAGE,
  type InvitationView,
  type InviteLinkRole,
  type InviteLinkView,
  type InvitePeek,
  type InviteRefused,
  type Role,
} from '@crm/contracts';
import { schema, type Database, type IdentityStore, type WorkspaceTx } from '@crm/db';
import { checkId, newId } from '../engine/ids.ts';
import { limitsOf } from '../engine/limits.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { recordJoinReach } from '../scheduling/delegations.ts';
import { enterInvitation, inviteInvalid, inviteTokenHash, type EnteredInvitation } from '../access/door.ts';
import { checkScope } from '../access/mint.ts';
import { can, isRole } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { touched } from '../engine/definitions.ts';
import { writeAudit, type AuditSource } from './audit.ts';
import { welcomeMember } from './welcome.ts';

const { invitations, members, workspaces } = schema;

/** How long an email invitation works after its last send, as SQL (`INVITE_DAYS`, 7). */
const INVITE_WINDOW = sql`now() + interval '7 days'`;

const INVITATION_NOT_FOUND = "That invitation doesn't exist.";

/** A fresh token (32 random bytes, base64url) and the hash the database keeps. */
function mintToken(): { readonly token: string; readonly hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: inviteTokenHash(token) };
}

/** An invitation just sent, with the token for its email: the caller mails it and never keeps it. */
export interface SentInvitation {
  readonly invitation: InvitationView;
  readonly token: string;
  /** How many times its email has gone out, this send included: the mail's idempotency key is the id plus this. */
  readonly sendCount: number;
}

/** What the invitation email names: the workspace, and the sender by their name in it (empty for the system). */
export interface InviteSender {
  readonly workspaceName: string;
  readonly inviterName: string;
}

/** What `inviteMembers` did: the invitations to mail, the addresses refused, and who the email says sent them. */
export interface InviteOutcome extends InviteSender {
  readonly sent: readonly SentInvitation[];
  readonly refused: readonly InviteRefused[];
}

/** The workspace's name and the actor's, for the email, read in the write's transaction. */
async function senderOf(tx: WorkspaceTx, scope: EngineScope): Promise<InviteSender> {
  const [workspace] = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, scope.workspaceId));
  const { principal } = scope.access;
  if (principal.kind !== 'member') return { workspaceName: workspace?.name ?? '', inviterName: '' };
  const [self] = await tx
    .select({ name: members.name })
    .from(members)
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, principal.memberId)));
  return { workspaceName: workspace?.name ?? '', inviterName: self?.name ?? '' };
}

/** Options every invitation write takes: where the request came from, for the audit row, and the send limit. */
export interface InviteWriteOptions {
  readonly source?: AuditSource;
  /**
   * Counts `sends` emails against the caller's send limits (AC-808), or
   * throws: called once the caller is known to be allowed to send them, so a
   * refused caller spends nobody's limit, and before anything is written.
   */
  readonly limit?: (sends: number) => Promise<void>;
}

/** The actor's role as the invitation rules judge it: a member's own, the system as an owner. */
function actingRole(scope: EngineScope): Role | undefined {
  const { principal } = scope.access;
  if (principal.kind === 'system') return 'owner';
  return principal.kind === 'member' ? principal.role : undefined;
}

/** Refuses FORBIDDEN unless the scope holds `members.invite`, before anything is read. */
export function checkInvites(scope: EngineScope): void {
  checkScope(scope);
  if (!can(scope.access, 'members.invite')) throw refuse('FORBIDDEN', PERMISSIONS['members.invite'].message);
}

/**
 * The acting member's role now, read under lock, so one demoted or removed
 * since the request came in acts with what they hold now; the door's answer
 * for one who is no longer a member. Refuses FORBIDDEN when that role can't
 * invite, or can't touch an owner invitation (`role`). Answers the role it
 * acts with.
 */
export async function checkActingNow(tx: WorkspaceTx, scope: EngineScope, role: Role): Promise<Role | undefined> {
  const { principal } = scope.access;
  let acting = actingRole(scope);
  if (principal.kind === 'member') {
    const [self] = await tx
      .select({ role: members.role })
      .from(members)
      .where(
        and(
          eq(members.workspaceId, scope.workspaceId),
          eq(members.id, principal.memberId),
          eq(members.status, 'active'),
        ),
      )
      .for('share');
    if (self === undefined || !isRole(self.role)) {
      throw refuse('NOT_FOUND', "That workspace doesn't exist, or you're not a member of it.");
    }
    acting = self.role;
    if (!(ROLE_PERMISSIONS[acting] as readonly string[]).includes('members.invite')) {
      throw refuse('FORBIDDEN', PERMISSIONS['members.invite'].message);
    }
  }
  if (role === 'owner' && acting !== 'owner') throw refuse('FORBIDDEN', OWNER_RULES_MESSAGE);
  return acting;
}

/**
 * Whether the member who last sent an invitation still vouches for it (spec
 * 0031, key invariants): still active, and still holding what sending it
 * took, an owner for an owner invitation and `members.invite` for any
 * other. One sent by the system always stands. An invitation nobody vouches
 * for any more opens nothing, so an owner or admin removed or demoted can't
 * come back through an invitation they sent before.
 */
function isVouchedFor(sent: {
  readonly role: Role;
  readonly sentByType: string;
  readonly senderStatus: string | null;
  readonly senderRole: string | null;
}): boolean {
  if (sent.sentByType === 'system') return true;
  if (sent.sentByType !== 'member' || sent.senderStatus !== 'active') return false;
  const senderRole = sent.senderRole ?? '';
  if (!isRole(senderRole)) return false;
  if (sent.role === 'owner') return senderRole === 'owner';
  return (ROLE_PERMISSIONS[senderRole] as readonly string[]).includes('members.invite');
}

/**
 * Where a member stands after a role change or removal, for the invitations they last sent: removed, or the role
 * they now hold.
 */
export type SenderStanding = Role | 'removed';

/**
 * The open invitations (email ones and the link) `memberId` last sent that `standing` no longer vouches for
 * (`isVouchedFor`): all of them once removed or without `members.invite`, an admin's owner invitations only.
 * Undefined when they all still stand.
 */
function unvouchedBy(workspaceId: string, memberId: string, standing: SenderStanding) {
  const invites =
    standing !== 'removed' && (ROLE_PERMISSIONS[standing] as readonly string[]).includes('members.invite');
  if (invites && standing === 'owner') return undefined;
  return and(
    eq(invitations.workspaceId, workspaceId),
    eq(invitations.status, 'open'),
    eq(invitations.updatedByType, 'member'),
    eq(invitations.updatedByMemberId, memberId),
    ...(invites ? [eq(invitations.role, 'owner')] : []),
  );
}

/** How many open invitations `memberId` sent would stop opening anything at `standing`, for the remove dialog. */
export async function countUnvouched(
  tx: WorkspaceTx,
  workspaceId: string,
  memberId: string,
  standing: SenderStanding,
): Promise<number> {
  const where = unvouchedBy(workspaceId, memberId, standing);
  if (where === undefined) return 0;
  const [found] = await tx.select({ n: count() }).from(invitations).where(where);
  return found?.n ?? 0;
}

/**
 * Revokes the open invitations `memberId` sent that `standing` no longer vouches for, inside the role change or
 * removal's own transaction, each with its audit row. They opened nothing from that moment anyway; revoked, the
 * Invitations tab and the link's card stop showing them as open and they stop holding seats, and the caller says
 * how many went so they can be sent again (late trap: they died with nobody told). Answers how many.
 */
export async function revokeUnvouched(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
  standing: SenderStanding,
  source?: AuditSource,
): Promise<number> {
  const where = unvouchedBy(scope.workspaceId, memberId, standing);
  if (where === undefined) return 0;
  // No invitations lock: the caller holds the member's row, which revokeInvite takes after that lock, and revoking
  // only frees seats, so a count read beside it errs high, never low. A row resent meanwhile is someone else's.
  const revoked = await tx
    .update(invitations)
    .set({ status: 'revoked', ...touched(scope) })
    .where(where)
    .returning({ id: invitations.id, kind: invitations.kind });
  for (const row of revoked) {
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      {
        action: row.kind === 'link' ? 'invitation.link_revoked' : 'invitation.revoked',
        targetType: 'invitation',
        targetId: row.id,
        before: { status: 'open' },
        after: { status: 'revoked' },
      },
      source,
    );
  }
  return revoked.length;
}

/** Takes turns with every other invitation write in the workspace, so the counts below stay exact. */
async function lockInvitations(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`invitations:${workspaceId}`}, 0))`);
}

/**
 * Seats in use (spec 0031, AC-809): active non guest members plus open non
 * guest email invitations. Guests (slice 9) never count.
 */
export async function seatsUsed(tx: WorkspaceTx, workspaceId: string): Promise<number> {
  const [active] = await tx
    .select({ n: count() })
    .from(members)
    .where(
      and(eq(members.workspaceId, workspaceId), eq(members.status, 'active'), sql`${members.role}::text <> 'guest'`),
    );
  const [invited] = await tx
    .select({ n: count() })
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.status, 'open'),
        eq(invitations.kind, 'email'),
        sql`${invitations.role}::text <> 'guest'`,
      ),
    );
  return (active?.n ?? 0) + (invited?.n ?? 0);
}

/**
 * Refuses 409 `SEAT_LIMIT` when `adding` more seats would pass the plan's (unlimited until #38). Counted under the
 * invitations lock (taken again here, which a caller holding it already passes through), so two seat takers at once
 * (a guest made a member beside an invite) take turns and never both fit the last seat.
 */
export async function checkSeats(tx: WorkspaceTx, scope: EngineScope, adding: number): Promise<void> {
  if (adding <= 0) return;
  const limit = limitsOf(scope).seats;
  if (!Number.isFinite(limit)) return;
  await lockInvitations(tx, scope.workspaceId);
  if ((await seatsUsed(tx, scope.workspaceId)) + adding > limit) throw refuse('SEAT_LIMIT', SEAT_LIMIT_MESSAGE);
}

/** The member who last sent an invitation (its creator, or whoever resent it since): who the email and page name. */
const inviter = alias(members, 'inviter');

/** The open invitations with these ids (or all open ones), as the Invitations tab shows them, newest first. */
async function viewsOf(tx: WorkspaceTx, workspaceId: string, ids?: readonly string[]): Promise<InvitationView[]> {
  const rows = await tx
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      invitedBy: inviter.name,
      invitedAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      isExpired: sql<boolean>`${invitations.expiresAt} <= now()`,
    })
    .from(invitations)
    .leftJoin(
      inviter,
      and(eq(inviter.workspaceId, invitations.workspaceId), eq(inviter.id, invitations.updatedByMemberId)),
    )
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.status, 'open'),
        eq(invitations.kind, 'email'),
        ...(ids === undefined ? [] : [inArray(invitations.id, [...ids])]),
      ),
    )
    .orderBy(desc(invitations.createdAt), asc(invitations.id))
    // At most the cap of open invitations exists, so one page holds them all.
    .limit(INVITES_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    kind: 'email' as const,
    email: row.email ?? '',
    role: isRole(row.role) ? row.role : 'member',
    invitedBy: row.invitedBy ?? '',
    invitedAt: new Date(row.invitedAt).toISOString(),
    expiresAt: new Date(row.expiresAt ?? row.invitedAt).toISOString(),
    isExpired: row.isExpired,
  }));
}

/** Lowercased, trimmed and without repeats, in the order given. */
function addresses(emails: readonly string[]): string[] {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter((email) => email !== ''))];
}

/**
 * Invites 1 to 20 addresses with one role (spec 0031, AC-803, AC-804,
 * AC-808, AC-809): needs `members.invite`, and only an owner invites as
 * owner. An address that is already an active member is refused on its own
 * ("Already a member"); one with an open invitation has it resent (new
 * token, a fresh 7 days, the old link dead); the rest get new invitations.
 * Refuses 409 `INVITES_LIMIT` past 100 open invitations and 409
 * `SEAT_LIMIT` when the plan has no seat for the new ones. One audit row per
 * invitation. Answers each invitation with its token, for the caller to
 * email; the token is never stored.
 */
export async function inviteMembers(
  scope: EngineScope,
  input: { readonly emails: readonly string[]; readonly role: Role },
  hooks: readonly AfterWrite[] = [],
  options: InviteWriteOptions = {},
): Promise<InviteOutcome> {
  checkInvites(scope);
  if (!isRole(input.role)) throw refuse('CONFIG_INVALID', 'Pick a role.');
  const role = input.role;
  if (role === 'owner' && actingRole(scope) !== 'owner') throw refuse('FORBIDDEN', OWNER_RULES_MESSAGE);
  const wanted = addresses(input.emails);
  if (wanted.length === 0 || wanted.length > INVITE_BATCH_MAX) {
    throw refuse('CONFIG_INVALID', `Invite 1 to ${String(INVITE_BATCH_MAX)} email addresses at once.`);
  }
  await options.limit?.(wanted.length);
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const acting = await checkActingNow(tx, scope, role);
      await lockInvitations(tx, scope.workspaceId);
      const already = await tx
        .select({ email: sql<string>`lower(${members.email})` })
        .from(members)
        .where(
          and(
            eq(members.workspaceId, scope.workspaceId),
            eq(members.status, 'active'),
            inArray(sql`lower(${members.email})`, wanted),
          ),
        );
      const memberEmails = new Set(already.map((row) => row.email));
      const refused: InviteRefused[] = wanted
        .filter((email) => memberEmails.has(email))
        .map((email) => ({ email, code: 'ALREADY_MEMBER' as const, message: 'Already a member' }));
      const toInvite = wanted.filter((email) => !memberEmails.has(email));
      const sender = await senderOf(tx, scope);
      if (toInvite.length === 0) return { ...sender, sent: [], refused };
      const open = await tx
        .select({ id: invitations.id, email: invitations.email, role: invitations.role })
        .from(invitations)
        .where(
          and(
            eq(invitations.workspaceId, scope.workspaceId),
            eq(invitations.status, 'open'),
            eq(invitations.kind, 'email'),
            inArray(invitations.email, toInvite),
          ),
        )
        .for('update');
      // Only an owner touches an owner's invitation, here as on Resend and Revoke: re-inviting the address would
      // otherwise rewrite its role and kill its link.
      if (acting !== 'owner' && open.some((row) => row.role === 'owner')) {
        throw refuse('FORBIDDEN', OWNER_RULES_MESSAGE);
      }
      const openByEmail = new Map(open.map((row) => [row.email ?? '', row]));
      const fresh = toInvite.filter((email) => !openByEmail.has(email));
      const [openCount] = await tx
        .select({ n: count() })
        .from(invitations)
        .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.status, 'open')));
      const cap = limitsOf(scope).openInvitations;
      if ((openCount?.n ?? 0) + fresh.length > cap) {
        throw refuse('INVITES_LIMIT', `A workspace holds at most ${String(cap)} open invitations. Revoke some first.`);
      }
      // A resent invitation already holds its seat, unless it was a guest's and now isn't; each new one takes one. A
      // guest takes none (spec 0031, AC-809).
      const seated = role === 'guest' ? 0 : fresh.length + open.filter((row) => row.role === 'guest').length;
      await checkSeats(tx, scope, seated);
      const sent: { id: string; token: string; sendCount: number; resent: boolean; was?: Role }[] = [];
      const by = touched(scope);
      for (const email of toInvite) {
        const { token, hash } = mintToken();
        const earlier = openByEmail.get(email);
        if (earlier !== undefined) {
          const [row] = await tx
            .update(invitations)
            .set({
              tokenHash: hash,
              role,
              sendCount: sql`${invitations.sendCount} + 1`,
              lastSentAt: sql`now()`,
              expiresAt: INVITE_WINDOW,
              ...by,
            })
            .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.id, earlier.id)))
            .returning({ sendCount: invitations.sendCount });
          sent.push({
            id: earlier.id,
            token,
            sendCount: row?.sendCount ?? 1,
            resent: true,
            ...(isRole(earlier.role) ? { was: earlier.role } : {}),
          });
        } else {
          const id = newId();
          await tx.insert(invitations).values({
            workspaceId: scope.workspaceId,
            id,
            kind: 'email',
            email,
            role,
            tokenHash: hash,
            maxUses: 1,
            sendCount: 1,
            lastSentAt: sql`now()`,
            expiresAt: INVITE_WINDOW,
            createdByType: by.updatedByType,
            createdById: by.updatedById,
            createdByMemberId: by.updatedByMemberId,
            updatedByType: by.updatedByType,
            updatedById: by.updatedById,
            updatedByMemberId: by.updatedByMemberId,
          });
          sent.push({ id, token, sendCount: 1, resent: false });
        }
      }
      for (const each of sent) {
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          each.resent
            ? {
                action: 'invitation.resent',
                targetType: 'invitation',
                targetId: each.id,
                ...(each.was !== undefined && each.was !== role ? { before: { role: each.was }, after: { role } } : {}),
              }
            : {
                action: 'invitation.created',
                targetType: 'invitation',
                targetId: each.id,
                // The address stays in `invitations`: the log names the invitation, never personal data it can't drop.
                after: { role },
              },
          options.source,
        );
      }
      const views = new Map(
        (
          await viewsOf(
            tx,
            scope.workspaceId,
            sent.map((each) => each.id),
          )
        ).map((view) => [view.id, view]),
      );
      return {
        ...sender,
        refused,
        sent: sent.flatMap((each) => {
          const invitation = views.get(each.id);
          return invitation === undefined ? [] : [{ invitation, token: each.token, sendCount: each.sendCount }];
        }),
      };
    },
    hooks,
  );
  return result;
}

/** The workspace's open email invitations, newest first (spec 0031, AC-810): holders of `members.invite` only. */
export async function listInvitations(scope: EngineScope): Promise<InvitationView[]> {
  checkInvites(scope);
  return inWorkspace(scope, (tx) => viewsOf(tx, scope.workspaceId));
}

/** One open email invitation of the workspace, locked when `lock`, or refuses NOT_FOUND. */
async function findOpen(tx: WorkspaceTx, scope: EngineScope, invitationId: string, lock = true) {
  const query = tx
    .select({ id: invitations.id, email: invitations.email, role: invitations.role })
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, scope.workspaceId),
        eq(invitations.id, invitationId),
        eq(invitations.status, 'open'),
        eq(invitations.kind, 'email'),
      ),
    );
  const [row] = await (lock ? query.for('update') : query);
  if (row === undefined || !isRole(row.role)) throw refuse('NOT_FOUND', INVITATION_NOT_FOUND);
  return { id: row.id, email: row.email ?? '', role: row.role };
}

/**
 * Sends an open invitation again (spec 0031, AC-804): a new token (the old
 * link stops working), a fresh 7 days and one more send. Needs
 * `members.invite`; an owner invitation needs an owner.
 */
export async function resendInvite(
  scope: EngineScope,
  input: { readonly invitationId: string },
  hooks: readonly AfterWrite[] = [],
  options: InviteWriteOptions = {},
): Promise<SentInvitation & InviteSender> {
  checkInvites(scope);
  const invitationId = checkId(input.invitationId, INVITATION_NOT_FOUND);
  if (options.limit !== undefined) {
    // Which invitation, and whether this caller may resend it, are known before a send is counted (AC-808), so a
    // refused resend spends nobody's limit. The write checks both again under lock.
    const found = await inWorkspace(scope, (tx) => findOpen(tx, scope, invitationId, false));
    if (found.role === 'owner' && actingRole(scope) !== 'owner') throw refuse('FORBIDDEN', OWNER_RULES_MESSAGE);
    await options.limit(1);
  }
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      await lockInvitations(tx, scope.workspaceId);
      const open = await findOpen(tx, scope, invitationId);
      await checkActingNow(tx, scope, open.role);
      const { token, hash } = mintToken();
      const [row] = await tx
        .update(invitations)
        .set({
          tokenHash: hash,
          sendCount: sql`${invitations.sendCount} + 1`,
          lastSentAt: sql`now()`,
          expiresAt: INVITE_WINDOW,
          ...touched(scope),
        })
        // Still open: a role change or removal revoking its sender's invitations takes no invitations lock.
        .where(
          and(
            eq(invitations.workspaceId, scope.workspaceId),
            eq(invitations.id, open.id),
            eq(invitations.status, 'open'),
          ),
        )
        .returning({ sendCount: invitations.sendCount });
      if (row === undefined) throw refuse('NOT_FOUND', INVITATION_NOT_FOUND);
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        { action: 'invitation.resent', targetType: 'invitation', targetId: open.id },
        options.source,
      );
      const [invitation] = await viewsOf(tx, scope.workspaceId, [open.id]);
      if (invitation === undefined) throw new Error('The invitation just resent was not read back.');
      return { ...(await senderOf(tx, scope)), invitation, token, sendCount: row.sendCount };
    },
    hooks,
  );
  return result;
}

/** Revokes an open invitation (spec 0031, AC-804): its link stops working at once. Needs `members.invite`. */
export async function revokeInvite(
  scope: EngineScope,
  input: { readonly invitationId: string },
  hooks: readonly AfterWrite[] = [],
  options: InviteWriteOptions = {},
): Promise<void> {
  checkInvites(scope);
  const invitationId = checkId(input.invitationId, INVITATION_NOT_FOUND);
  await runWrite(
    scope,
    async ({ tx }) => {
      await lockInvitations(tx, scope.workspaceId);
      const open = await findOpen(tx, scope, invitationId);
      await checkActingNow(tx, scope, open.role === 'owner' ? 'owner' : 'member');
      await tx
        .update(invitations)
        .set({ status: 'revoked', ...touched(scope) })
        .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.id, open.id)));
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'invitation.revoked',
          targetType: 'invitation',
          targetId: open.id,
          before: { status: 'open' },
          after: { status: 'revoked' },
        },
        options.source,
      );
    },
    hooks,
  );
}

/** An invitation as acceptance reads it, inside its workspace. */
interface HeldInvitation {
  readonly id: string;
  readonly kind: 'email' | 'link';
  /** How many it may let in (one for an email invitation; none for an uncapped link) and has. */
  readonly maxUses: number | null;
  readonly uses: number;
  readonly email: string;
  readonly role: Role;
  readonly status: string;
  readonly live: boolean;
  readonly usedBy: string | null;
  readonly inviterName: string | null;
  /** Whoever last sent it still vouches for it (`isVouchedFor`). */
  readonly isVouched: boolean;
  readonly workspaceName: string;
  readonly slug: string;
}

/**
 * Whether an open invitation opens anything now: open, unexpired, still
 * vouched for by its sender, and (a link) not yet at its most uses.
 */
const opensNow = (held: HeldInvitation): boolean =>
  held.status === 'open' &&
  held.live &&
  held.isVouched &&
  (held.kind === 'email' || held.maxUses === null || held.uses < held.maxUses);

/**
 * The invitation `entered` names, with its workspace and the member who last
 * sent it, in a live workspace; locked when `lock`. Read by id and by the
 * token's hash, so a link a resend replaced a moment ago opens nothing.
 */
async function readInvitation(tx: WorkspaceTx, workspaceId: string, entered: EnteredInvitation, lock: boolean) {
  const query = tx
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      status: invitations.status,
      kind: invitations.kind,
      // An email invitation always has an expiry; a link without one never expires.
      live: sql<boolean>`coalesce(${invitations.expiresAt} > now(), ${invitations.kind} = 'link')`,
      maxUses: invitations.maxUses,
      uses: invitations.uses,
      usedBy: invitations.usedByMemberId,
      sentByType: invitations.updatedByType,
      inviterName: inviter.name,
      senderStatus: inviter.status,
      senderRole: inviter.role,
      workspaceName: workspaces.name,
      slug: workspaces.slug,
      deletedAt: workspaces.deletedAt,
    })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .leftJoin(
      inviter,
      and(eq(inviter.workspaceId, invitations.workspaceId), eq(inviter.id, invitations.updatedByMemberId)),
    )
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.id, entered.invitationId),
        eq(invitations.tokenHash, entered.tokenHash),
      ),
    );
  const [row] = await (lock ? query.for('update', { of: invitations }) : query);
  if (row === undefined || (row.kind !== 'email' && row.kind !== 'link') || row.deletedAt !== null) return undefined;
  if (!isRole(row.role)) return undefined;
  const held: HeldInvitation = {
    id: row.id,
    kind: row.kind,
    maxUses: row.maxUses,
    uses: row.uses,
    email: row.email ?? '',
    role: row.role,
    status: row.status,
    live: row.live,
    usedBy: row.usedBy,
    inviterName: row.inviterName,
    isVouched: isVouchedFor({
      role: row.role,
      sentByType: row.sentByType,
      senderStatus: row.senderStatus,
      senderRole: row.senderRole,
    }),
    workspaceName: row.workspaceName,
    slug: row.slug,
  };
  return held;
}

/**
 * What `/invite/:token` shows (spec 0031, AC-805): the workspace, who
 * invited, the role and the address masked. Every token that doesn't open an
 * invitation now (malformed, unknown, expired, revoked or used) answers the
 * same `INVITE_INVALID`. The caller limits it to 20 a minute per IP.
 */
export async function peekInvite(deps: { readonly db: Database }, token: string): Promise<InvitePeek> {
  const { scope, ...entered } = await enterInvitation(deps, token);
  const held = await inWorkspace(scope, (tx) => readInvitation(tx, scope.workspaceId, entered, false));
  if (held === undefined || !opensNow(held)) throw inviteInvalid();
  return {
    workspaceName: held.workspaceName,
    inviterName: held.inviterName ?? '',
    role: held.role,
    ...(held.kind === 'email' ? { invitedEmailMasked: maskEmail(held.email) } : {}),
  };
}

/** The signed in person accepting, as the session knows them. */
export interface AcceptingUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  /** The name they typed on the invite card (QA N14): made plain, it wins over the account's; empty, it is skipped. */
  readonly typedName?: string;
}

/** The workspace an accepted invitation opened, and the member it made (or found). */
export interface AcceptedInvite {
  readonly slug: string;
  readonly workspaceId: string;
  readonly memberId: string;
}

/** What a person whose verified email isn't the invited one is told (AC-805); they join nothing. */
function mismatch(email: string) {
  return refuse(
    'INVITE_EMAIL_MISMATCH',
    `This invitation is for ${maskEmail(email)}. Sign in with that address to accept.`,
  );
}

/**
 * Accepts an email invitation (spec 0031, AC-805, AC-806): the signed in
 * person's verified email must be the invited one. In one transaction: an
 * active member with the invitation's role (a returning removed person gets
 * a new row), their directory membership, the invitation used, a `members`
 * outbox row (through `hooks`) and an audit row. A person already in the
 * workspace (two tabs accepting) is answered with the workspace again and
 * joins once. A new member is named with what they typed on the invite
 * card, made plain (QA N14), else as before; once the accept stands, that
 * name also fills in an account name still empty. Refuses `INVITE_INVALID`, `INVITE_EMAIL_MISMATCH` and
 * `SEAT_LIMIT`.
 */
export async function acceptInvite(
  deps: {
    readonly db: Database;
    /** Fills in the account's name from the typed one when it is still empty, as first run does (QA N14). */
    readonly identity?: Pick<IdentityStore, 'setUserNameIfEmpty'>;
  },
  user: AcceptingUser,
  token: string,
  hooks: readonly AfterWrite[] = [],
  options: InviteWriteOptions = {},
): Promise<AcceptedInvite> {
  const { scope, ...entered } = await enterInvitation(deps, token);
  const email = user.email.trim().toLowerCase();
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const held = await readInvitation(tx, scope.workspaceId, entered, true);
      if (held === undefined) throw inviteInvalid();
      const [mine] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(eq(members.workspaceId, scope.workspaceId), eq(members.userId, user.id), eq(members.status, 'active')),
        )
        .for('update');
      const opened = { slug: held.slug, workspaceId: scope.workspaceId };
      // Already in (the other tab got there first): the same answer, nothing joins twice.
      if (held.status === 'used' && mine !== undefined && held.usedBy === mine.id)
        return { ...opened, memberId: mine.id };
      if (!opensNow(held)) throw inviteInvalid();
      if (held.kind === 'link') return joinByLink(context, held, user, email, mine?.id, options);
      if (!user.emailVerified || held.email !== email) throw mismatch(held.email);
      if (mine !== undefined) {
        // In already by another way: the invitation is spent, and they stay as they are, with its row in the log.
        await tx
          .update(invitations)
          .set({ status: 'used', uses: sql`${invitations.uses} + 1`, usedByMemberId: mine.id, ...touched(scope) })
          .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.id, held.id)));
        await writeAudit(
          tx,
          scope.workspaceId,
          { type: 'member', id: mine.id },
          {
            action: 'invitation.accepted',
            targetType: 'invitation',
            targetId: held.id,
            before: { status: 'open' },
            after: { status: 'used', alreadyMember: true },
          },
          options.source,
        );
        return { ...opened, memberId: mine.id };
      }
      const [taken] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.workspaceId, scope.workspaceId),
            eq(members.status, 'active'),
            sql`lower(${members.email}) = ${email}`,
            ne(members.userId, user.id),
          ),
        )
        .limit(1);
      if (taken !== undefined) throw inviteInvalid();
      // Its own seat is already counted while it is open; a plan lowered since it was sent is checked here.
      const limit = limitsOf(scope).seats;
      if (Number.isFinite(limit) && (await seatsUsed(tx, scope.workspaceId)) > limit) {
        throw refuse('SEAT_LIMIT', SEAT_LIMIT_MESSAGE);
      }
      const memberId = newId();
      // The name typed on the invite card made plain (QA N14), else their account's, else one made from the address
      // as first run makes it ("Jo Smith", QA Q83).
      const name = joinerName(user.typedName, user.name, email);
      await tx.insert(members).values({
        workspaceId: scope.workspaceId,
        id: memberId,
        userId: user.id,
        name: name.slice(0, 80),
        email,
        role: held.role,
        createdByType: 'system',
        updatedByType: 'system',
      });
      // The directory's "my workspaces" row, in this transaction; one left behind by an earlier membership stays.
      await tx.execute(
        sql`insert into auth.workspace_membership (user_id, workspace_id, member_id) values (${user.id}, ${scope.workspaceId}, ${memberId}) on conflict do nothing`,
      );
      await tx
        .update(invitations)
        .set({ status: 'used', uses: sql`${invitations.uses} + 1`, usedByMemberId: memberId, ...touched(scope) })
        .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.id, held.id)));
      await writeAudit(
        tx,
        scope.workspaceId,
        { type: 'member', id: memberId },
        {
          action: 'invitation.accepted',
          targetType: 'member',
          targetId: memberId,
          after: { role: held.role, invitationId: held.id },
        },
        options.source,
      );
      // Their link page, made with the membership, and the welcome that says where it lives (26 Oct 2026).
      await welcomeMember(tx, {
        memberId,
        userId: user.id,
        workspaceId: scope.workspaceId,
        slug: held.slug,
        name,
        email,
        isGuest: held.role === 'guest',
      });
      // Everyone's member list reads them in (spec 0007, AC-82), and an everyone delegation reaches them (AC-1274).
      context.record({ members: [memberId] });
      await recordJoinReach(context, scope.workspaceId, memberId);
      return { ...opened, memberId };
    },
    hooks,
  );
  // After the accept commits (a join, or one already in): the account's name, only while it has none (first run's
  // rule). Best effort: the join stands either way, so a failure here never reads as a refused invitation.
  const typed = typedMemberName(user.typedName);
  if (typed !== '' && deps.identity !== undefined) {
    await deps.identity.setUserNameIfEmpty(user.id, typed).catch(() => false);
  }
  return result;
}

/** An expiry `days` from now, as SQL. */
const LINK_EXPIRY = (days: number) => sql`now() + make_interval(days => ${days})`;

/**
 * Joins the signed in person through the invite link (AC-818): a verified
 * email, a seat (the link holds none while open), an active member with the
 * link's role, their directory row, one more use on the link, a `members`
 * outbox row and an audit row. One already in is answered with the
 * workspace, and the link spends nothing.
 */
async function joinByLink(
  context: WriteContext,
  held: HeldInvitation,
  user: AcceptingUser,
  email: string,
  mineId: string | undefined,
  options: InviteWriteOptions,
): Promise<AcceptedInvite> {
  const { tx, scope } = context;
  const opened = { slug: held.slug, workspaceId: scope.workspaceId };
  if (mineId !== undefined) return { ...opened, memberId: mineId };
  if (!user.emailVerified) {
    throw refuse('INVITE_EMAIL_MISMATCH', 'Verify your email address first, then open the link again.');
  }
  // Someone else in the workspace already holds this address: the link can't make a second member with it.
  const [taken] = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.workspaceId, scope.workspaceId),
        eq(members.status, 'active'),
        sql`lower(${members.email}) = ${email}`,
      ),
    )
    .limit(1);
  if (taken !== undefined) throw inviteInvalid();
  // A guest takes no seat (spec 0031, AC-809).
  await checkSeats(tx, scope, held.role === 'guest' ? 0 : 1);
  const memberId = await addJoiner(
    tx,
    scope.workspaceId,
    { id: user.id, name: user.name, email, ...(user.typedName === undefined ? {} : { typedName: user.typedName }) },
    held.role,
  );
  await welcomeMember(tx, {
    memberId,
    userId: user.id,
    workspaceId: scope.workspaceId,
    slug: held.slug,
    name: joinerName(user.typedName, user.name, email),
    email,
    isGuest: held.role === 'guest',
  });
  // The link stays open for the next person; its uses count up to its most.
  await tx
    .update(invitations)
    .set({ uses: sql`${invitations.uses} + 1`, updatedAt: sql`now()` })
    .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.id, held.id)));
  await writeAudit(
    tx,
    scope.workspaceId,
    { type: 'member', id: memberId },
    {
      action: 'invitation.accepted',
      targetType: 'member',
      targetId: memberId,
      after: { role: held.role, invitationId: held.id, via: 'link' },
    },
    options.source,
  );
  context.record({ members: [memberId] });
  await recordJoinReach(context, scope.workspaceId, memberId);
  return { ...opened, memberId };
}

/** The open invite link's row, locked when `lock`. */
async function openLink(tx: WorkspaceTx, workspaceId: string, lock: boolean) {
  const query = tx
    .select({
      id: invitations.id,
      role: invitations.role,
      linkToken: invitations.linkToken,
      expiresAt: invitations.expiresAt,
      maxUses: invitations.maxUses,
      uses: invitations.uses,
      isExpired: sql<boolean>`coalesce(${invitations.expiresAt} <= now(), false)`,
    })
    .from(invitations)
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.status, 'open'), eq(invitations.kind, 'link')));
  const [row] = await (lock ? query.for('update') : query);
  return row;
}

/** The link as the card shows it, from its row (or off without one). */
function linkView(row: Awaited<ReturnType<typeof openLink>>): InviteLinkView {
  if (row === undefined || row.linkToken === null) return { enabled: false, uses: 0, isSpent: false };
  return {
    enabled: true,
    token: row.linkToken,
    // Member or guest (AC-818, spec 0031 slice 9); anything else a link can't hold reads as the safer guest.
    role: row.role === 'member' || row.role === 'guest' ? row.role : 'guest',
    ...(row.expiresAt === null ? {} : { expiresAt: new Date(row.expiresAt).toISOString() }),
    ...(row.maxUses === null ? {} : { maxUses: row.maxUses }),
    uses: row.uses,
    isSpent: row.isExpired || (row.maxUses !== null && row.uses >= row.maxUses),
  };
}

/** The workspace's invite link (spec 0031, AC-818), for the Members page's card: holders of `members.invite` only. */
export async function getInviteLink(scope: EngineScope): Promise<InviteLinkView> {
  checkInvites(scope);
  return inWorkspace(scope, async (tx) => linkView(await openLink(tx, scope.workspaceId, false)));
}

/**
 * Turns the invite link on or off, or changes it (spec 0031, AC-818): needs
 * `members.invite`. Off revokes the open link. On makes one (a member's link
 * that never expires and has no cap, unless told otherwise) or changes the
 * open one in place, keeping its token; `reset` revokes it and makes a new
 * one with the same settings. An expiry counts from now. Making one counts
 * against the open invitation cap (409 `INVITES_LIMIT`). One audit row,
 * never the token.
 */
export async function setInviteLink(
  scope: EngineScope,
  input: {
    readonly enabled: boolean;
    readonly role?: InviteLinkRole;
    readonly expiresInDays?: number | null;
    readonly maxUses?: number | null;
    readonly reset?: boolean;
  },
  hooks: readonly AfterWrite[] = [],
  options: InviteWriteOptions = {},
): Promise<InviteLinkView> {
  checkInvites(scope);
  const days = input.expiresInDays;
  if (days !== undefined && days !== null && !(INVITE_LINK_DAYS as readonly number[]).includes(days)) {
    throw refuse('CONFIG_INVALID', 'Pick 1, 7 or 30 days, or no expiry.');
  }
  const uses = input.maxUses;
  if (uses !== undefined && uses !== null && (!Number.isInteger(uses) || uses < 1 || uses > INVITE_LINK_USES_MAX)) {
    throw refuse('CONFIG_INVALID', `Allow 1 to ${String(INVITE_LINK_USES_MAX)} uses, or no limit.`);
  }
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      await checkActingNow(tx, scope, 'member');
      await lockInvitations(tx, scope.workspaceId);
      const open = await openLink(tx, scope.workspaceId, true);
      const by = touched(scope);
      const revoke = async (id: string) => {
        await tx
          .update(invitations)
          .set({ status: 'revoked', ...by })
          .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.id, id)));
      };
      if (!input.enabled) {
        if (open === undefined) return linkView(undefined);
        await revoke(open.id);
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          {
            action: 'invitation.link_revoked',
            targetType: 'invitation',
            targetId: open.id,
            before: { status: 'open' },
            after: { status: 'revoked' },
          },
          options.source,
        );
        return linkView(undefined);
      }
      const expiresAt =
        days === undefined
          ? open === undefined
            ? null
            : open.expiresAt === null
              ? null
              : sql`${new Date(open.expiresAt).toISOString()}::timestamptz`
          : days === null
            ? null
            : LINK_EXPIRY(days);
      const maxUses = uses === undefined ? (open?.maxUses ?? null) : uses;
      // The role it gives stays as it is unless named: changing only the expiry never turns a guest link into a
      // member one.
      const role = input.role ?? (open?.role === 'guest' ? 'guest' : 'member');
      const changes = {
        ...(input.role === undefined ? {} : { role }),
        ...(days === undefined ? {} : { expiresInDays: days }),
        ...(uses === undefined ? {} : { maxUses: uses }),
      };
      if (open !== undefined && input.reset !== true) {
        await tx
          .update(invitations)
          .set({ role, expiresAt, maxUses, ...by })
          .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.id, open.id)));
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          { action: 'invitation.link_set', targetType: 'invitation', targetId: open.id, after: changes },
          options.source,
        );
        return linkView(await openLink(tx, scope.workspaceId, false));
      }
      if (open !== undefined) await revoke(open.id);
      else {
        const [openCount] = await tx
          .select({ n: count() })
          .from(invitations)
          .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.status, 'open')));
        const cap = limitsOf(scope).openInvitations;
        if ((openCount?.n ?? 0) + 1 > cap) {
          throw refuse(
            'INVITES_LIMIT',
            `A workspace holds at most ${String(cap)} open invitations. Revoke some first.`,
          );
        }
      }
      const { token, hash } = mintToken();
      const id = newId();
      await tx.insert(invitations).values({
        workspaceId: scope.workspaceId,
        id,
        kind: 'link',
        role,
        tokenHash: hash,
        linkToken: token,
        expiresAt,
        maxUses,
        createdByType: by.updatedByType,
        createdById: by.updatedById,
        createdByMemberId: by.updatedByMemberId,
        updatedByType: by.updatedByType,
        updatedById: by.updatedById,
        updatedByMemberId: by.updatedByMemberId,
      });
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'invitation.link_set',
          targetType: 'invitation',
          targetId: id,
          after: { ...changes, role, ...(open === undefined ? { created: true } : { reset: true, replaces: open.id }) },
        },
        options.source,
      );
      return linkView(await openLink(tx, scope.workspaceId, false));
    },
    hooks,
  );
  return result;
}

/**
 * A person's name as a member is made with it, and as admins read it in the tab and the email (an accepted invite, a
 * link join, a request): control characters and line breaks become spaces, runs of space one, at most 80 characters;
 * a name made from the address when nothing is left, as first run makes it (QA Q83).
 */
export function plainName(raw: string, email: string): string {
  return memberNameFor(plainText(raw), '', email);
}

/**
 * Control characters and line breaks as spaces, runs of space as one, trimmed: `plainName`'s cleaning, alone. Marks
 * that turn text around or hide in it (direction overrides and isolates, the left and right marks, zero width space,
 * the byte order mark) go, so a name can't read as another's; the zero width joiners stay, which emoji and some
 * scripts need.
 */
function plainText(raw: string): string {
  return (
    raw
      .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * The name typed on the invite card (QA N14) made plain, at most 80 characters, or empty when nothing is left: what
 * a joiner's account is named when it has no name yet, as first run does with its Your name.
 */
export function typedMemberName(typed: string | undefined): string {
  // By characters, so a cut never splits an emoji in two.
  return Array.from(plainText(typed ?? ''))
    .slice(0, 80)
    .join('');
}

/**
 * A joiner's name: what they typed on the invite card, made plain (QA N14); when nothing of it is left, their
 * account's name made plain, else one made from the address (`plainName`).
 */
export function joinerName(typed: string | undefined, accountName: string, email: string): string {
  const name = typedMemberName(typed);
  return name === '' ? plainName(accountName, email) : name;
}

/**
 * Adds a signed in person as an active member with `role` (a link join, an
 * approved request): their name in the workspace (what they typed on the invite card, else their account's, else
 * one made from the address, as first run makes it), and their directory row, in the caller's
 * transaction. Answers the new member's id. The caller has checked the seat.
 */
export async function addJoiner(
  tx: WorkspaceTx,
  workspaceId: string,
  user: { readonly id: string; readonly name: string; readonly email: string; readonly typedName?: string },
  role: Role,
): Promise<string> {
  const memberId = newId();
  const name = joinerName(user.typedName, user.name, user.email);
  await tx.insert(members).values({
    workspaceId,
    id: memberId,
    userId: user.id,
    name: name.slice(0, 80),
    email: user.email,
    role,
    createdByType: 'system',
    updatedByType: 'system',
  });
  await tx.execute(
    sql`insert into auth.workspace_membership (user_id, workspace_id, member_id) values (${user.id}, ${workspaceId}, ${memberId}) on conflict do nothing`,
  );
  return memberId;
}
