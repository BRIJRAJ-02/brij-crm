// The social links of someone with no login of their own (10 Nov 2026, the owner: socials are added where the Social
// icons block is added, as on Linktree). A page only person never signs in, and a connected app's person without a
// login reaches Timefix only through the app's frame, so neither has a Settings › Profile of their own to keep their
// links in: a team page manager keeps them from the person's page editor.
//
// - Who: someone with `link_pages.manage_team`, from a member. Inside a connected app's frame (spec 0070), only that
//   app's own people and the workspace's page only people; another app's people are `NOT_FOUND`, as is anyone with a
//   login, anyone removed, and anyone in another workspace. One made an owner or admin is `FORBIDDEN`: theirs to keep.
// - Like a name or a title, the set is live the moment it saves (it is profile data, never a page's draft), so the
//   page's Publish bar has nothing to read; the api clears the edge's copies of their page once it commits.
import type { ManagedSocialsSaved, SocialLink } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import { publicProfilesOf } from '../booking/handles.ts';
import { checkedSocialLinks, sameSocialLinks, saveSocialLinks, socialLinksOfUser } from '../booking/socials.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';

const { managedMembers, members } = schema;

/** Where the manager stands: in Timefix, or inside a connected app's frame on that connection. */
export interface ManagerPlace {
  /** The frame's connection (spec 0070, AC-7031); absent in Timefix itself. */
  readonly fromConnection?: string | undefined;
}

const NOT_KEPT = 'That person keeps their own social links. They change them in their own Profile.';
const OWNER_OR_ADMIN = 'This person is an owner or admin now, so their social links aren’t changed from Team pages.';
const NOT_A_MEMBER = 'Only a member of this workspace changes someone’s social links from Team pages.';

/** One managed person as the check reads them: their identity, role, and who keeps them. */
interface Kept {
  readonly userId: string;
  readonly role: string;
}

/**
 * The person `memberId` whose social links a manager may keep, or undefined: an active managed person of this
 * workspace with no login (`claimed_at` null), not removed, whose identity is their member row's, and, from a frame,
 * a page only person or one of that frame's connection. With `lock`, both rows are locked for the write.
 */
async function keptPerson(
  tx: WorkspaceTx,
  workspaceId: string,
  memberId: string,
  place: ManagerPlace,
  lock: boolean,
): Promise<Kept | undefined> {
  const managedQuery = tx
    .select({
      userId: managedMembers.userId,
      partnerId: managedMembers.partnerId,
      connectionId: managedMembers.connectionId,
    })
    .from(managedMembers)
    .where(
      and(
        eq(managedMembers.workspaceId, workspaceId),
        eq(managedMembers.memberId, memberId),
        isNull(managedMembers.removedAt),
        isNull(managedMembers.claimedAt),
      ),
    )
    .limit(1);
  const [managed] = lock ? await managedQuery.for('update') : await managedQuery;
  if (managed === undefined) return undefined;
  // Inside an app's frame, another app's people are not this frame's to reach.
  if (
    place.fromConnection !== undefined &&
    managed.partnerId !== null &&
    managed.connectionId !== place.fromConnection
  ) {
    return undefined;
  }
  const personQuery = tx
    .select({ userId: members.userId, role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.id, memberId), eq(members.status, 'active')));
  const [person] = lock ? await personQuery.for('update') : await personQuery;
  if (person === undefined || person.userId !== managed.userId || person.role === 'guest') return undefined;
  return { userId: managed.userId, role: person.role };
}

/**
 * Whether a team page manager may keep `memberId`'s social links from the editor (`MyProfile.socialsByManager`):
 * the same rule `setManagedSocials` writes by, read without a lock. One or two statements.
 */
export async function managerKeepsSocials(
  tx: WorkspaceTx,
  workspaceId: string,
  memberId: string,
  place: ManagerPlace,
): Promise<boolean> {
  const kept = await keptPerson(tx, workspaceId, memberId, place, false);
  return kept !== undefined && kept.role !== 'owner' && kept.role !== 'admin';
}

/**
 * Replaces the social links of a person with no login of their own (10 Nov 2026), from their page's editor:
 * `link_pages.manage_team`, from a member. Only a page only person, or a connected app's person who has no login (from
 * inside an app's frame, only that app's own); anyone else, anyone removed and anyone elsewhere is `NOT_FOUND`, one
 * made an owner or admin is `FORBIDDEN`. Each link is checked again, one per network, at most ten. A set that changes
 * nothing writes nothing; otherwise, in one transaction under both rows' locks: the set, one `member.profile_updated`
 * History row with the manager as actor, and a `members` outbox row. Answers the set as saved, and their handle for
 * the api to clear the edge's copies of their page.
 */
export async function setManagedSocials(
  scope: EngineScope,
  input: { readonly member: string; readonly socials: readonly SocialLink[] },
  hooks: readonly AfterWrite[] = [],
  source: AuditSource = {},
  place: ManagerPlace = {},
): Promise<ManagedSocialsSaved & { readonly handle?: string }> {
  requirePermission(scope, 'link_pages.manage_team');
  if (scope.actor.type !== 'member') throw refuse('FORBIDDEN', NOT_A_MEMBER);
  const socials = checkedSocialLinks(input.socials);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const kept = await keptPerson(tx, scope.workspaceId, input.member, place, true);
      if (kept === undefined) throw refuse('NOT_FOUND', NOT_KEPT);
      if (kept.role === 'owner' || kept.role === 'admin') throw refuse('FORBIDDEN', OWNER_OR_ADMIN);
      const held = await socialLinksOfUser(tx, kept.userId);
      const page = (await publicProfilesOf(tx, scope.workspaceId, [kept.userId])).get(kept.userId);
      const saved = { socials: [...socials], ...(page === undefined ? {} : { handle: page.handle }) };
      if (sameSocialLinks(socials, held)) return saved;
      await saveSocialLinks(tx, kept.userId, socials);
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'member.profile_updated',
          targetType: 'member',
          targetId: input.member,
          before: { socials: held.map((link) => link.href) },
          after: { socials: socials.map((link) => link.href) },
        },
        source,
      );
      context.record({ members: [input.member] });
      return saved;
    },
    hooks,
  );
  return result;
}
