// A record's timeline, built on read (spec 0017, 0017-activity.md): never
// stored, read from the history the engine already keeps. Each source answers
// its newest entries past the cursor, at most `limit + 1`, in key order; the
// service merges them and keeps the first `limit`. Milestone 1 registers the
// creation source only; the value and link sources (milestone 2), notes and
// tasks (#19) and comments (#29) join `ACTIVITY_SOURCES` with the same
// contract, and nothing else changes.
import { sql } from 'drizzle-orm';
import {
  ACTIVITY_PAGE,
  ACTIVITY_RANKS,
  ActivityCursor,
  activityKey,
  compareActivityKeys,
  parseActivityKey,
  type ActivityItem,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { checkId } from './ids.ts';
import { inputInvalid, refuse } from './refusals.ts';
import type { Actor, EngineScope } from './scope.ts';
import { inWorkspace } from '../access/run.ts';
import { checkObject, checkRecordVisible, UNKNOWN_RECORD } from '../access/visibility.ts';

/** What a cursor the server can't read answers, on the `cursor` field. */
export const ACTIVITY_CURSOR_MESSAGE = 'That activity cursor is not valid here. Start again from the top.';

/** A record's timeline: from the newest entry, or after `cursor` (the last page's `nextCursor`). */
export interface ActivityQuery {
  readonly recordId: string;
  readonly cursor?: string;
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
  readonly createdBy: Actor;
}

/** Where the last page ended: its last entry's moment (with microseconds), rank and id. */
export type ActivityBound = ActivityCursor;

/** What a source reads with: the read's transaction and scope, the checked record, the bound and the page size. */
export interface ActivitySourceInput {
  readonly tx: WorkspaceTx;
  readonly scope: EngineScope;
  readonly record: ActivityRecord;
  readonly after?: ActivityBound;
  readonly limit: number;
}

/**
 * One source of entries: its newest entries past `after`, at most
 * `limit + 1`, in key order (`compareActivityKeys`). Each entry's `key` is
 * `<at with microseconds>|<rank>|<id>`.
 */
export type ActivitySource = (input: ActivitySourceInput) => Promise<readonly ActivityItem[]>;

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

/** An instant with microseconds cut to the milliseconds `ActivityItem.at` carries. */
const toMillis = (micros: string): string => `${micros.slice(0, 23)}Z`;

/** The creation entry (`created`, rank 9): the record's own row, exactly one, the oldest. */
const creationSource: ActivitySource = ({ record, after }) => {
  const id = `created:${record.id}`;
  const parts = { at: record.createdAt, rank: ACTIVITY_RANKS.created, id };
  if (!isPastBound(parts, after)) return Promise.resolve([]);
  return Promise.resolve([
    { id, key: activityKey(parts), at: toMillis(record.createdAt), actor: record.createdBy, kind: 'created' },
  ]);
};

/** The timeline's sources, read in this order and merged by key. #19 and #29 add theirs here. */
export const ACTIVITY_SOURCES: readonly ActivitySource[] = [creationSource];

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
  readonly object_archived: boolean;
}

/**
 * The record check (spec 0017): the record by id, live or in the trash (a
 * trashed record's read only page has its Activity), its object live and
 * visible, and the record inside the viewer's record rule. Otherwise
 * `NOT_FOUND` "That record does not exist.", the same for missing and hidden.
 */
async function checkedRecord(tx: WorkspaceTx, scope: EngineScope, recordId: string): Promise<ActivityRecord> {
  const result = await tx.execute<CheckedRow>(sql`
    select r.id::text as id, r.object_id::text as object_id,
      to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
      r.created_by_type, r.created_by_id::text as created_by_id, o.archived_at is not null as object_archived
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid
  `);
  const [row] = result.rows;
  if (row === undefined || row.object_archived) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  await checkObject(tx, scope.access, row.object_id, 'read', UNKNOWN_RECORD);
  await checkRecordVisible(tx, scope.access, { objectId: row.object_id, recordId: row.id });
  return {
    id: row.id,
    objectId: row.object_id,
    createdAt: row.created_at,
    createdBy: { type: row.created_by_type, id: row.created_by_id },
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
    const record = await checkedRecord(tx, scope, recordId);
    const found: ActivityItem[] = [];
    // One after another: the sources share the read's one transaction.
    for (const source of ACTIVITY_SOURCES) {
      for (const entry of await source({ tx, scope, record, ...(after === undefined ? {} : { after }), limit })) {
        found.push(entry);
      }
    }
    found.sort((a, b) => compareActivityKeys(a.key, b.key));
    const entries = found.slice(0, limit);
    const last = entries.at(-1);
    const bound = last === undefined ? undefined : parseActivityKey(last.key);
    if (found.length <= limit || bound === undefined) return { entries };
    return { entries, nextCursor: encodeActivityCursor(bound) };
  });
}
