// A connected app's person gets their own Timefix login (spec 0070, AC-7023; owner, 10 Nov 2026: "as per industry
// standard and in favour of Timefix"). It rides the page hand over's invitation (`invitations.member_id`, migration
// 0203): one token mailed and only its hash kept, 7 days, single use, bound to its workspace and its member, and every
// write with its History row. Opening it (`claimPageInvite`) makes the person's own managed identity a login at the
// invited address, so they stay the same member with the same page, handle and history, and the identity is never
// merged with another login (AC-7021).
//
// - Who: a connected app's person here (`managed_members` with a partner), still the app's, active, with no login yet.
//   Their role stays theirs: the invitation gives none.
// - Who sends: only a member in Timefix holding `link_pages.manage_team` and `members.invite` (Team pages). Never from
//   inside the app's frame, by the person or the app's admin (coordinator, 10 Nov 2026): the app controls who acts as
//   whom there, and must not mint Timefix logins at addresses it controls. The api keeps these procedures out of the
//   frame; `options.frame` refuses here too. Only an owner sends one for an owner, as only an owner invites one.
// - The address: anyone's but someone else's here (as a hand over). One that already has a Timefix login is refused
//   when the link is opened.
// - The app keeps them: their `managed_members` row stays, marked claimed (migration 0206), so the app's PUT, DELETE,
//   list and launch still find them. The app's DELETE then only lets go of them (`removePartnerMember`); they stay a
//   member with their login unless the workspace removes them.
import type { MyTimefixLogin, PageInviteCancelled } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNotNull } from 'drizzle-orm';
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

const { invitations, managedMembers } = schema;

const NOT_THEIRS = 'That person wasn’t added by a connected app, or already has their own Timefix login.';
const NOT_A_MEMBER = 'Only a member of this workspace sets up a Timefix login for someone.';
const NOT_IN_FRAME = 'A Timefix login is set up in Timefix, by an admin of the workspace.';
const OWNERS_ONLY = 'Only an owner sets up a login for an owner.';
const ADDRESS_TAKEN = 'Someone in this workspace already uses this email, or was invited with it. Use another.';

/** What setting up a login takes beside the invitation's options: whether the call came from an app's frame. */
export interface ClaimLoginOptions extends InviteWriteOptions {
  /** The call came from inside a connected app's embedded frame (the api says so from the session): refused. */
  readonly fromFrame?: boolean;
}

/**
 * Who may set one up: a member in Timefix with Team pages' permission and Members' invite permission, never from
 * inside a connected app's frame, and never through someone's page editor.
 */
function checkSender(scope: EngineScope, fromFrame: boolean): void {
  if (scope.actor.type !== 'member' || isTeamPageEdit(scope)) throw refuse('FORBIDDEN', NOT_A_MEMBER);
  requirePermission(scope, 'link_pages.manage_team');
  requirePermission(scope, 'members.invite');
  if (fromFrame) throw refuse('FORBIDDEN', NOT_IN_FRAME);
}

/** Refuses anyone but a connected app's person with no login yet, and an owner to anyone but an owner. */
function checkClaimable(scope: EngineScope, person: ClaimingPerson | undefined): ClaimingPerson {
  if (person === undefined) throw refuse('NOT_FOUND', NOT_THEIRS);
  if (person.role === 'owner' && actingRole(scope) !== 'owner') throw refuse('FORBIDDEN', OWNERS_ONLY);
  return person;
}

/**
 * Set up their Timefix login (AC-7023): an email invitation for a connected app's person to make their own identity a
 * login at `email`. `link_pages.manage_team`, then `members.invite`, from a member in Timefix (never from an app's
 * frame, `FORBIDDEN`). Refused before anything is written: anyone who isn't such a person here (`NOT_FOUND`), an owner
 * by anyone but an owner (`FORBIDDEN`), an address someone else here uses or another open invitation names
 * (`UNIQUE_CONFLICT` on `email`), past the open invitation cap (`INVITES_LIMIT`). Their open one is sent again in place
 * to the same address, or cancelled and replaced for another. Holds no seat. One `invitation.created` or
 * `invitation.resent` History row (`login`). Answers the invitation for the api to mail, with the partner for its
 * words; the token is never stored.
 */
export async function inviteToClaimLogin(
  scope: EngineScope,
  input: { readonly member: string; readonly email: string },
  hooks: readonly AfterWrite[] = [],
  options: ClaimLoginOptions = {},
): Promise<PageInviteToSend & { readonly partnerId: string }> {
  checkSender(scope, options.fromFrame === true);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) {
    throw refuseOn('CONFIG_INVALID', 'Enter a valid email address.', 'email');
  }
  // Whom, and that the address is free, known before a send is counted (AC-808), so a refused one spends nothing.
  await inWorkspace(scope, async (tx) => {
    const person = checkClaimable(scope, await claimingPerson(tx, scope, input.member, false));
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
      const open = await openHandover(tx, scope.workspaceId, person.memberId, true);
      if (await addressTaken(tx, scope.workspaceId, email, person.memberId, open?.id)) {
        throw refuseOn('UNIQUE_CONFLICT', ADDRESS_TAKEN, 'email');
      }
      const { token, invitationId, sendCount } = await writeNamedInvite(
        tx,
        scope,
        { memberId: person.memberId, email, open, mark: { login: true } },
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
      };
    },
    hooks,
  );
  return result;
}

/**
 * Cancels the open login invitation naming a connected app's person: its link stops working at once. As setting one
 * up: `link_pages.manage_team`, then `members.invite`, from a member in Timefix, never from an app's frame. Only a
 * connected app's person's (`NOT_FOUND` for anyone else: a page only person's hand over is Team pages'
 * `cancelInvite`). One `invitation.revoked` History row. Answers `cancelled: false` when none was open.
 */
export async function cancelLoginInvite(
  scope: EngineScope,
  input: { readonly member: string },
  hooks: readonly AfterWrite[] = [],
  options: { readonly source?: AuditSource; readonly fromFrame?: boolean } = {},
): Promise<PageInviteCancelled> {
  checkSender(scope, options.fromFrame === true);
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      await lockInvitations(tx, scope.workspaceId);
      checkClaimable(scope, await claimingPerson(tx, scope, input.member, true));
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
        options.source,
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
        isNotNull(managedMembers.claimedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * The caller's own Timefix login (AC-7023), for their page inside the app's frame, which only tells them whom to ask:
 * whether one could be set up for them (a connected app's person with none yet), or they have one. Anyone else (a
 * member with a login of their own, a page only person, a manager in someone's editor) reads `canSetUp: false`.
 * Writes nothing.
 */
export async function readMyLogin(scope: EngineScope): Promise<MyTimefixLogin> {
  const { principal } = scope.access;
  if (scope.actor.type !== 'member' || principal.kind !== 'member' || isTeamPageEdit(scope)) {
    return { canSetUp: false, hasLogin: false };
  }
  const memberId = principal.memberId;
  return inWorkspace(scope, async (tx) => {
    if ((await claimingPerson(tx, scope, memberId, false)) !== undefined) return { canSetUp: true, hasLogin: false };
    return { canSetUp: false, hasLogin: await hasClaimed(tx, scope.workspaceId, memberId) };
  });
}
