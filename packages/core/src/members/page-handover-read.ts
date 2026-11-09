// The page only person a page's hand over names (Team pages, 9 Nov 2026), as the invitation page and the hand over
// itself read them: still a page only person here (no partner, not removed), still an active plain Member, with their
// identity and their link page's handle. Its own file so invitations and the hand over share it with no cycle.
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

/** What the invitation page names of a page's hand over: whose page, and its handle when it has one. */
export async function handedPage(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
): Promise<{ readonly name: string; readonly handle?: string } | undefined> {
  const person = await handedPerson(tx, scope, memberId, false);
  if (person === undefined) return undefined;
  return { name: person.name, ...(person.handle === undefined ? {} : { handle: person.handle }) };
}

/** Whose page a hand over that was taken gave: the member, still active, by name and handle. */
export async function takenPage(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
): Promise<{ readonly name: string; readonly handle?: string } | undefined> {
  const [row] = await tx
    .select({ name: members.name, userId: members.userId })
    .from(members)
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId), eq(members.status, 'active')));
  if (row === undefined) return undefined;
  const page = (await publicProfilesOf(tx, scope.workspaceId, [row.userId])).get(row.userId ?? '');
  return { name: row.name, ...(page === undefined ? {} : { handle: page.handle }) };
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
