// Page only people (9 Nov 2026, the owner: "admin to be able to make pages like timefix.com/nick, timefix.com/kate,
// without nick and kate signing up themselves"). Someone with `link_pages.manage_team` adds a person from Team pages,
// in Timefix or inside a partner's frame, and gets their link page at `/<handle>`, Private until someone turns it Live.
//
// - A page only person is a managed member nobody's partner added (`managed_members` with no partner and no
//   connection, `created_by_member_id` naming who added them, migration 0196). Their identity is slice 3's: a made up
//   `.invalid` address, no password, no linked account, refused by the session hook, so they never sign in, get no
//   invitation and no email from us, and no Timefix account is ever merged with them, whatever address they're given.
// - Their real address, when they have one, is only on their member row; one an active member here already uses, or
//   an open invitation names, is refused (409). With none, the member row holds the identity's made up address, which
//   no screen shows (`isManagedAddress`).
// - A partner's PUT and DELETE are keyed by the partner and its external id, so they never find a page only person.
// - They are a member (Member role) and take a seat, as anyone does. Owners are never made this way.
// - Removing one is a member removal, as a partner's DELETE is: their row is marked `removed` (their handle stops,
//   AC-5603), every feature's removal runs, and their page's content stays for 30 days.
import {
  type PageOnlyRemoved,
  type TeamHandleCheck,
  type TeamHandleSuggestion,
  type TeamLinkPage,
} from '@crm/contracts';
import { handleProblem } from '@crm/contracts/handles';
import { MANAGED_DOMAIN, schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { savePublicProfile, suggestHandle } from '../booking/handles.ts';
import { touched } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal, refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow, type EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import { checkSeats } from '../members/invitations.ts';
import { runRemovalEffects } from '../members/removal.ts';
import { emailClash, emailTaken } from '../partners/members.ts';
import { recordJoinReach } from '../scheduling/delegations.ts';
import { monthOf, pagesOf, selfOf } from './team-pages.ts';

const { managedMembers, members } = schema;

/** What adding a page only person needs of the identity store. */
export interface PageOnlyUserMaker {
  ensurePageOnlyUser(person: {
    readonly workspaceId: string;
    readonly personId: string;
    readonly name: string;
  }): Promise<string>;
  /** Drops an identity a refused add made, when it never joined (best effort). */
  dropPageOnlyUser(userId: string): Promise<boolean>;
}

/** What a removal needs of the identity store, once it has committed. */
export interface PageOnlyUserEnder {
  endManagedUserSessions(userId: string): Promise<number>;
  dropMembership(userId: string, workspaceId: string, memberId?: string): Promise<void>;
}

const EMAIL_TAKEN =
  'Someone in this workspace already uses this email, or was invited with it. Leave it empty or use another.';
const NOT_PAGE_ONLY = 'That person isn’t a page only person here. Remove anyone else from Members.';
const NOT_A_MEMBER = 'Only a member of this workspace adds people from Team pages.';
const ADMIN_KEPT = 'This person is an admin now. Only owners and admins can remove them.';
const OWNER_KEPT = 'This person is an owner of the workspace. Only owners remove them, from Members.';

/** Whether anyone holds or ever held `handle`: a handle is never freed (AC-5603). */
async function isHeld(tx: WorkspaceTx, handle: string): Promise<boolean> {
  const found = await tx.execute<{ held: boolean } & Record<string, unknown>>(
    sql`select crm_handle_taken(${handle}) as held`,
  );
  return found.rows[0]?.held === true;
}

/**
 * Whether `handle` can be claimed now (Add a page, as it is typed): a well formed handle, not kept for Timefix, that
 * nobody holds or ever held. The same rules the claim refuses on, so `isFree` never promises what Create would refuse.
 * `link_pages.manage_team` first. One statement.
 */
export async function checkTeamHandle(
  scope: EngineScope,
  input: { readonly handle: string },
): Promise<TeamHandleCheck> {
  requirePermission(scope, 'link_pages.manage_team');
  const handle = input.handle.trim().toLowerCase();
  if (handleProblem(handle) !== undefined) return { isFree: false };
  return { isFree: !(await inWorkspace(scope, (tx) => isHeld(tx, handle))) };
}

/** A free handle from a name, for Add a page's first value: absent when every try is taken. `link_pages.manage_team`. */
export async function suggestTeamHandle(
  scope: EngineScope,
  input: { readonly name: string },
): Promise<TeamHandleSuggestion> {
  requirePermission(scope, 'link_pages.manage_team');
  const name = input.name.trim();
  if (name === '') return {};
  const handle = await inWorkspace(scope, (tx) => suggestHandle(tx, name));
  return handle === undefined ? {} : { handle };
}

/**
 * Adds a page only person (9 Nov 2026): a Member with no login, their identity made by the identity store, and their
 * link page at `handle`, Private. `link_pages.manage_team`, from a member. Refused before an identity is made, so a
 * refused add leaves nothing behind: an address in use or invited (`UNIQUE_CONFLICT` on `email`), a handle taken
 * (`SLUG_TAKEN` on `handle`), a full workspace (`SEAT_LIMIT`). One `member.added` History row (`pageOnly`) and the
 * `members` and `access` outbox rows, in the same transaction. Answers their row as Team pages lists it.
 */
export async function addPageOnlyPerson(
  scope: EngineScope,
  input: { readonly name: string; readonly email?: string | undefined; readonly handle: string },
  deps: { readonly users: PageOnlyUserMaker },
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
  now: Date = new Date(),
): Promise<TeamLinkPage> {
  requirePermission(scope, 'link_pages.manage_team');
  if (scope.actor.type !== 'member') throw refuse('FORBIDDEN', NOT_A_MEMBER);
  const maker = scope.actor.id;
  const name = input.name.trim().slice(0, 80);
  const given = input.email?.trim().toLowerCase();
  const email = given === '' ? undefined : given;
  const handle = input.handle.trim().toLowerCase();
  if (name === '') throw refuseOn('CONFIG_INVALID', 'Add their name.', 'name');
  const wrong = handleProblem(handle);
  if (wrong !== undefined) throw refuseOn('CONFIG_INVALID', wrong, 'handle');
  await inWorkspace(scope, async (tx) => {
    if (email !== undefined && (await emailTaken(tx, scope.workspaceId, email))) {
      throw refuseOn('UNIQUE_CONFLICT', EMAIL_TAKEN, 'email');
    }
    if (await isHeld(tx, handle)) throw refuseOn('SLUG_TAKEN', 'That handle is taken. Pick another.', 'handle');
    await checkSeats(tx, scope, 1);
  });
  const personId = newId();
  const userId = await deps.users.ensurePageOnlyUser({ workspaceId: scope.workspaceId, personId, name });
  try {
    const { result } = await runWrite(
      scope,
      async (context) => {
        const { tx } = context;
        if (email !== undefined && (await emailTaken(tx, scope.workspaceId, email))) {
          throw refuseOn('UNIQUE_CONFLICT', EMAIL_TAKEN, 'email');
        }
        await checkSeats(tx, scope, 1);
        const memberId = newId();
        const by = actorRow(scope.actor);
        await tx.insert(members).values({
          workspaceId: scope.workspaceId,
          id: memberId,
          userId,
          name,
          // With no address of their own, the identity's made up one: unique, never mailed, never shown.
          email: email ?? `${userId}@${MANAGED_DOMAIN}`,
          role: 'member',
          createdByType: by.type,
          createdById: by.id,
          createdByMemberId: by.memberId,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        });
        await tx.execute(
          sql`insert into auth.workspace_membership (user_id, workspace_id, member_id) values (${userId}, ${scope.workspaceId}, ${memberId}) on conflict do nothing`,
        );
        await tx.insert(managedMembers).values({
          workspaceId: scope.workspaceId,
          id: personId,
          partnerId: null,
          externalId: personId,
          connectionId: null,
          createdByMemberId: maker,
          memberId,
          userId,
        });
        // Their page, at the handle given, Private: it goes public only when someone turns on Live (AC-7002).
        await savePublicProfile(tx, userId, scope.workspaceId, handle, '');
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          {
            action: 'member.added',
            targetType: 'member',
            targetId: memberId,
            after: { role: 'member', pageOnly: true, handle },
          },
          source,
        );
        context.record({ members: [memberId], access: [memberId] });
        await recordJoinReach(context, scope.workspaceId, memberId);
        const [row] = await pagesOf(
          tx,
          scope.workspaceId,
          selfOf(scope),
          [{ id: memberId, userId, name, avatarUrl: null }],
          monthOf(now),
        );
        if (row === undefined) throw new Error('A page only person just added could not be read back.');
        return row;
      },
      hooks,
    );
    return result;
  } catch (error) {
    // Refused after the identity was made (a race): it never joined, so it goes again. Best effort: an orphan can't
    // sign in, and the error said is the refusal's.
    await deps.users.dropPageOnlyUser(userId).catch(() => false);
    // Two adds at once with one address: the unique index's clash, said as the read says it.
    const clash = emailClash(error);
    if (isRefusal(clash) && clash !== error) throw refuseOn('UNIQUE_CONFLICT', EMAIL_TAKEN, 'email');
    throw error;
  }
}

/**
 * Removes a page only person (9 Nov 2026), as a partner's DELETE removes its person (AC-7022): their member row is
 * marked `removed` (their handle stops working, AC-5603), every feature's removal runs, and once it commits their
 * sessions end and the directory forgets them. Their page's content stays 30 days. `link_pages.manage_team`; anyone
 * who isn't a page only person here is `NOT_FOUND` (Members removes them). One the workspace made an owner is refused,
 * and an admin needs `members.manage`. One already gone answers `removed: false`.
 */
export async function removePageOnlyPerson(
  scope: EngineScope,
  input: { readonly member: string },
  deps: { readonly users: PageOnlyUserEnder },
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
): Promise<PageOnlyRemoved> {
  requirePermission(scope, 'link_pages.manage_team');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [found] = await tx
        .select({ id: managedMembers.id, userId: managedMembers.userId, removedAt: managedMembers.removedAt })
        .from(managedMembers)
        .where(
          and(
            eq(managedMembers.workspaceId, scope.workspaceId),
            eq(managedMembers.memberId, input.member),
            isNull(managedMembers.partnerId),
          ),
        )
        .for('update');
      if (found === undefined) throw refuse('NOT_FOUND', NOT_PAGE_ONLY);
      const [person] = await tx
        .select({ id: members.id, role: members.role, status: members.status })
        .from(members)
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, input.member)))
        .for('update');
      const active = person?.status === 'active' ? person : undefined;
      if (active?.role === 'owner') throw refuse('FORBIDDEN', OWNER_KEPT);
      if (active?.role === 'admin' && !can(scope.access, 'members.manage')) throw refuse('FORBIDDEN', ADMIN_KEPT);
      if (found.removedAt === null) {
        await tx
          .update(managedMembers)
          .set({ removedAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(managedMembers.workspaceId, scope.workspaceId), eq(managedMembers.id, found.id)));
      }
      if (active === undefined) return { removed: false, userId: found.userId, memberId: input.member };
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
          after: { status: 'removed', pageOnly: true },
        },
        source,
      );
      await runRemovalEffects(context, active.id, source);
      context.record({ members: [active.id], access: [active.id] });
      return { removed: true, userId: found.userId, memberId: active.id };
    },
    hooks,
  );
  if (result.removed) {
    await deps.users.endManagedUserSessions(result.userId);
    await deps.users.dropMembership(result.userId, scope.workspaceId, result.memberId);
  }
  return { removed: result.removed };
}
