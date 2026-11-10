// The social links of someone with no login of their own (10 Nov 2026, the owner: socials are added where the Social
// icons block is added, as on Linktree). A page only person never signs in, and a connected app's person without a
// login reaches Timefix only through the app's frame, so neither has a Settings › Profile of their own to keep their
// links in: a team page manager keeps them from the person's page editor.
//
// - Who: someone with `link_pages.manage_team`, from a member. The system that owns a person's profile controls it (10
//   Nov 2026, the owner, as with directory synced accounts): a connected app's person is that app's to keep, so only
//   from inside that app's own frame (spec 0070); in Timefix itself they are `FORBIDDEN`, with the app's name, and
//   from another app's frame `NOT_FOUND`. Once the app is disconnected, its people are kept by Timefix's managers
//   from Timefix only (the source of truth is gone, so Timefix takes over; any frame is `NOT_FOUND`) until it
//   connects again. The workspace's page only people
//   are kept from either. Anyone with a login,
//   anyone removed, and anyone in another workspace is `NOT_FOUND`. One made an owner or admin is `FORBIDDEN`: theirs
//   to keep.
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
import { liveConnectionOf } from './app-connection.ts';

const { managedMembers, members } = schema;

/** Where the manager stands: in Timefix, or inside a connected app's frame on that connection. */
export interface ManagerPlace {
  /** The frame's connection (spec 0070, AC-7031); absent in Timefix itself. */
  readonly fromConnection?: string | undefined;
  /**
   * A partner's display name by its id (the global registry, which a workspace transaction can't read), for the
   * sentence that says which app keeps a person's links; without it, or with no name, the sentence names no app.
   */
  readonly partnerName?: ((partnerId: string) => Promise<string | undefined>) | undefined;
}

const NOT_KEPT = 'That person keeps their own social links. They change them in their own Profile.';
const OWNER_OR_ADMIN = 'This person is an owner or admin now, so their social links aren’t changed from Team pages.';
const NOT_A_MEMBER = 'Only a member of this workspace changes someone’s social links from Team pages.';

/** One managed person as the check reads them: their identity, role, and who keeps them. */
interface Kept {
  readonly userId: string;
  readonly role: string;
  /** Set when a connected app keeps them and the manager stands outside that app's frame: theirs, read only. */
  readonly byPartner?: string;
}

/** The sentence a manager outside the app's frame reads, naming the app when its name is known. */
async function partnerKeepsSocials(place: ManagerPlace, partnerId: string): Promise<string> {
  const name = await place.partnerName?.(partnerId).catch(() => undefined);
  return name === undefined || name.trim() === ''
    ? 'The app that added them manages this person’s social links.'
    : `${name} manages this person’s social links.`;
}

/**
 * The person `memberId` whose social links a manager may keep, or undefined: an active managed person of this
 * workspace with no login (`claimed_at` null), not removed, whose identity is their member row's, and, from a frame,
 * a page only person or one of that frame's own live app (a disconnected app's people are Timefix's, from Timefix). A connected app's
 * person read outside a frame while the app is connected comes back with `byPartner`: the app keeps them. With
 * `lock`, the person's rows are locked for the write and the app's live connection shared.
 */
async function keptPerson(
  tx: WorkspaceTx,
  workspaceId: string,
  memberId: string,
  place: ManagerPlace,
  lock: boolean,
): Promise<Kept | undefined> {
  const managedQuery = tx
    .select({ userId: managedMembers.userId, partnerId: managedMembers.partnerId })
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
  // Read first, then locked after the app's connection: the order a partner's PUT and the exchange lock in (the
  // connection, then the person), so the three never wait on each other in a circle.
  const [managed] = await managedQuery;
  if (managed === undefined) return undefined;
  // The app that added them keeps them only while it is connected here (10 Nov 2026), from its frame on that live
  // connection; once it is disconnected Timefix's managers keep them, from Timefix only: no frame, of any app, reaches
  // them then. A page only person is reachable from anywhere.
  const live =
    managed.partnerId === null ? undefined : await liveConnectionOf(tx, workspaceId, managed.partnerId, lock);
  if (lock) {
    const [held] = await managedQuery.for('update');
    if (held?.partnerId !== managed.partnerId || held.userId !== managed.userId) return undefined;
  }
  if (place.fromConnection !== undefined && managed.partnerId !== null && live !== place.fromConnection) {
    return undefined;
  }
  const personQuery = tx
    .select({ userId: members.userId, role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.id, memberId), eq(members.status, 'active')));
  const [person] = lock ? await personQuery.for('update') : await personQuery;
  if (person === undefined || person.userId !== managed.userId || person.role === 'guest') return undefined;
  // In Timefix itself, a connected app's person is the app's to keep (10 Nov 2026), while it is connected.
  const byPartner =
    place.fromConnection === undefined && managed.partnerId !== null && live !== undefined
      ? managed.partnerId
      : undefined;
  return { userId: managed.userId, role: person.role, ...(byPartner === undefined ? {} : { byPartner }) };
}

/**
 * Who keeps `memberId`'s social links, for a team page manager's editor (`MyProfile.socialsByManager` and
 * `managedByApp`): `manager` when the manager may change them here, `{ partnerId }` when a connected app keeps them
 * and the manager stands outside that app's frame, undefined when the person keeps their own or isn't reachable from
 * here. The same rule `setManagedSocials` writes by, read without a lock. One to three statements.
 */
export async function socialsKeeperOf(
  tx: WorkspaceTx,
  workspaceId: string,
  memberId: string,
  place: ManagerPlace,
): Promise<'manager' | { readonly partnerId: string } | undefined> {
  const kept = await keptPerson(tx, workspaceId, memberId, place, false);
  if (kept === undefined || kept.role === 'owner' || kept.role === 'admin') return undefined;
  return kept.byPartner === undefined ? 'manager' : { partnerId: kept.byPartner };
}

/**
 * Replaces the social links of a person with no login of their own (10 Nov 2026), from their page's editor:
 * `link_pages.manage_team`, from a member. Only a page only person, or a connected app's person who has no login from
 * inside that app's own frame; that app's person from Timefix itself is `FORBIDDEN` (the app keeps them), anyone else,
 * anyone removed and anyone elsewhere is `NOT_FOUND`, one made an owner or admin is `FORBIDDEN`. Each link is checked again, one per network, at most ten. A set that changes
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
  // The app that keeps the person, when the write was refused for it: named only once the transaction has ended, so
  // the registry's read never waits with this person's rows locked.
  let refusedFor: string | undefined;
  const written = runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const kept = await keptPerson(tx, scope.workspaceId, input.member, place, true);
      if (kept === undefined) throw refuse('NOT_FOUND', NOT_KEPT);
      if (kept.role === 'owner' || kept.role === 'admin') throw refuse('FORBIDDEN', OWNER_OR_ADMIN);
      if (kept.byPartner !== undefined) {
        refusedFor = kept.byPartner;
        throw refuse('FORBIDDEN', 'A connected app manages this person’s social links.');
      }
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
  try {
    return (await written).result;
  } catch (error) {
    if (refusedFor !== undefined) throw refuse('FORBIDDEN', await partnerKeepsSocials(place, refusedFor));
    throw error;
  }
}
