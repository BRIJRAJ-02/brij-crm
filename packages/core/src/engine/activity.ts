// A record's timeline, built on read (spec 0017, 0017-activity.md): never
// stored, read from the history the engine already keeps. Each source answers
// its newest entries past the cursor, at most `limit + 1`, in key order; the
// service merges them and keeps the first `limit`. The creation, every value
// version and every link moment (`activity-sources.ts`) are registered here,
// with notes and tasks (#19), comments, meetings, form submissions and the
// record's move to the trash; a filter (`kinds`) reads only the sources that
// answer those kinds.
import { sql } from 'drizzle-orm';
import {
  ACTIVITY_PAGE,
  ACTIVITY_RANKS,
  ActivityCursor,
  activityKey,
  compareActivityKeys,
  parseActivityKey,
  type ActivityItem,
  type ActivityKind,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { checkId } from './ids.ts';
import { inputInvalid, refuse } from './refusals.ts';
import type { Actor, EngineScope } from './scope.ts';
import { inWorkspace } from '../access/run.ts';
import { isOpen } from '../access/policy.ts';
import {
  attributeVisible,
  checkObject,
  checkRecordVisible,
  hidesActors,
  UNKNOWN_RECORD,
} from '../access/visibility.ts';
import { linkSource, toMillis, valueSource } from './activity-sources.ts';
import { isArchivedNow, loadAttributes, type AttributeDef } from './values.ts';
import { meetingSource } from '../calendar/activity.ts';
import { noteSource } from '../notes/activity.ts';
import { taskSource } from '../tasks/activity.ts';
import { commentSource } from '../comments/activity.ts';
import { submissionSource } from '../forms/activity.ts';

/** What a cursor the server can't read answers, on the `cursor` field. */
export const ACTIVITY_CURSOR_MESSAGE = 'That activity cursor is not valid here. Start again from the top.';

/** A record's timeline: from the newest entry, or after `cursor` (the last page's `nextCursor`). */
export interface ActivityQuery {
  readonly recordId: string;
  readonly cursor?: string;
  /** Only these kinds; every kind when absent. */
  readonly kinds?: readonly ActivityKind[];
  /** 1 to 50; 50 when not given. */
  readonly limit?: number;
}

/** A page of the timeline, newest first, and the cursor for the next when there are more. */
export interface ActivityPage {
  readonly entries: readonly ActivityItem[];
  readonly nextCursor?: string;
}

/** The record a timeline is about, as the record check read it. */
export interface ActivityRecord {
  readonly id: string;
  readonly objectId: string;
  /** Its creation moment, ISO in UTC with microseconds. */
  readonly createdAt: string;
  /** Who made it; absent when a field rule hides the object's Created by from the viewer. */
  readonly createdBy?: Actor;
  /**
   * A field rule hides the object's Created by or Updated by from the viewer:
   * the changes and link entries name nobody, since the newest change's actor
   * is the record's Updated by, and a create's own entries its Created by.
   */
  readonly hidesActors: boolean;
  /** While it is in the trash: when it moved there (microseconds), and who moved it unless actors are hidden. */
  readonly deleted?: { readonly at: string; readonly by?: Actor };
}

/** Where the last page ended: its last entry's moment (with microseconds), rank and id. */
export type ActivityBound = ActivityCursor;

/**
 * What a source reads with: the read's transaction and scope, the checked
 * record, the attributes the timeline may name, the bound and the page size.
 */
export interface ActivitySourceInput {
  readonly tx: WorkspaceTx;
  readonly scope: EngineScope;
  readonly record: ActivityRecord;
  /**
   * The record's object's attributes a timeline reads: live (not archived,
   * nor a reference to an archived object), not system, and visible to the
   * viewer. #16's computed attributes will be left out here too.
   */
  readonly attributes: readonly AttributeDef[];
  readonly after?: ActivityBound;
  readonly limit: number;
  /** The kinds the page was asked for, when it was filtered: a source answering several reads only those. */
  readonly kinds?: readonly ActivityKind[];
}

/**
 * What a source answers: its newest entries past the bound, at most
 * `limit + 1`, in key order (`compareActivityKeys`), each entry's `key`
 * `<at with microseconds>|<rank>|<id>`. A source that stopped reading before
 * it was done (a run of history with nothing to show, read in bounded steps)
 * says where in `stoppedAt`: the page then ends there, and the next page
 * goes on from it, so no read is unbounded and nothing is skipped.
 */
export interface ActivitySourceAnswer {
  readonly entries: readonly ActivityItem[];
  readonly stoppedAt?: ActivityBound;
}

/** One source of entries (`ActivitySourceAnswer`). */
export type ActivitySource = (input: ActivitySourceInput) => Promise<ActivitySourceAnswer>;

/** Whether an entry with these key parts comes after the bound, in the timeline's order. */
export function isPastBound(
  entry: { readonly at: string; readonly rank: number; readonly id: string },
  after?: ActivityBound,
) {
  if (after === undefined) return true;
  if (entry.at !== after.at) return entry.at < after.at;
  if (entry.rank !== after.rank) return entry.rank > after.rank;
  return entry.id > after.id;
}

/** The creation entry (`created`, rank 9): the record's own row, exactly one, the oldest. */
const creationSource: ActivitySource = ({ record, after }) => {
  const id = `created:${record.id}`;
  const parts = { at: record.createdAt, rank: ACTIVITY_RANKS.created, id };
  if (!isPastBound(parts, after)) return Promise.resolve({ entries: [] });
  return Promise.resolve({
    entries: [
      {
        id,
        key: activityKey(parts),
        at: toMillis(record.createdAt),
        ...(record.createdBy === undefined ? {} : { actor: record.createdBy }),
        kind: 'created',
      },
    ],
  });
};

/**
 * The trash entry (`deleted`, rank 8): while the record is in the trash, the
 * moment it moved there and who moved it. A restore clears the record's
 * delete columns, so a restored record shows none (its history of moves isn't
 * kept: that needs columns of its own).
 */
const deletionSource: ActivitySource = ({ record, after }) => {
  const deleted = record.deleted;
  if (deleted === undefined) return Promise.resolve({ entries: [] });
  const id = `deleted:${record.id}`;
  const parts = { at: deleted.at, rank: ACTIVITY_RANKS.deleted, id };
  if (!isPastBound(parts, after)) return Promise.resolve({ entries: [] });
  return Promise.resolve({
    entries: [
      {
        id,
        key: activityKey(parts),
        at: toMillis(deleted.at),
        ...(deleted.by === undefined ? {} : { actor: deleted.by }),
        kind: 'deleted',
      },
    ],
  });
};

/** The timeline's sources, read in this order and merged by key. #19, #29, spec 0024 and spec 0023 add theirs here. */
export const ACTIVITY_SOURCES: readonly ActivitySource[] = [
  creationSource,
  valueSource,
  linkSource,
  commentSource,
  noteSource,
  taskSource,
  meetingSource,
  submissionSource,
  deletionSource,
];

/** The kinds each source answers, so a filter reads only the sources it shows. */
const SOURCE_KINDS: ReadonlyMap<ActivitySource, readonly ActivityKind[]> = new Map([
  [creationSource, ['created']],
  [valueSource, ['change']],
  [linkSource, ['change', 'links']],
  [commentSource, ['comment']],
  [noteSource, ['note', 'call', 'logged_meeting']],
  [taskSource, ['task']],
  [meetingSource, ['meeting']],
  [submissionSource, ['submission']],
  [deletionSource, ['deleted']],
]);

/** The sources a filter reads: every one without one, else those answering a kind it names. */
export function sourcesFor(kinds?: readonly ActivityKind[]): readonly ActivitySource[] {
  if (kinds === undefined) return ACTIVITY_SOURCES;
  const wanted = new Set(kinds);
  return ACTIVITY_SOURCES.filter((source) => (SOURCE_KINDS.get(source) ?? []).some((kind) => wanted.has(kind)));
}

/** Encodes where a page ended as the opaque cursor: base64url JSON. */
export function encodeActivityCursor(bound: ActivityBound): string {
  return Buffer.from(JSON.stringify(bound)).toString('base64url');
}

/** Decodes a cursor, refusing anything that isn't one of ours (400 `INPUT_INVALID` on `cursor`). */
export function decodeActivityCursor(cursor: string): ActivityBound {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw inputInvalid('cursor', ACTIVITY_CURSOR_MESSAGE);
  }
  const bound = ActivityCursor.safeParse(parsed);
  if (!bound.success) throw inputInvalid('cursor', ACTIVITY_CURSOR_MESSAGE);
  return bound.data;
}

/** The record check row: the record whatever its state, its creation with microseconds, and its object's state. */
interface CheckedRow extends Record<string, unknown> {
  readonly id: string;
  readonly object_id: string;
  readonly created_at: string;
  readonly created_by_type: Actor['type'];
  readonly created_by_id: string | null;
  readonly deleted_at: string | null;
  readonly deleted_by_type: Actor['type'] | null;
  readonly deleted_by_id: string | null;
  readonly object_archived: boolean;
}

/**
 * The record check (spec 0017): the record by id, live or in the trash (a
 * trashed record's read only page has its Activity), its object live and
 * visible, and the record inside the viewer's record rule. Otherwise
 * `NOT_FOUND` "That record does not exist.", the same for missing and hidden.
 */
async function checkedRecord(
  tx: WorkspaceTx,
  scope: EngineScope,
  recordId: string,
): Promise<{ readonly record: ActivityRecord; readonly attributes: readonly AttributeDef[] }> {
  const result = await tx.execute<CheckedRow>(sql`
    select r.id::text as id, r.object_id::text as object_id,
      to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
      r.created_by_type, r.created_by_id::text as created_by_id,
      to_char(r.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as deleted_at,
      r.deleted_by_type, r.deleted_by_id::text as deleted_by_id, o.archived_at is not null as object_archived
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid
  `);
  const [row] = result.rows;
  if (row === undefined || row.object_archived) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  await checkObject(tx, scope.access, row.object_id, 'read', UNKNOWN_RECORD);
  await checkRecordVisible(tx, scope.access, { objectId: row.object_id, recordId: row.id });
  const all = [...(await loadAttributes(tx, row.object_id)).values()];
  // Hidden is absent: a field rule hiding the object's Created by leaves the creation entry without its actor,
  // and one hiding Created by or Updated by leaves every change and link entry without theirs.
  const hides = (column: AttributeDef['systemColumn']) =>
    !isOpen(scope.access) &&
    all.some((attribute) => attribute.systemColumn === column && !attributeVisible(scope.access, attribute));
  const hidesCreator = hides('created_by');
  const hidesAll = hidesActors(scope.access, all);
  // Who moved it to the trash reads like Updated by: nobody named while a field rule hides the actors.
  const deleted =
    row.deleted_at === null
      ? undefined
      : {
          at: row.deleted_at,
          ...(hidesAll || row.deleted_by_type === null
            ? {}
            : { by: { type: row.deleted_by_type, id: row.deleted_by_id } }),
        };
  const attributes = all.filter(
    (attribute) => !attribute.isSystem && !isArchivedNow(attribute) && attributeVisible(scope.access, attribute),
  );
  return {
    record: {
      id: row.id,
      objectId: row.object_id,
      createdAt: row.created_at,
      ...(hidesCreator ? {} : { createdBy: { type: row.created_by_type, id: row.created_by_id } }),
      hidesActors: hidesAll,
      ...(deleted === undefined ? {} : { deleted }),
    },
    attributes,
  };
}

/**
 * A page of a record's timeline, newest first (spec 0017, AC-378, AC-380):
 * every source's entries past the cursor, merged by key, the first `limit`
 * kept, and the cursor for the next page when any source had more. A record
 * that is missing or hidden is `NOT_FOUND`; one in the trash the viewer may
 * see is answered. A cursor that doesn't decode is 400 `INPUT_INVALID` on
 * `cursor`. Reads only, under forced row level security.
 */
export async function getActivity(scope: EngineScope, input: ActivityQuery): Promise<ActivityPage> {
  const limit = input.limit ?? ACTIVITY_PAGE;
  if (!Number.isInteger(limit) || limit < 1 || limit > ACTIVITY_PAGE) {
    throw inputInvalid('limit', `Ask for 1 to ${String(ACTIVITY_PAGE)} entries.`);
  }
  const after = input.cursor === undefined ? undefined : decodeActivityCursor(input.cursor);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  return inWorkspace(scope, async (tx) => {
    const { record, attributes } = await checkedRecord(tx, scope, recordId);
    const answered: ActivityItem[] = [];
    // Where the source that stopped soonest stopped: the page can't go past it.
    let stop: string | undefined;
    // One after another: the sources share the read's one transaction.
    for (const source of sourcesFor(input.kinds)) {
      const sourceInput: ActivitySourceInput = {
        tx,
        scope,
        record,
        attributes,
        ...(after === undefined ? {} : { after }),
        limit,
        ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
      };
      const answer = await source(sourceInput);
      answered.push(...answer.entries);
      const stopped = answer.stoppedAt === undefined ? undefined : activityKey(answer.stoppedAt);
      if (stopped !== undefined && (stop === undefined || compareActivityKeys(stopped, stop) < 0)) stop = stopped;
    }
    const found = (
      stop === undefined ? answered : answered.filter((entry) => compareActivityKeys(entry.key, stop) < 0)
    ).sort((a, b) => compareActivityKeys(a.key, b.key));
    const entries = found.slice(0, limit);
    const last = entries.at(-1);
    const bound = last === undefined ? undefined : parseActivityKey(last.key);
    if (found.length > limit && bound !== undefined) return { entries, nextCursor: encodeActivityCursor(bound) };
    // Short of a page because a source stopped early: the next page goes on from where it stopped.
    const stopped = stop === undefined ? undefined : parseActivityKey(stop);
    return stopped === undefined ? { entries } : { entries, nextCursor: encodeActivityCursor(stopped) };
  });
}
