// A connected app's person sets up their own Timefix login (spec 0070, AC-7023; owner, 10 Nov 2026: "as per industry
// standard and in favour of Timefix"). It rides the page hand over's invitation (`invitations.member_id`, migration
// 0203): one token mailed and only its hash kept, 7 days, single use, bound to its workspace and its member, and every
// write with its History row. Opening it (`claimPageInvite`) makes the person's own managed identity a login at the
// invited address, so they stay the same member with the same page, handle and history, and the identity is never
// merged with another login (AC-7021).
//
// - Who: a connected app's person here (`managed_members` with a partner), still the app's, active, with no login yet.
//   Their role stays theirs: the invitation gives none.
// - Who sends: the person themselves (from their page inside the app's frame), or someone holding
//   `link_pages.manage_team` and `members.invite` (Team pages; inside the app's frame, the app's admin, whom AC-7024
//   makes an Admin). Only an owner sends one for an owner, as only an owner invites one.
// - The address: anyone's but someone else's here (as a hand over). One that already has a Timefix login is refused
//   when the link is opened.
// - The app keeps them: their `managed_members` row stays, marked claimed (migration 0206), so the app's PUT, DELETE,
//   list and launch still find them. The app's DELETE then only lets go of them (`removePartnerMember`); they stay a
//   member with their login unless the workspace removes them.
import type { MyTimefixLogin, PageInviteCancelled } from '@crm/contracts';
import { isManagedAddress, schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { isTeamPageEdit } from '../access/door.ts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { touched } from '../engine/definitions.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit, type AuditSource } from './audit.ts';
import { actingRole, lockInvitations, senderOf, type InviteWriteOptions } from './invitations.ts';
import { addressTaken, openHandover, writeNamedInvite, type PageInviteToSend } from './page-handover.ts';
import { claimingPerson, handoverView, type ClaimingPerson } from './page-handover-read.ts';

const { invitations, managedMembers, partnerConnections } = schema;

const NOT_THEIRS = 'That person wasn’t added by a connected app, or already has their own Timefix login.';
const NOT_A_MEMBER = 'Only a member of this workspace asks for a Timefix login.';
const OWNERS_ONLY = 'Only an owner sets up a login for an owner.';
const ADDRESS_TAKEN = 'Someone in this workspace already uses this email, or was invited with it. Use another.';
const FRAME_MEMBERS_ONLY =
  'Inside a connected app, only a Member sets up a Timefix login. An owner or admin of the workspace sets one up for anyone else, in Timefix.';

/**
 * Where the call came from when it came from inside a connected app's embedded frame (spec 0070, AC-7031): that
 * session's connection. The api passes it from the session, never from the input.
 */
export interface ClaimFrame {
  readonly connectionId: string;
}

/** What asking for a login takes beside the invitation's options: the frame it was asked from, if any. */
export interface ClaimLoginOptions extends InviteWriteOptions {
  readonly frame?: ClaimFrame | undefined;
}

/** Whether the caller asks for their own login: a member acting as themselves, never through someone's page editor. */
function isSelf(scope: EngineScope, memberId: string): boolean {
  return scope.actor.type === 'member' && scope.actor.id === memberId && !isTeamPageEdit(scope);
}

/** The permissions someone other than the person needs: Team pages' and letting someone in with a login. */
function checkManager(scope: EngineScope, memberId: string): void {
  if (isSelf(scope, memberId)) return;
  requirePermission(scope, 'link_pages.manage_team');
  requirePermission(scope, 'members.invite');
}

/** Refuses anyone but a connected app's person with no login yet, and an owner to anyone but an owner or themselves. */
function checkClaimable(scope: EngineScope, person: ClaimingPerson | undefined): ClaimingPerson {
  if (person === undefined) throw refuse('NOT_FOUND', NOT_THEIRS);
  if (person.role === 'owner' && !isSelf(scope, person.memberId) && actingRole(scope) !== 'owner') {
    throw refuse('FORBIDDEN', OWNERS_ONLY);
  }
  return person;
}

/**
 * Inside a connected app's frame (security review, 10 Nov 2026), the app itself controls who is "the person" and who
 * its admin is, so: only that app's own people are reached (never another app's, AC-7021's line), and only one holding
 * plain Member with no custom role. A login for anyone with more (an admin, an owner, a custom role) would carry a
 * workspace role out of the frame (AC-7033), so it is set up from Timefix by someone holding both permissions there.
 */
async function checkFrame(tx: WorkspaceTx, frame: ClaimFrame | undefined, person: ClaimingPerson): Promise<void> {
  if (frame === undefined) return;
  const [connection] = await tx
    .select({ partnerId: partnerConnections.partnerId })
    .from(partnerConnections)
    .where(eq(partnerConnections.id, frame.connectionId))
    .limit(1);
  if (connection?.partnerId !== person.partnerId) throw refuse('NOT_FOUND', NOT_THEIRS);
  if (person.role !== 'member' || person.customRoleId !== null) throw refuse('FORBIDDEN', FRAME_MEMBERS_ONLY);
}

/**
 * Set up your Timefix login (AC-7023): an email invitation for a connected app's person to make their own identity a
 * login at `email`. The person themselves, or a holder of `link_pages.manage_team` and `members.invite`. Refused before
 * anything is written: anyone who isn't such a person here (`NOT_FOUND`), an owner by anyone but an owner or themselves
 * (`FORBIDDEN`), an address someone else here uses or another open invitation names (`UNIQUE_CONFLICT` on `email`),
 * past the open invitation cap (`INVITES_LIMIT`). From inside a connected app's frame (`options.frame`), only that
 * app's own people, holding plain Member (`checkFrame`). Their open one is sent again in place to the same address, or
 * cancelled and replaced for another. Holds no seat. One `invitation.created` or `invitation.resent` History row
 * (`login`). Answers the invitation for the api to mail, with the partner and whether the person asked themselves
 * (`isSelf`) for its words; the token is never stored.
 */
export async function inviteToClaimLogin(
  scope: EngineScope,
  input: { readonly member: string; readonly email: string },
  hooks: readonly AfterWrite[] = [],
  options: ClaimLoginOptions = {},
): Promise<PageInviteToSend & { readonly partnerId: string; readonly isSelf: boolean }> {
  if (scope.actor.type !== 'member') throw refuse('FORBIDDEN', NOT_A_MEMBER);
  checkManager(scope, input.member);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) {
    throw refuseOn('CONFIG_INVALID', 'Enter a valid email address.', 'email');
  }
  // Whom, and that the address is free, known before a send is counted (AC-808), so a refused one spends nothing.
  await inWorkspace(scope, async (tx) => {
    const person = checkClaimable(scope, await claimingPerson(tx, scope, input.member, false));
    await checkFrame(tx, options.frame, person);
    const open = await openHandover(tx, scope.workspaceId, person.memberId, false);
    if (await addressTaken(tx, scope.workspaceId, email, person.memberId, open?.id)) {
      throw refuseOn('UNIQUE_CONFLICT', ADDRESS_TAKEN, 'email');
    }
  });
  await options.limit?.(1);
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      await lockInvitations(tx, scope.workspaceId);
      const person = checkClaimable(scope, await claimingPerson(tx, scope, input.member, true));
      await checkFrame(tx, options.frame, person);
      const open = await openHandover(tx, scope.workspaceId, person.memberId, true);
      if (await addressTaken(tx, scope.workspaceId, email, person.memberId, open?.id)) {
        throw refuseOn('UNIQUE_CONFLICT', ADDRESS_TAKEN, 'email');
      }
      const { token, invitationId, sendCount } = await writeNamedInvite(
        tx,
        scope,
        {
          memberId: person.memberId,
          email,
          open,
          mark: { login: true },
          frameConnectionId: options.frame?.connectionId,
        },
        options.source,
      );
      const sent = await openHandover(tx, scope.workspaceId, person.memberId, false);
      if (sent === undefined) throw new Error('A login invitation just sent was not read back.');
      return {
        ...(await senderOf(tx, scope)),
        invite: handoverView(sent),
        invitationId,
        token,
        sendCount,
        page: { name: person.name, ...(person.handle === undefined ? {} : { handle: person.handle }) },
        partnerId: person.partnerId,
        isSelf: isSelf(scope, person.memberId),
      };
    },
    hooks,
  );
  return result;
}

/**
 * Cancels the open login invitation naming a connected app's person: its link stops working at once. The person
 * themselves, or a holder of `link_pages.manage_team` and `members.invite`. Only a connected app's person's
 * (`NOT_FOUND` for anyone else: a page only person's hand over is Team pages' `cancelInvite`); from inside a connected
 * app's frame, as asking (`checkFrame`). One
 * `invitation.revoked` History row. Answers `cancelled: false` when none was open.
 */
export async function cancelLoginInvite(
  scope: EngineScope,
  input: { readonly member: string },
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
  frame?: ClaimFrame,
): Promise<PageInviteCancelled> {
  if (scope.actor.type !== 'member') throw refuse('FORBIDDEN', NOT_A_MEMBER);
  checkManager(scope, input.member);
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      await lockInvitations(tx, scope.workspaceId);
      await checkFrame(tx, frame, checkClaimable(scope, await claimingPerson(tx, scope, input.member, true)));
      const open = await openHandover(tx, scope.workspaceId, input.member, true);
      if (open === undefined) return { cancelled: false };
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
        source,
      );
      return { cancelled: true };
    },
    hooks,
  );
  return result;
}

/** Whether `memberId` is a connected app's person here who claimed their login already. */
async function hasClaimed(tx: WorkspaceTx, workspaceId: string, memberId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: managedMembers.id })
    .from(managedMembers)
    .where(
      and(
        eq(managedMembers.workspaceId, workspaceId),
        eq(managedMembers.memberId, memberId),
        isNotNull(managedMembers.partnerId),
        isNull(managedMembers.removedAt),
        isNotNull(managedMembers.claimedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * The caller's own Timefix login (AC-7023), for their page inside the app's frame: whether they can set one up, the
 * address the app gave them, and their open invitation; or that they have one. Anyone else (a member with a login of
 * their own, a page only person, a manager in someone's editor) reads `canSetUp: false`. Writes nothing.
 */
export async function readMyLogin(scope: EngineScope): Promise<MyTimefixLogin> {
  const { principal } = scope.access;
  if (scope.actor.type !== 'member' || principal.kind !== 'member' || isTeamPageEdit(scope)) {
    return { canSetUp: false, hasLogin: false };
  }
  const memberId = principal.memberId;
  return inWorkspace(scope, async (tx) => {
    const person = await claimingPerson(tx, scope, memberId, false);
    if (person === undefined) {
      return { canSetUp: false, hasLogin: await hasClaimed(tx, scope.workspaceId, memberId), memberId };
    }
    const open = await openHandover(tx, scope.workspaceId, memberId, false);
    return {
      canSetUp: true,
      hasLogin: false,
      memberId,
      ...(isManagedAddress(person.email) ? {} : { email: person.email }),
      ...(open === undefined ? {} : { invite: handoverView(open) }),
    };
  });
}
