// Managed members (spec 0070, slice 3, AC-7020 to AC-7025): the people a partner adds to and removes from the
// workspace it is connected to, through `PUT`, `DELETE` and `GET /api/partner/v1/connections/{id}/members…`.
//
// - A managed member is keyed by the partner and its own id for them (`managed_members`), never by email (AC-7021).
//   Their identity is made by the identity store (`ensureManagedUser`): a made up `.invalid` address, no password and
//   no linked account, so they can't sign in at the app and no Timefix account is ever merged with them (AC-7023).
//   Their real address is only on their member row; one that an active member here already uses, or an open
//   invitation names, is refused.
// - Roles (AC-7024): `admin` is the built in Admin (which holds `link_pages.manage_team`), `member` is Member (a custom
//   role the workspace gave them on top of Member stays). The partner never makes, changes or removes an owner: a PUT
//   for a person the workspace made an owner changes nothing about them, and removing them is refused.
// - Someone the workspace removed in Timefix is not brought back by a PUT (403); only the partner's own DELETE, then a
//   PUT, adds them again.
// - Every change writes its History row as the partner (the scope's actor) in the same transaction, and the `members`
//   and `access` outbox rows a member change stores. A PUT that changes nothing writes nothing.
// - A removal (AC-7022) is a member removal: their row is marked `removed` (so their handle stops working, AC-5603),
//   every feature's removal runs, and once it commits their sessions end and the directory forgets them. Their page's
//   content stays; the same external id again brings back the same identity, and with it their handle and page.
//
// - Someone who set up their own Timefix login (AC-7023, migration 0206) stays the partner's: a PUT still changes their
//   name and role, never their address (it is their login's), and the list and launch still find them. A DELETE only
//   lets go of them (`member.app_released`): they stay a member with their login, their sessions in Timefix carry on,
//   and only the partner's frame closes. A PUT with the same external id afterwards takes them back.
//
// Only the scope `enterAsPartner` minted reaches these, and only for the connection it names: any other connection's
// id answers `NOT_FOUND`, as one that doesn't exist (AC-7025).
import {
  PARTNER_MEMBERS_LIST_MAX,
  type PartnerMemberInput,
  type PartnerMemberList,
  type PartnerMemberView,
  type Role,
} from '@crm/contracts';
import { schema, type ManagedPerson, type WorkspaceTx } from '@crm/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { ensureLinkPage } from '../booking/handles.ts';
import { touched } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { postgresError, refuse } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import { checkSeats } from '../members/invitations.ts';
import { runRemovalEffects } from '../members/removal.ts';
import { recordJoinReach } from '../scheduling/delegations.ts';

const { invitations, managedMembers, members } = schema;

/** What adding a managed member needs of the identity store. */
export interface ManagedUserMaker {
  ensureManagedUser(person: ManagedPerson): Promise<string>;
}

/** What a removal needs of the identity store, once it has committed. */
export interface ManagedUserEnder {
  endManagedUserSessions(userId: string): Promise<number>;
  dropMembership(userId: string, workspaceId: string, memberId?: string): Promise<void>;
}

const NO_CONNECTION = 'There is no such connection.';
const NO_MEMBER = 'This connection has no person with that external id.';
const EMAIL_TAKEN =
  'Someone already in this workspace uses this email. A managed member needs an address nobody here uses.';
const LOGIN_REMOVED =
  'This person has their own Timefix login and is no longer in the workspace. Only the workspace can invite them back.';
const OWNER_KEPT = 'This person is an owner of the workspace. Only the workspace’s owners can remove them in Timefix.';
const REMOVED_IN_TIMEFIX =
  'This person was removed from the workspace in Timefix. Send DELETE for them first if they should come back.';

/** The partner principal, for the connection its path names, or a refusal. */
function partnerOf(scope: EngineScope, connectionId: string) {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'partner') throw refuse('FORBIDDEN', 'Only a partner’s own connection manages its people.');
  if (principal.connectionId !== connectionId) throw refuse('NOT_FOUND', NO_CONNECTION);
  return principal;
}

/** The connection, still live, read under share lock so a disconnect waits for this write (or this write for it). */
async function lockConnection(tx: WorkspaceTx, connectionId: string): Promise<void> {
  const [live] = await tx
    .select({ id: schema.partnerConnections.id })
    .from(schema.partnerConnections)
    .where(and(eq(schema.partnerConnections.id, connectionId), isNull(schema.partnerConnections.disconnectedAt)))
    .for('share');
  if (live === undefined) throw refuse('NOT_FOUND', NO_CONNECTION);
}

/** The managed row for this partner's external id, with its member's state, locked for the write. */
async function lockManaged(tx: WorkspaceTx, workspaceId: string, partnerId: string, externalId: string) {
  const [row] = await tx
    .select({
      id: managedMembers.id,
      memberId: managedMembers.memberId,
      userId: managedMembers.userId,
      removedAt: managedMembers.removedAt,
      claimedAt: managedMembers.claimedAt,
      createdAt: managedMembers.createdAt,
    })
    .from(managedMembers)
    .where(
      and(
        eq(managedMembers.workspaceId, workspaceId),
        eq(managedMembers.partnerId, partnerId),
        eq(managedMembers.externalId, externalId),
      ),
    )
    .for('update');
  if (row === undefined) return undefined;
  const [member] = await tx
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      role: members.role,
      status: members.status,
      createdAt: members.createdAt,
    })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.id, row.memberId)))
    .for('update');
  return { ...row, member };
}

/**
 * Whether an active member here other than `except` already uses this address, in any case, or an open email
 * invitation names it: a partner never takes an address a real person was invited with, so it can't lock them out.
 */
export async function emailTaken(
  tx: WorkspaceTx,
  workspaceId: string,
  email: string,
  except?: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.workspaceId, workspaceId),
        eq(members.status, 'active'),
        sql`lower(${members.email}) = lower(${email})`,
        ...(except === undefined ? [] : [sql`${members.id} <> ${except}::uuid`]),
      ),
    )
    .limit(1);
  if (row !== undefined) return true;
  const [invited] = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.workspaceId, workspaceId),
        eq(invitations.status, 'open'),
        eq(invitations.kind, 'email'),
        sql`lower(${invitations.email}) = lower(${email})`,
      ),
    )
    .limit(1);
  return invited !== undefined;
}

/** Serialises writes for one partner's external id: two PUTs at once for a new person make one, never two. */
async function lockExternalId(tx: WorkspaceTx, workspaceId: string, partnerId: string, externalId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`managed-member:${workspaceId}:${partnerId}:${externalId}`}, 0))`,
  );
}

/** A unique clash on the address (two writes at once) as the same refusal the read gives. */
export function emailClash(error: unknown): unknown {
  const pg = postgresError(error);
  return pg?.code === '23505' && pg.constraint === 'members_email' ? refuse('UNIQUE_CONFLICT', EMAIL_TAKEN) : error;
}

const storedRole = (role: string): PartnerMemberView['role'] =>
  role === 'owner' || role === 'admin' || role === 'guest' ? role : 'member';

/** Who the partner reads back. */
function viewOf(
  externalId: string,
  member: { readonly id: string; readonly name: string; readonly email: string; readonly role: string },
  addedAt: string | Date,
  handle: string | undefined,
  hasLogin = false,
): PartnerMemberView {
  return {
    externalId,
    memberId: member.id,
    name: member.name,
    email: member.email,
    role: storedRole(member.role),
    ...(handle === undefined ? {} : { handle }),
    addedAt: new Date(addedAt).toISOString(),
    ...(hasLogin ? { hasTimefixLogin: true as const } : {}),
  };
}

/** A new active member row for a managed identity, its directory row and its link page, inside the write. */
async function addMemberRow(
  context: WriteContext,
  person: { readonly userId: string; readonly name: string; readonly email: string; readonly role: Role },
): Promise<{ readonly memberId: string; readonly handle: string | undefined }> {
  const { tx, scope } = context;
  const memberId = newId();
  const by = actorRow(scope.actor);
  await tx.insert(members).values({
    workspaceId: scope.workspaceId,
    id: memberId,
    userId: person.userId,
    name: person.name,
    email: person.email,
    role: person.role,
    createdByType: by.type,
    createdById: by.id,
    createdByMemberId: by.memberId,
    updatedByType: by.type,
    updatedById: by.id,
    updatedByMemberId: by.memberId,
  });
  await tx.execute(
    sql`insert into auth.workspace_membership (user_id, workspace_id, member_id) values (${person.userId}, ${scope.workspaceId}, ${memberId}) on conflict do nothing`,
  );
  // Their link page (AC-7002): the one they held here before, or one made now.
  const handle = await ensureLinkPage(tx, {
    userId: person.userId,
    workspaceId: scope.workspaceId,
    name: person.name,
    email: person.email,
  });
  return { memberId, handle };
}

/**
 * Adds or updates a partner's managed member (AC-7020): the same external id is always the same person. A new one is
 * made silently (no invitation, no email) with a seat; one the partner removed comes back with the same identity, so
 * their handle and page return. An existing one gets the name, address and role given (an owner is left as is).
 * Answers the person and whether they were added now (`created`).
 */
export async function putPartnerMember(
  scope: EngineScope,
  input: { readonly connectionId: string; readonly externalId: string; readonly person: PartnerMemberInput },
  deps: { readonly users: ManagedUserMaker },
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<{ readonly member: PartnerMemberView; readonly created: boolean }> {
  const principal = partnerOf(scope, input.connectionId);
  const { externalId } = input;
  const name = input.person.name.trim();
  const email = input.person.email.trim().toLowerCase();
  const role: Role = input.person.role === 'admin' ? 'admin' : 'member';
  // Refused before an identity is made, so a refused PUT leaves nothing behind: an address someone here already uses
  // or was invited with (AC-7021), a person the workspace removed, a full workspace.
  await inWorkspace(scope, async (tx) => {
    await lockConnection(tx, principal.connectionId);
    const [row] = await tx
      .select({
        memberId: managedMembers.memberId,
        removedAt: managedMembers.removedAt,
        claimedAt: managedMembers.claimedAt,
        status: members.status,
      })
      .from(managedMembers)
      .innerJoin(
        members,
        and(eq(members.workspaceId, managedMembers.workspaceId), eq(members.id, managedMembers.memberId)),
      )
      .where(and(eq(managedMembers.partnerId, principal.partnerId), eq(managedMembers.externalId, externalId)))
      .limit(1);
    if (row !== undefined && row.removedAt === null && row.status !== 'active') {
      throw refuse('FORBIDDEN', REMOVED_IN_TIMEFIX);
    }
    // Someone with their own login whom the workspace removed (or who left) is the workspace's to bring back, by an
    // invitation they accept: never the app's PUT, whatever its own DELETE did (security review, 10 Nov 2026).
    if (row !== undefined && row.claimedAt !== null && row.status !== 'active') {
      throw refuse('FORBIDDEN', LOGIN_REMOVED);
    }
    // Someone with their own login stays a member when the partner lets go of them, so a PUT takes them back as they
    // are; their address is their login's, so the one given is never checked or used.
    const claimed = row !== undefined && row.claimedAt !== null && row.status === 'active';
    if (claimed) return;
    const keeps = row !== undefined && row.removedAt === null ? row.memberId : undefined;
    if (await emailTaken(tx, scope.workspaceId, email, keeps)) throw refuse('UNIQUE_CONFLICT', EMAIL_TAKEN);
    if (keeps === undefined) await checkSeats(tx, scope, 1);
  });
  const userId = await deps.users.ensureManagedUser({
    workspaceId: scope.workspaceId,
    partnerId: principal.partnerId,
    externalId,
    name,
  });
  try {
    const { result } = await runWrite(
      scope,
      async (context) => {
        const { tx } = context;
        await lockConnection(tx, principal.connectionId);
        await lockExternalId(tx, scope.workspaceId, principal.partnerId, externalId);
        const found = await lockManaged(tx, scope.workspaceId, principal.partnerId, externalId);
        const active = found?.member?.status === 'active' ? found.member : undefined;
        // Removed in Timefix (Members, or they left): a routine PUT never undoes the workspace's own removal.
        if (found !== undefined && found.removedAt === null && active === undefined) {
          throw refuse('FORBIDDEN', REMOVED_IN_TIMEFIX);
        }
        if (found !== undefined && found.claimedAt !== null && active === undefined) {
          throw refuse('FORBIDDEN', LOGIN_REMOVED);
        }
        if (found === undefined || active === undefined) {
          // New, or back after the partner's own removal: a new member row on the same identity.
          if (await emailTaken(tx, scope.workspaceId, email)) throw refuse('UNIQUE_CONFLICT', EMAIL_TAKEN);
          await checkSeats(tx, scope, 1);
          const added = await addMemberRow(context, { userId, name, email, role });
          let addedAt: string | Date;
          if (found === undefined) {
            const [made] = await tx
              .insert(managedMembers)
              .values({
                workspaceId: scope.workspaceId,
                partnerId: principal.partnerId,
                externalId,
                connectionId: principal.connectionId,
                memberId: added.memberId,
                userId,
              })
              .returning({ createdAt: managedMembers.createdAt });
            addedAt = made?.createdAt ?? new Date();
          } else {
            await tx
              .update(managedMembers)
              .set({
                memberId: added.memberId,
                userId,
                connectionId: principal.connectionId,
                removedAt: null,
                updatedAt: sql`now()`,
              })
              .where(and(eq(managedMembers.workspaceId, scope.workspaceId), eq(managedMembers.id, found.id)));
            addedAt = new Date();
          }
          await writeAudit(
            tx,
            scope.workspaceId,
            scope.actor,
            { action: 'member.added', targetType: 'member', targetId: added.memberId, after: { role } },
            source,
          );
          context.record({ members: [added.memberId], access: [added.memberId] });
          await recordJoinReach(context, scope.workspaceId, added.memberId);
          return {
            member: viewOf(externalId, { id: added.memberId, name, email, role }, addedAt, added.handle),
            created: true,
          };
        }
        const hasLogin = found.claimedAt !== null;
        // Let go of while they kept their login, and asked for again: the partner manages them again, unless the
        // workspace made them an owner since (AC-7024: the app never manages an owner it didn't have).
        if (found.removedAt !== null && active.role === 'owner') throw refuse('FORBIDDEN', OWNER_KEPT);
        if (found.removedAt !== null) {
          await tx
            .update(managedMembers)
            .set({ removedAt: null, connectionId: principal.connectionId, updatedAt: sql`now()` })
            .where(and(eq(managedMembers.workspaceId, scope.workspaceId), eq(managedMembers.id, found.id)));
          await writeAudit(
            tx,
            scope.workspaceId,
            scope.actor,
            {
              action: 'member.added',
              targetType: 'member',
              targetId: active.id,
              after: { role: storedRole(active.role) },
            },
            source,
          );
          context.record({ members: [active.id] });
        }
        // An owner (the workspace made them one) is the workspace's: nothing about them changes (AC-7024).
        if (active.role === 'owner') {
          return { member: viewOf(externalId, active, found.createdAt, undefined, hasLogin), created: false };
        }
        // An existing person: their name, address and role as given, each only when it changed.
        const nextRole: Role = role;
        // A custom role on top of Member counts as Member; anything else that differs moves.
        const roleChanges = active.role !== nextRole;
        const nameChanges = active.name !== name;
        // A login's address is its own (AC-7023): the partner's copy of it never moves it.
        const emailChanges = !hasLogin && active.email.toLowerCase() !== email;
        if (roleChanges && active.role === 'guest') await checkSeats(tx, scope, 1);
        if (roleChanges || nameChanges || emailChanges) {
          await tx
            .update(members)
            .set({
              ...(nameChanges ? { name } : {}),
              ...(emailChanges ? { email } : {}),
              ...(roleChanges ? { role: nextRole, customRoleId: null } : {}),
              ...touched(scope),
            })
            .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, active.id)));
          await tx
            .update(managedMembers)
            .set({ connectionId: principal.connectionId, updatedAt: sql`now()` })
            .where(and(eq(managedMembers.workspaceId, scope.workspaceId), eq(managedMembers.id, found.id)));
        }
        if (nameChanges || emailChanges) {
          await writeAudit(
            tx,
            scope.workspaceId,
            scope.actor,
            {
              action: 'member.profile_updated',
              targetType: 'member',
              targetId: active.id,
              // The name as History shows it; an address change is said, never written down.
              before: nameChanges ? { name: active.name } : {},
              after: { ...(nameChanges ? { name } : {}), ...(emailChanges ? { emailChanged: true } : {}) },
            },
            source,
          );
        }
        if (roleChanges) {
          await writeAudit(
            tx,
            scope.workspaceId,
            scope.actor,
            {
              action: 'member.role_changed',
              targetType: 'member',
              targetId: active.id,
              before: { role: active.role },
              after: { role: nextRole },
            },
            source,
          );
        }
        if (roleChanges) context.record({ members: [active.id], access: [active.id] });
        else if (nameChanges || emailChanges) context.record({ members: [active.id] });
        return {
          member: viewOf(
            externalId,
            { id: active.id, name, email: emailChanges || !hasLogin ? email : active.email, role: nextRole },
            found.createdAt,
            undefined,
            hasLogin,
          ),
          created: false,
        };
      },
      hooks,
    );
    return result;
  } catch (error) {
    throw emailClash(error);
  }
}

/**
 * Removes a partner's managed member from the workspace (AC-7022): their member row is marked `removed` (their handle
 * stops working, AC-5603), every feature's removal runs, and once it commits their sessions end and the directory
 * forgets them. Their page's content stays. One already removed answers `removed: false` and changes nothing; an
 * owner is refused (AC-7024); an external id this partner never added is `NOT_FOUND`.
 */
export async function removePartnerMember(
  scope: EngineScope,
  input: { readonly connectionId: string; readonly externalId: string },
  deps: { readonly users: ManagedUserEnder },
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<{ readonly removed: boolean }> {
  const principal = partnerOf(scope, input.connectionId);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockConnection(tx, principal.connectionId);
      const found = await lockManaged(tx, scope.workspaceId, principal.partnerId, input.externalId);
      if (found === undefined) throw refuse('NOT_FOUND', NO_MEMBER);
      const active = found.member?.status === 'active' ? found.member : undefined;
      if (active?.role === 'owner') throw refuse('FORBIDDEN', OWNER_KEPT);
      // Someone with their own login (AC-7023): the partner lets go of them, and they stay a member here.
      if (found.claimedAt !== null && active !== undefined) {
        if (found.removedAt !== null) return { removed: false, userId: found.userId, memberId: active.id, kept: true };
        await tx
          .update(managedMembers)
          .set({ removedAt: sql`now()`, updatedAt: sql`now()`, connectionId: principal.connectionId })
          .where(and(eq(managedMembers.workspaceId, scope.workspaceId), eq(managedMembers.id, found.id)));
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          { action: 'member.app_released', targetType: 'member', targetId: active.id },
          source,
        );
        context.record({ members: [active.id] });
        return { removed: true, userId: found.userId, memberId: active.id, kept: true };
      }
      if (found.removedAt === null) {
        await tx
          .update(managedMembers)
          .set({ removedAt: sql`now()`, updatedAt: sql`now()`, connectionId: principal.connectionId })
          .where(and(eq(managedMembers.workspaceId, scope.workspaceId), eq(managedMembers.id, found.id)));
      }
      if (active === undefined) {
        return { removed: false, userId: found.userId, memberId: found.memberId, kept: false };
      }
      const by = actorRow(scope.actor);
      await tx
        .update(members)
        .set({
          status: 'removed',
          leftAt: sql`now()`,
          removedByType: by.type,
          removedById: by.id,
          removedByMemberId: by.memberId,
          ...touched(scope),
        })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, active.id)));
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'member.removed',
          targetType: 'member',
          targetId: active.id,
          before: { status: 'active' },
          after: { status: 'removed' },
        },
        source,
      );
      // Every feature's part (spec 0031, AC-814): views, calendars, booking pages, in order.
      await runRemovalEffects(context, active.id, source);
      // Everyone's member list reads them again, and their own tabs are cut off.
      context.record({ members: [active.id], access: [active.id] });
      return { removed: true, userId: found.userId, memberId: active.id, kept: false };
    },
    hooks,
  );
  // Once committed: their sessions end at once (slice 4's embedded ones too), and their switcher forgets the workspace.
  // Someone who kept their login loses only the partner's frame (the identity store ends embedded sessions alone).
  await deps.users.endManagedUserSessions(result.userId);
  if (!result.kept) await deps.users.dropMembership(result.userId, scope.workspaceId, result.memberId);
  return { removed: result.removed };
}

/** The partner's people still in the workspace (`GET …/members`), oldest first, at most `PARTNER_MEMBERS_LIST_MAX`. */
export async function listPartnerMembers(
  scope: EngineScope,
  input: { readonly connectionId: string },
): Promise<PartnerMemberList> {
  const principal = partnerOf(scope, input.connectionId);
  const rows = await inWorkspace(scope, async (tx) => {
    await lockConnection(tx, principal.connectionId);
    return tx
      .select({
        externalId: managedMembers.externalId,
        createdAt: managedMembers.createdAt,
        id: members.id,
        name: members.name,
        email: members.email,
        role: members.role,
        claimedAt: managedMembers.claimedAt,
      })
      .from(managedMembers)
      .innerJoin(
        members,
        and(eq(members.workspaceId, managedMembers.workspaceId), eq(members.id, managedMembers.memberId)),
      )
      .where(
        and(
          eq(managedMembers.partnerId, principal.partnerId),
          isNull(managedMembers.removedAt),
          eq(members.status, 'active'),
        ),
      )
      .orderBy(asc(managedMembers.createdAt), asc(managedMembers.id))
      .limit(PARTNER_MEMBERS_LIST_MAX);
  });
  return {
    members: rows.map((row) => viewOf(row.externalId, row, row.createdAt, undefined, row.claimedAt !== null)),
  };
}
