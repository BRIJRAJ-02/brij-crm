// Team link pages (spec 0070, slice 1, AC-7001 to AC-7004): everyone's link page in one workspace, for owners, admins
// and holders of `link_pages.manage_team`. The editor is the member's own: the link page services run on the scope the
// door's `enterTeamLinkPage` mints (the manager as actor, the member as principal), so they act on that member's page
// and nothing else. Here: the list, a handle claimed for someone, the History row for every change to someone else's
// page, and the one line a member reads about who last changed theirs.
import {
  PERMISSIONS,
  type LinkPageEditedBy,
  type LinkPageTeamChange,
  type TeamLinkPage,
  type TeamLinkPages,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { enterTeamLinkPage, isTeamPageEdit } from '../access/door.ts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { checkScope } from '../access/mint.ts';
import { publicProfilesOf, savePublicProfile } from '../booking/handles.ts';
import type { EngineScope } from '../engine/scope.ts';
import { isRefusal, refuse, refuseOn } from '../engine/refusals.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';

const { auditEvents, members } = schema;

/** The audit actions that are a change to a member's link page, whoever made them. */
const PAGE_ACTIONS = [
  'link_page.changed_for',
  'link_page.published',
  'link_page.draft_discarded',
  'link_page.version_restored',
] as const;

/** The most members one read lists: the workspace's seats are far fewer, and the definer refuses more. */
const TEAM_MAX = 1000;

/** A picture we may show: an https address, or nothing (initials on a colour). */
function safeImage(image: string | null): string | undefined {
  if (image === null) return undefined;
  try {
    return new URL(image).protocol === 'https:' ? image : undefined;
  } catch {
    return undefined;
  }
}

/** The first and last day (UTC) of the month `now` falls in, as `YYYY-MM-DD`. */
export function monthOf(now: Date): { readonly from: string; readonly to: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = (date: Date) => date.toISOString().slice(0, 10);
  return { from: day(new Date(Date.UTC(year, month, 1))), to: day(new Date(Date.UTC(year, month + 1, 0))) };
}

interface MemberRow {
  readonly id: string;
  readonly userId: string | null;
  readonly name: string;
  readonly avatarUrl: string | null;
}

interface ViewsRow extends Record<string, unknown> {
  readonly user_id: string;
  readonly views: string | number;
}

/** The rows of `people`, each with their handle, Live or not, and this month's views, read in two statements. */
async function pagesOf(
  tx: WorkspaceTx,
  workspaceId: string,
  self: string | undefined,
  people: readonly MemberRow[],
  month: { readonly from: string; readonly to: string },
): Promise<readonly TeamLinkPage[]> {
  const userIds = people.flatMap((person) => (person.userId === null ? [] : [person.userId]));
  const held = await publicProfilesOf(tx, workspaceId, userIds);
  const views = new Map<string, number>();
  if (userIds.length > 0) {
    const counted = await tx.execute<ViewsRow>(
      sql`select user_id::text as user_id, views from crm_team_profile_views(${`{${userIds.join(',')}}`}::uuid[], ${workspaceId}::uuid, ${month.from}::date, ${month.to}::date)`,
    );
    for (const row of counted.rows) views.set(row.user_id, Number(row.views));
  }
  return people.map((person) => {
    const page = person.userId === null ? undefined : held.get(person.userId);
    const image = safeImage(person.avatarUrl);
    return {
      memberId: person.id,
      name: person.name,
      ...(image === undefined ? {} : { image }),
      ...(page === undefined ? {} : { handle: page.handle }),
      isLive: page?.isShown === true,
      views: person.userId === null ? 0 : (views.get(person.userId) ?? 0),
      isSelf: person.id === self,
    };
  });
}

/** The caller's member id, when the caller is a member. */
function selfOf(scope: EngineScope): string | undefined {
  const { principal } = scope.access;
  return principal.kind === 'member' ? principal.memberId : undefined;
}

/**
 * Every active member's link page in the workspace (AC-7001), by name: their handle, whether it is Live, and its views
 * this calendar month (UTC). `link_pages.manage_team` first. Guests have no link page and aren't listed; a member made
 * without an identity of their own is listed with no page, since nobody can claim one for them. Three statements.
 */
export async function listTeamLinkPages(scope: EngineScope, now: Date = new Date()): Promise<TeamLinkPages> {
  requirePermission(scope, 'link_pages.manage_team');
  const month = monthOf(now);
  const pages = await inWorkspace(scope, async (tx) => {
    const people = await tx
      .select({ id: members.id, userId: members.userId, name: members.name, avatarUrl: members.avatarUrl })
      .from(members)
      .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.status, 'active'), ne(members.role, 'guest')))
      .orderBy(asc(members.name), asc(members.id))
      .limit(TEAM_MAX);
    return pagesOf(tx, scope.workspaceId, selfOf(scope), people, month);
  });
  return { pages: [...pages], month: month.from };
}

/**
 * Claims `handle` for a member who has no link page in this workspace yet (AC-7002), through the door's
 * `enterTeamLinkPage` (`link_pages.manage_team`, then an active member of this workspace). The page starts Private,
 * empty, and its member's: a manager turns it Live with its switch, never by claiming it. A member who already has a
 * page is `CONFIG_INVALID`: their handle is theirs to change. One `link_page.changed_for` row, in the same
 * transaction. Answers their row as Team pages lists it.
 */
export async function claimTeamHandle(
  scope: EngineScope,
  input: { readonly member: string; readonly handle: string },
  source: AuditSource = {},
  now: Date = new Date(),
): Promise<TeamLinkPage> {
  const page = await enterTeamLinkPage(scope, input.member);
  const { principal } = page.access;
  if (principal.kind !== 'member' || principal.userId === undefined)
    throw refuse('NOT_FOUND', 'That person isn’t in this workspace.');
  const userId = principal.userId;
  const handle = input.handle.trim().toLowerCase();
  return inWorkspace(page, async (tx) => {
    const [person] = await tx
      .select({ id: members.id, userId: members.userId, name: members.name, avatarUrl: members.avatarUrl })
      .from(members)
      .where(and(eq(members.workspaceId, page.workspaceId), eq(members.id, principal.memberId)));
    if (person === undefined) throw refuse('NOT_FOUND', 'That person isn’t in this workspace.');
    const held = (await publicProfilesOf(tx, page.workspaceId, [userId])).get(userId);
    if (held !== undefined) {
      throw refuseOn('CONFIG_INVALID', `${person.name} already has a link page here, at /${held.handle}.`, 'handle');
    }
    try {
      await savePublicProfile(tx, userId, page.workspaceId, handle, '');
    } catch (error) {
      // Their own limit, in words about them rather than about the caller.
      if (isRefusal(error) && error.refusal.code === 'LIMIT_REACHED') {
        throw refuseOn(
          'LIMIT_REACHED',
          `${person.name} has link pages in 20 workspaces, the most one person can have.`,
          'handle',
        );
      }
      throw error;
    }
    if (page !== scope) {
      await writeAudit(
        tx,
        page.workspaceId,
        page.actor,
        {
          action: 'link_page.changed_for',
          targetType: 'member',
          targetId: principal.memberId,
          after: { change: 'handle', handle },
        },
        source,
      );
    }
    const [row] = await pagesOf(tx, page.workspaceId, selfOf(scope), [person], monthOf(now));
    if (row === undefined) throw refuse('NOT_FOUND', 'That person isn’t in this workspace.');
    return row;
  });
}

/**
 * Writes the History row for one change a team page manager made to someone else's link page (AC-7004): the manager
 * as actor, the member whose page it is as target, and what changed. Only on a scope `enterTeamLinkPage` made for
 * someone else; anything else is `FORBIDDEN`. Publish, Discard and Restore write their own rows and don't call this.
 * Its own transaction, run once the change has committed (the link page services write in theirs).
 */
export async function noteTeamPageChange(
  scope: EngineScope,
  change: LinkPageTeamChange,
  source: AuditSource = {},
): Promise<void> {
  checkScope(scope);
  const { principal } = scope.access;
  if (!isTeamPageEdit(scope) || principal.kind !== 'member') {
    throw refuse('FORBIDDEN', PERMISSIONS['link_pages.manage_team'].message);
  }
  await inWorkspace(scope, (tx) =>
    writeAudit(
      tx,
      scope.workspaceId,
      scope.actor,
      { action: 'link_page.changed_for', targetType: 'member', targetId: principal.memberId, after: { change } },
      source,
    ),
  );
}

/**
 * Who last changed the caller's own link page when it wasn't them (AC-7004): "Edited by Ana", on their own page. Any
 * member, about themself only (no input names whose); a guest, a key or the system has no page and gets nothing. One
 * statement on `audit_events_target`.
 */
export async function readLinkPageEditedBy(scope: EngineScope): Promise<LinkPageEditedBy> {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'member' || principal.role === 'guest' || isTeamPageEdit(scope)) return {};
  const self = principal.memberId;
  const found = await inWorkspace(scope, async (tx) => {
    const [row] = await tx
      .select({ at: auditEvents.at, name: members.name })
      .from(auditEvents)
      .innerJoin(
        members,
        and(eq(members.workspaceId, auditEvents.workspaceId), eq(members.id, auditEvents.actorMemberId)),
      )
      .where(
        and(
          eq(auditEvents.workspaceId, scope.workspaceId),
          eq(auditEvents.targetType, 'member'),
          eq(auditEvents.targetId, self),
          inArray(auditEvents.action, [...PAGE_ACTIONS]),
          ne(auditEvents.actorMemberId, self),
        ),
      )
      .orderBy(desc(auditEvents.at))
      .limit(1);
    return row;
  });
  if (found === undefined) return {};
  return { last: { name: found.name, at: new Date(found.at).toISOString() } };
}
