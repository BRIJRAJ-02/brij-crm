// The page only person a page's hand over names (Team pages, 9 Nov 2026), as the invitation page and the hand over
// itself read them: still a page only person here (no partner, not removed), still an active plain Member, with their
// identity and their link page's handle; and the partner's person a login claim names (spec 0070, AC-7023). Its own
// file so invitations, the hand over and the claim share it with no cycle.
import type { PageInviteSent } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { publicProfilesOf } from '../booking/handles.ts';
import type { EngineScope } from '../engine/scope.ts';

const { invitations, managedMembers, members } = schema;

/** A page only person who can be handed their page: their rows' ids, their name, email and role, and their handle. */
export interface HandedPerson {
  readonly memberId: string;
  /** Their `managed_members` row's id, which keys their identity (`auth.managed_users.external_id`). */
  readonly personId: string;
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly customRoleId: string | null;
  readonly handle?: string;
}

/**
 * The page only person `memberId` names in the scope's workspace, locked for update when `lock`, or undefined when they
 * are none (a partner's person, removed, no longer active, or handed over already).
 */
export async function handedPerson(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
  lock: boolean,
): Promise<HandedPerson | undefined> {
  const query = tx
    .select({
      personId: managedMembers.id,
      userId: managedMembers.userId,
      name: members.name,
      email: members.email,
      role: members.role,
      customRoleId: members.customRoleId,
      memberUser: members.userId,
    })
    .from(managedMembers)
    .innerJoin(
      members,
      and(eq(members.workspaceId, managedMembers.workspaceId), eq(members.id, managedMembers.memberId)),
    )
    .where(
      and(
        eq(managedMembers.workspaceId, scope.workspaceId),
        eq(managedMembers.memberId, memberId),
        isNull(managedMembers.partnerId),
        isNull(managedMembers.removedAt),
        eq(members.status, 'active'),
      ),
    );
  const [row] = await (lock ? query.for('update') : query);
  if (row === undefined || row.memberUser !== row.userId) return undefined;
  const page = (await publicProfilesOf(tx, scope.workspaceId, [row.userId])).get(row.userId);
  return {
    memberId,
    personId: row.personId,
    userId: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
    customRoleId: row.customRoleId,
    ...(page === undefined ? {} : { handle: page.handle }),
  };
}

/** A partner's person who can claim their own login (spec 0070, AC-7023): as `HandedPerson`, with their partner. */
export interface ClaimingPerson extends HandedPerson {
  readonly partnerId: string;
  readonly externalId: string;
}

/**
 * The partner's person `memberId` names in the scope's workspace (spec 0070, AC-7023), locked for update when `lock`,
 * or undefined when they are none: a page only person, someone the partner removed, no longer active, or who claimed
 * their login already.
 */
export async function claimingPerson(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
  lock: boolean,
): Promise<ClaimingPerson | undefined> {
  const query = tx
    .select({
      personId: managedMembers.id,
      userId: managedMembers.userId,
      partnerId: managedMembers.partnerId,
      externalId: managedMembers.externalId,
      name: members.name,
      email: members.email,
      role: members.role,
      customRoleId: members.customRoleId,
      memberUser: members.userId,
    })
    .from(managedMembers)
    .innerJoin(
      members,
      and(eq(members.workspaceId, managedMembers.workspaceId), eq(members.id, managedMembers.memberId)),
    )
    .where(
      and(
        eq(managedMembers.workspaceId, scope.workspaceId),
        eq(managedMembers.memberId, memberId),
        isNotNull(managedMembers.partnerId),
        isNull(managedMembers.removedAt),
        isNull(managedMembers.claimedAt),
        eq(members.status, 'active'),
      ),
    );
  const [row] = await (lock ? query.for('update') : query);
  if (row === undefined || row.partnerId === null || row.memberUser !== row.userId) return undefined;
  const page = (await publicProfilesOf(tx, scope.workspaceId, [row.userId])).get(row.userId);
  return {
    memberId,
    personId: row.personId,
    userId: row.userId,
    partnerId: row.partnerId,
    externalId: row.externalId,
    name: row.name,
    email: row.email,
    role: row.role,
    customRoleId: row.customRoleId,
    ...(page === undefined ? {} : { handle: page.handle }),
  };
}

/**
 * What the invitation page names of a page's hand over, or of a partner's person's login claim: whose page, its handle
 * when it has one, and (a claim) the partner that keeps managing them.
 */
export async function handedPage(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
): Promise<{ readonly name: string; readonly handle?: string; readonly partnerId?: string } | undefined> {
  const page = await handedPerson(tx, scope, memberId, false);
  if (page !== undefined) return { name: page.name, ...(page.handle === undefined ? {} : { handle: page.handle }) };
  const person = await claimingPerson(tx, scope, memberId, false);
  if (person === undefined) return undefined;
  return {
    name: person.name,
    ...(person.handle === undefined ? {} : { handle: person.handle }),
    partnerId: person.partnerId,
  };
}

/** Whose page a hand over that was taken gave: the member, still active, by name and handle. */
export async function takenPage(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
): Promise<{ readonly name: string; readonly handle?: string; readonly partnerId?: string } | undefined> {
  const [row] = await tx
    .select({ name: members.name, userId: members.userId, partnerId: managedMembers.partnerId })
    .from(members)
    // A partner's person who claimed their login stays the partner's (spec 0070, AC-7023): the page says so again.
    .leftJoin(
      managedMembers,
      and(
        eq(managedMembers.workspaceId, members.workspaceId),
        eq(managedMembers.memberId, members.id),
        isNotNull(managedMembers.claimedAt),
        isNull(managedMembers.removedAt),
      ),
    )
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId), eq(members.status, 'active')));
  if (row === undefined) return undefined;
  const page = (await publicProfilesOf(tx, scope.workspaceId, [row.userId])).get(row.userId ?? '');
  return {
    name: row.name,
    ...(page === undefined ? {} : { handle: page.handle }),
    ...(row.partnerId === null ? {} : { partnerId: row.partnerId }),
  };
}

/** A hand over as Team pages shows it: to whom, when it last went out, and when its link stops. */
export function handoverView(row: {
  readonly email: string | null;
  readonly sentAt: Date | string | null;
  readonly createdAt: Date | string;
  readonly expiresAt: Date | string | null;
}): PageInviteSent['invite'] {
  const expiresAt = new Date(row.expiresAt ?? row.createdAt);
  return {
    email: row.email ?? '',
    sentAt: new Date(row.sentAt ?? row.createdAt).toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(expiresAt.getTime() <= Date.now() ? { isExpired: true } : {}),
  };
}

/** The workspace's open hand overs, by the member each names, for Team pages' rows. One statement. */
export async function openHandoversOf(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<ReadonlyMap<string, PageInviteSent['invite']>> {
  const rows = await tx
    .select({
      memberId: invitations.memberId,
      email: invitations.email,
      sentAt: invitations.lastSentAt,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(
      and(eq(invitations.workspaceId, workspaceId), eq(invitations.status, 'open'), isNotNull(invitations.memberId)),
    );
  return new Map(rows.flatMap((row) => (row.memberId === null ? [] : [[row.memberId, handoverView(row)] as const])));
}
