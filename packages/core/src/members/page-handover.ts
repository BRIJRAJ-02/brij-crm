// A page only person's page handed over (Team pages, 9 Nov 2026; spec 0070's leftover): "Invite to manage their page"
// sends an email invitation that names the person (`invitations.member_id`, migration 0203); opening it makes that
// person's own identity a login at the invited address, so they stay the same member, with their page, handle and
// history, and are no page only person any more. It rides the workspace's invitations: one token mailed and only its
// hash kept, a fresh 7 days a send, single use, its sender's say still needed when it is opened, and every write with
// its History row.
//
// - Who: a page only person (no partner: AC-7021 keeps a partner's person the partner's, and AC-7023's own claim is the
//   person's, from inside the partner's frame, not a manager's), active, holding plain Member with no custom role, so a
//   hand over never gives anyone more than a Member's access.
// - Who sends: `link_pages.manage_team` (as Add a page) and `members.invite` (it lets someone in with a login).
// - The address: anyone's but someone else's here. One an active member other than the person uses, or another open
//   invitation names, is refused. The identity is never merged with another login (AC-7021): an address that already
//   has a Timefix login can't take the page, and is told so when the link is opened.
// - Opening it needs no session: the token is the invited inbox's. The identity becomes a login at that address (the
//   identity store, `claimPageOnlyUser`), then, in one transaction, the person's member row takes the address, their
//   `managed_members` row goes (no page only person, nothing for the 30 day purge), and the invitation is used. A
//   refusal after the identity changed puts it back. Signing in there by code then opens the workspace.
import type { PageInviteCancelled, PageInviteSent } from '@crm/contracts';
import { schema, type Database, type ManagedClaim, type PageOnlyClaim, type WorkspaceTx } from '@crm/db';
import { and, count, eq, sql } from 'drizzle-orm';
import { enterInvitation, inviteInvalid } from '../access/door.ts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { touched } from '../engine/definitions.ts';
import { limitsOf } from '../engine/limits.ts';
import { newId } from '../engine/ids.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { writeAudit, type AuditSource } from './audit.ts';
import {
  INVITE_WINDOW,
  lockInvitations,
  mintToken,
  opensNow,
  readInvitation,
  senderOf,
  type InviteSender,
  type InviteWriteOptions,
} from './invitations.ts';
import {
  claimingPerson,
  handedPerson,
  handoverView as viewOf,
  type ClaimingPerson,
  type HandedPerson,
} from './page-handover-read.ts';
import type { RemovalEffect } from './removal-effect.ts';

const { invitations, managedMembers, members } = schema;

const NOT_PAGE_ONLY = 'That person isn’t a page only person here. Only their page can be handed over.';
const MORE_THAN_MEMBER = 'This person has more access than a Member, so their page isn’t handed over from Team pages.';
const NOT_A_MEMBER = 'Only a member of this workspace hands a page over.';
const ADDRESS_TAKEN = 'Someone in this workspace already uses this email, or was invited with it. Use another.';
const HAS_LOGIN =
  'This email already has a Timefix login, and a page can’t move into another login. Ask for the invitation to go to another address.';
const ADDRESS_IN_USE = 'Someone in this workspace already uses this email, so it can’t take over this page.';

/** The open hand over (or login claim) naming `memberId`, locked when `lock`. */
export async function openHandover(tx: WorkspaceTx, workspaceId: string, memberId: string, lock: boolean) {
  const query = tx
    .select({
      id: invitations.id,
      email: invitations.email,
      sentAt: invitations.lastSentAt,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(
      and(eq(invitations.workspaceId, workspaceId), eq(invitations.memberId, memberId), eq(invitations.status, 'open')),
    );
  const [row] = await (lock ? query.for('update') : query);
  return row;
}

/** Whether an active member other than `except` uses `email`, or an open invitation other than `invitation` names it. */
export async function addressTaken(
  tx: WorkspaceTx,
  workspaceId: string,
  email: string,
  except: string,
  invitation: string | undefined,
): Promise<boolean> {
  const [used] = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.workspaceId, workspaceId),
        eq(members.status, 'active'),
        sql`lower(${members.email}) = ${email}`,
        sql`${members.id} <> ${except}::uuid`,
      ),
    )
    .limit(1);
  if (used !== undefined) return true;
  const [named] = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.status, 'open'),
        eq(invitations.kind, 'email'),
        eq(invitations.email, email),
        ...(invitation === undefined ? [] : [sql`${invitations.id} <> ${invitation}::uuid`]),
      ),
    )
    .limit(1);
  return named !== undefined;
}

/**
 * Writes the invitation that names a person (`invitations.member_id`), inside the caller's write under the
 * invitations lock, once they and the address have passed their checks: to the address of their open one, it is sent
 * again in place (a new token, so the old link stops, and a fresh 7 days); to another, the open one is cancelled and a
 * new one made, within the open invitation cap (`INVITES_LIMIT`). One History row, `invitation.created` or
 * `invitation.resent`, carrying `mark` (`page` for a hand over, `login` for a connected app's person's own login).
 * Answers the token to mail (never stored), the invitation and how many times it went out.
 */
export async function writeNamedInvite(
  tx: WorkspaceTx,
  scope: EngineScope,
  named: {
    readonly memberId: string;
    readonly email: string;
    readonly open: { readonly id: string; readonly email: string | null } | undefined;
    readonly mark: { readonly page: true } | { readonly login: true };
  },
  source: AuditSource | undefined,
): Promise<{ readonly token: string; readonly invitationId: string; readonly sendCount: number }> {
  const { email, open } = named;
  const { token, hash } = mintToken();
  const by = touched(scope);
  let invitationId: string;
  let sendCount: number;
  // To another address, the open one is cancelled and a new one made, so History says where it went each time.
  if (open !== undefined && open.email !== email) {
    await tx
      .update(invitations)
      .set({ status: 'revoked', ...by })
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
  }
  if (open !== undefined && open.email === email) {
    const [row] = await tx
      .update(invitations)
      .set({
        email,
        tokenHash: hash,
        sendCount: sql`${invitations.sendCount} + 1`,
        lastSentAt: sql`now()`,
        expiresAt: INVITE_WINDOW,
        ...by,
      })
      .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.id, open.id)))
      .returning({ sendCount: invitations.sendCount });
    invitationId = open.id;
    sendCount = row?.sendCount ?? 1;
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      { action: 'invitation.resent', targetType: 'invitation', targetId: open.id, after: { ...named.mark } },
      source,
    );
  } else {
    const [openCount] = await tx
      .select({ n: count() })
      .from(invitations)
      .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.status, 'open')));
    const cap = limitsOf(scope).openInvitations;
    if ((openCount?.n ?? 0) + 1 > cap) {
      throw refuse('INVITES_LIMIT', `A workspace holds at most ${String(cap)} open invitations. Revoke some first.`);
    }
    invitationId = newId();
    sendCount = 1;
    await tx.insert(invitations).values({
      workspaceId: scope.workspaceId,
      id: invitationId,
      kind: 'email',
      email,
      role: 'member',
      customRoleId: null,
      memberId: named.memberId,
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
    // The address stays in `invitations`: the log names the invitation, never personal data it can't drop.
    await writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      {
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: invitationId,
        // A login claim gives no role: the person keeps the one they hold.
        after: { ...('page' in named.mark ? { role: 'member' } : {}), ...named.mark, memberId: named.memberId },
      },
      source,
    );
  }
  return { token, invitationId, sendCount };
}

/** Refuses anyone but a page only person holding plain Member (`handedPerson` read them). */
function checkHandable(person: HandedPerson | undefined): HandedPerson {
  if (person === undefined) throw refuse('NOT_FOUND', NOT_PAGE_ONLY);
  if (person.role !== 'member' || person.customRoleId !== null) throw refuse('FORBIDDEN', MORE_THAN_MEMBER);
  return person;
}

/** What sending a hand over answers the api: the invitation to mail, with its token, and whose page it is. */
export interface PageInviteToSend extends InviteSender {
  readonly invite: PageInviteSent['invite'];
  readonly invitationId: string;
  readonly token: string;
  readonly sendCount: number;
  readonly page: { readonly name: string; readonly handle?: string };
}

/**
 * Invite to manage their page (9 Nov 2026): an email invitation handing a page only person's page to `email`.
 * `link_pages.manage_team`, then `members.invite`, from a member. Refused before anything is written: anyone who isn't a
 * page only person here (`NOT_FOUND`), one holding more than plain Member (`FORBIDDEN`), an address someone else here
 * uses or another open invitation names (`UNIQUE_CONFLICT` on `email`), past the open invitation cap
 * (`INVITES_LIMIT`). Their open one, if any, is sent again: to the same address in place (a new token, so the old link
 * stops, and a fresh 7 days); to another, it is cancelled and a new one made. Holds no seat (the person already holds theirs). One `invitation.created` or `invitation.resent`
 * History row (`page`). Answers the invitation for the api to mail; the token is never stored.
 */
export async function inviteToManagePage(
  scope: EngineScope,
  input: { readonly member: string; readonly email: string },
  hooks: readonly AfterWrite[] = [],
  options: InviteWriteOptions = {},
): Promise<PageInviteToSend> {
  requirePermission(scope, 'link_pages.manage_team');
  requirePermission(scope, 'members.invite');
  if (scope.actor.type !== 'member') throw refuse('FORBIDDEN', NOT_A_MEMBER);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) {
    throw refuseOn('CONFIG_INVALID', 'Enter a valid email address.', 'email');
  }
  // Whom, and that the address is free, known before a send is counted (AC-808), so a refused one spends nothing.
  await inWorkspace(scope, async (tx) => {
    const person = checkHandable(await handedPerson(tx, scope, input.member, false));
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
      const person = checkHandable(await handedPerson(tx, scope, input.member, true));
      const open = await openHandover(tx, scope.workspaceId, person.memberId, true);
      if (await addressTaken(tx, scope.workspaceId, email, person.memberId, open?.id)) {
        throw refuseOn('UNIQUE_CONFLICT', ADDRESS_TAKEN, 'email');
      }
      const { token, invitationId, sendCount } = await writeNamedInvite(
        tx,
        scope,
        { memberId: person.memberId, email, open, mark: { page: true } },
        options.source,
      );
      const sent = await openHandover(tx, scope.workspaceId, person.memberId, false);
      if (sent === undefined) throw new Error('A hand over just sent was not read back.');
      return {
        ...(await senderOf(tx, scope)),
        invite: viewOf(sent),
        invitationId,
        token,
        sendCount,
        page: { name: person.name, ...(person.handle === undefined ? {} : { handle: person.handle }) },
      };
    },
    hooks,
  );
  return result;
}

/**
 * Cancels a page only person's open hand over: its link stops working at once. `link_pages.manage_team`, then
 * `members.invite`. One `invitation.revoked` History row. Answers `cancelled: false` when none was open.
 */
export async function cancelPageInvite(
  scope: EngineScope,
  input: { readonly member: string },
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<PageInviteCancelled> {
  requirePermission(scope, 'link_pages.manage_team');
  requirePermission(scope, 'members.invite');
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      await lockInvitations(tx, scope.workspaceId);
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

/** What taking over a page, or a partner's person's own login (spec 0070, AC-7023), needs of the identity store. */
export interface PageClaimUsers {
  claimPageOnlyUser(claim: PageOnlyClaim): Promise<'claimed' | 'taken' | 'gone'>;
  unclaimPageOnlyUser(claim: PageOnlyClaim): Promise<void>;
  claimManagedUser(claim: ManagedClaim): Promise<'claimed' | 'taken' | 'gone'>;
  unclaimManagedUser(claim: ManagedClaim): Promise<void>;
}

/** Whom an invitation naming a person makes a login for, as it was read before the identity changed. */
type Claimant =
  | { readonly kind: 'page'; readonly person: HandedPerson }
  | { readonly kind: 'login'; readonly person: ClaimingPerson };

/** Whom an open invitation names, if they can still take it: a plain Member page only person, or a partner's person. */
async function claimantOf(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
  lock: boolean,
): Promise<Claimant | undefined> {
  const page = await handedPerson(tx, scope, memberId, lock);
  if (page !== undefined) {
    return page.role === 'member' && page.customRoleId === null ? { kind: 'page', person: page } : undefined;
  }
  const person = await claimingPerson(tx, scope, memberId, lock);
  return person === undefined ? undefined : { kind: 'login', person };
}

/**
 * Takes over a page from its hand over (no session: the token is the invited inbox's), or sets up a partner's person's
 * own login from theirs (spec 0070, AC-7023). The invitation must open now (open, unexpired, single use, its sender
 * still holding what sending it took, or the person themselves still here) and name a page only person still handable
 * here, or a partner's person still the partner's with no login yet; anything else is the one `INVITE_INVALID`. An
 * address someone else here took since is `UNIQUE_CONFLICT`, and so is one that already has a Timefix login (never
 * merged, AC-7021). Then the identity becomes a login at the invited address, and in one transaction the member row
 * takes the address, the invitation is used by them, and one `invitation.accepted` History row (`via: page` or
 * `login`) and the `members` and `access` outbox rows are written. A page only person's `managed_members` row goes; a
 * partner's person's stays, marked claimed, so the partner keeps managing them. Refused there, the identity goes back.
 * The same link opened again once it stood answers the workspace again. Answers the workspace's address, where
 * signing in by code at that address leads, and that address (the token is its inbox's), for the sign in to start
 * from.
 */
export async function claimPageInvite(
  deps: { readonly db: Database; readonly users: PageClaimUsers },
  token: string,
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<{ readonly slug: string; readonly email: string }> {
  const { scope, ...entered } = await enterInvitation(deps, token);
  const first = await inWorkspace(scope, async (tx) => {
    const held = await readInvitation(tx, scope.workspaceId, entered, false);
    if (held?.memberId === undefined) throw inviteInvalid();
    // Taken already (a second press): the same answer, nothing changes twice.
    if (held.status === 'used' && held.usedBy === held.memberId) {
      return { slug: held.slug, email: held.email, done: true as const };
    }
    if (!opensNow(held)) throw inviteInvalid();
    const claimant = await claimantOf(tx, scope, held.memberId, false);
    if (claimant === undefined) throw inviteInvalid();
    if (await addressTaken(tx, scope.workspaceId, held.email, claimant.person.memberId, held.id)) {
      throw refuseOn('UNIQUE_CONFLICT', ADDRESS_IN_USE, 'email');
    }
    return { slug: held.slug, done: false as const, claimant, email: held.email };
  });
  if (first.done) return { slug: first.slug, email: first.email };
  const { claimant, email } = first;
  const identity = identityClaim(deps.users, scope.workspaceId, claimant, email);
  const made = await identity.claim();
  if (made === 'gone') throw inviteInvalid();
  if (made === 'taken') throw refuseOn('UNIQUE_CONFLICT', HAS_LOGIN, 'email');
  try {
    const { result } = await runWrite(scope, (context) => takeOver(context, entered, claimant, source), hooks);
    return { ...result, email };
  } catch (error) {
    // Refused after the identity became a login (a race): it is a managed identity again. Should that fail too, the
    // identity would be a working login nobody meant: that is no refusal, so it throws on, reported, never quiet.
    try {
      await identity.undo();
    } catch (undo) {
      throw new Error('A page hand over refused after its login was made could not be undone.', { cause: undo });
    }
    throw error;
  }
}

/** The identity store's two calls for a claimant: make their identity a login at `email`, and put it back. */
function identityClaim(users: PageClaimUsers, workspaceId: string, claimant: Claimant, email: string) {
  if (claimant.kind === 'page') {
    const claim: PageOnlyClaim = {
      userId: claimant.person.userId,
      workspaceId,
      personId: claimant.person.personId,
      email,
    };
    return { claim: () => users.claimPageOnlyUser(claim), undo: () => users.unclaimPageOnlyUser(claim) };
  }
  const claim: ManagedClaim = {
    userId: claimant.person.userId,
    workspaceId,
    partnerId: claimant.person.partnerId,
    externalId: claimant.person.externalId,
    email,
  };
  return { claim: () => users.claimManagedUser(claim), undo: () => users.unclaimManagedUser(claim) };
}

/** The workspace's half of a take over or a login claim, under the invitation's and the person's locks. */
async function takeOver(
  context: WriteContext,
  entered: Parameters<typeof readInvitation>[2],
  before: Claimant,
  source: AuditSource,
): Promise<{ readonly slug: string }> {
  const { tx, scope } = context;
  const held = await readInvitation(tx, scope.workspaceId, entered, true);
  if (held?.memberId !== before.person.memberId || !opensNow(held)) throw inviteInvalid();
  const now = await claimantOf(tx, scope, before.person.memberId, true);
  if (now?.kind !== before.kind || now.person.userId !== before.person.userId) throw inviteInvalid();
  const { person } = now;
  if (await addressTaken(tx, scope.workspaceId, held.email, person.memberId, held.id)) {
    throw refuseOn('UNIQUE_CONFLICT', ADDRESS_IN_USE, 'email');
  }
  await tx
    .update(members)
    .set({ email: held.email, ...touched(scope) })
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, person.memberId)));
  if (now.kind === 'page') {
    await tx
      .delete(managedMembers)
      .where(and(eq(managedMembers.workspaceId, scope.workspaceId), eq(managedMembers.id, person.personId)));
  } else {
    // The partner keeps them (owner, 10 Nov 2026): their row stays, marked claimed.
    await tx
      .update(managedMembers)
      .set({ claimedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(managedMembers.workspaceId, scope.workspaceId), eq(managedMembers.id, person.personId)));
  }
  await tx
    .update(invitations)
    .set({ status: 'used', uses: sql`${invitations.uses} + 1`, usedByMemberId: person.memberId, ...touched(scope) })
    .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.id, held.id)));
  await writeAudit(
    tx,
    scope.workspaceId,
    { type: 'member', id: person.memberId },
    {
      action: 'invitation.accepted',
      targetType: 'member',
      targetId: person.memberId,
      after: { via: now.kind, invitationId: held.id },
    },
    source,
  );
  context.record({ members: [person.memberId], access: [person.memberId] });
  return { slug: held.slug };
}

/**
 * A removed page only person's open hand over is cancelled with them: nobody is left to hand the page to. Used and
 * cancelled ones stay, as History.
 */
export const pageHandoverRemoval: RemovalEffect = {
  feature: 'page_handover',
  constraints: ['invitations_member'],
  run: async ({ tx, scope }, memberId, source) => {
    const cancelled = await tx
      .update(invitations)
      .set({ status: 'revoked', ...touched(scope) })
      .where(
        and(
          eq(invitations.workspaceId, scope.workspaceId),
          eq(invitations.memberId, memberId),
          eq(invitations.status, 'open'),
        ),
      )
      .returning({ id: invitations.id });
    for (const row of cancelled) {
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'invitation.revoked',
          targetType: 'invitation',
          targetId: row.id,
          before: { status: 'open' },
          after: { status: 'revoked' },
        },
        source,
      );
    }
  },
};
