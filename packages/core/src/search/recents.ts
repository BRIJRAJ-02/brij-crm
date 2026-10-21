// The command menu's recent items (spec 0039, AC-1075, AC-1076, AC-1088,
// AC-1091, AC-1092): the records and views each member opened last. A
// member's own bookmark, like `member_view_state`: no outbox row, at most
// `RECENTS_KEPT` rows per member, and read back only through the access
// door, so a record now hidden, trashed or purged, or a view no longer
// theirs to see, simply isn't listed. A visit to something the caller can't
// see is quietly not kept, the same answer as success, so the call can't
// probe ids.
import { and, eq, sql } from 'drizzle-orm';
import type { RecentItem, ViewHit } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { canonicalId, isUuid } from '../engine/ids.ts';
import { readRecords } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import type { WriteContext } from '../engine/write.ts';
import { objectLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { recordVisibleSql } from '../access/visibility.ts';
import { memberOf, readView } from '../views/views.ts';
import { findViews, searchedObjects } from './search.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';

const { memberRecents } = schema;

/** The most recent items kept per member; each visit prunes past them. */
export const RECENTS_KEPT = 20;
/** How many recent items a read answers by default: the menu shows 6 (AC-1075). */
export const RECENTS_LISTED = 6;

/** What the menu opened: a record or a view, by id. */
export interface RecentVisit {
  readonly kind: 'record' | 'view';
  readonly id: string;
}

/**
 * The caller's recent items they may still see, newest first, at most
 * `limit` (AC-1076). An API key (no member) has none.
 */
export async function listRecents(scope: EngineScope, limit = RECENTS_LISTED): Promise<readonly RecentItem[]> {
  const caller = memberOf(scope);
  if (caller === undefined) return [];
  return inWorkspace(scope, async (tx) => {
    const rows = await tx
      .select({ kind: memberRecents.kind, targetId: memberRecents.targetId })
      .from(memberRecents)
      .where(and(eq(memberRecents.workspaceId, scope.workspaceId), eq(memberRecents.memberId, caller)))
      .orderBy(sql`${memberRecents.visitedAt} desc`)
      .limit(RECENTS_KEPT);
    if (rows.length === 0) return [];
    const recordIds = rows.filter((row) => row.kind === 'record').map((row) => row.targetId);
    const viewIds = rows.filter((row) => row.kind === 'view').map((row) => row.targetId);
    // Through the door: live records the caller may see (readRecords checks objects and rules), and views
    // they see on readable live objects (findViews). One read of the readable objects serves both.
    const searched = await searchedObjects(tx, scope);
    const readable = searched.map((object) => object.id);
    const records =
      recordIds.length === 0
        ? []
        : await readRecords(tx, scope.access, recordIds, {
            attributeIds: [],
            attributes: new Map(searched.map((object) => [object.id, object.attributes])),
          });
    const recordRefs = new Map(records.map((record) => [record.id, record.display]));
    const views = viewIds.length === 0 ? [] : await findViews(tx, scope, readable, { ids: viewIds }, RECENTS_KEPT);
    const viewHits = new Map<string, ViewHit>(views.map((view) => [view.id, view]));
    const items = rows.flatMap((row): RecentItem[] => {
      if (row.kind === 'record') {
        const ref = recordRefs.get(row.targetId);
        // A record on an archived object stays readable but isn't somewhere the menu can open.
        return ref === undefined || !readable.includes(ref.objectId) ? [] : [{ kind: 'record', ref }];
      }
      const view = viewHits.get(row.targetId);
      return view === undefined ? [] : [{ kind: 'view', view }];
    });
    return items.slice(0, Math.max(1, Math.min(limit, RECENTS_KEPT)));
  });
}

/** Whether the caller may see a view they say they opened: theirs to see, on an object they may read. */
async function seesViewNow(tx: WorkspaceTx, scope: EngineScope, viewId: string): Promise<boolean> {
  try {
    const view = await readView(tx, scope, viewId, false);
    return objectLevel(scope.access, view.objectId) !== 'none';
  } catch (error) {
    if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') return false;
    throw error;
  }
}

/**
 * Keeps a record or a view the caller just opened as their newest recent
 * item (AC-1088), and drops their items past `RECENTS_KEPT`. Something they
 * can't see, a malformed id, or an API key: nothing is kept and nothing is
 * said (AC-1091).
 */
export async function visitRecent(scope: EngineScope, visit: RecentVisit): Promise<void> {
  const caller = memberOf(scope);
  if (caller === undefined || !isUuid(visit.id)) return;
  const id = canonicalId(visit.id);
  await inWorkspace(scope, async (tx) => {
    const upsert = sql`on conflict (workspace_id, member_id, kind, target_id) do update set visited_at = now()`;
    if (visit.kind === 'record') {
      // One statement whatever the record is: kept only when it is live and the caller may see it, so neither
      // the answer nor its timing tells a hidden record from a missing one.
      const visible = recordVisibleSql(scope.access, 'r');
      await tx.execute(sql`
        insert into member_recents (workspace_id, member_id, kind, target_id)
        select r.workspace_id, ${caller}::uuid, 'record', r.id from records r
        where r.id = ${id}::uuid and r.deleted_at is null${visible === undefined ? sql`` : sql` and ${visible}`}
        ${upsert}
      `);
    } else {
      if (!(await seesViewNow(tx, scope, id))) return;
      await tx.execute(sql`
        insert into member_recents (workspace_id, member_id, kind, target_id)
        values (${scope.workspaceId}::uuid, ${caller}::uuid, 'view', ${id}::uuid)
        ${upsert}
      `);
    }
    // Past the newest `RECENTS_KEPT`, by the member's time index.
    await tx.execute(sql`
      delete from member_recents m
      using (
        select kind, target_id from member_recents
        where workspace_id = ${scope.workspaceId}::uuid and member_id = ${caller}::uuid
        order by visited_at desc
        offset ${RECENTS_KEPT}
      ) old
      where m.workspace_id = ${scope.workspaceId}::uuid and m.member_id = ${caller}::uuid
        and m.kind = old.kind and m.target_id = old.target_id
    `);
  });
}

/** Inside a member's removal (spec 0009's `removeMember`, AC-1092): their recent items go with them. */
export async function deleteMemberRecents(context: WriteContext, memberId: string): Promise<void> {
  const { tx, scope } = context;
  await tx
    .delete(memberRecents)
    .where(and(eq(memberRecents.workspaceId, scope.workspaceId), eq(memberRecents.memberId, memberId)));
}

/** Inside a view's delete (AC-1092): it leaves everyone's recent items. */
export async function deleteViewRecents(tx: WorkspaceTx, scope: EngineScope, viewId: string): Promise<void> {
  await tx
    .delete(memberRecents)
    .where(
      and(
        eq(memberRecents.workspaceId, scope.workspaceId),
        eq(memberRecents.kind, 'view'),
        eq(memberRecents.targetId, viewId),
      ),
    );
}

/** A removal (spec 0031, AC-814): their recent items go (spec 0039, AC-1092). */
export const recentsRemoval: RemovalEffect = {
  feature: 'recents',
  constraints: ['member_recents_member'],
  run: deleteMemberRecents,
};
