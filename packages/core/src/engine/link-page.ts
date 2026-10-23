// One side's linked records, a page at a time (spec 0014, milestone 3: the
// record page's related sections, spec 0017 milestone 3). A keyset read in
// the side's own order (its position, then when the link began, then the
// link's id), driven by the current links index of that end, with the exact
// total of the side's live far records the reader may see. Answers display
// shapes only, never record bodies.
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import type { WorkspaceTx } from '@crm/db';
import { LINK_PAGE_MAX, LINK_PREVIEW } from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import { checkId } from './ids.ts';
import { inputInvalid, refuse } from './refusals.ts';
import { endOf, relationshipOf } from './relationships.ts';
import { readRecords } from './records.ts';
import type { EngineScope } from './scope.ts';
import { isArchivedNow, loadAttributes } from './values.ts';
import { inWorkspace } from '../access/run.ts';
import {
  attributeVisible,
  checkObject,
  checkRecordVisible,
  farVisibleSql,
  UNKNOWN_RECORD,
} from '../access/visibility.ts';

/** What naming a side that isn't one of the record's (or that the reader can't see) answers. */
export const UNKNOWN_SIDE = 'That relationship is not on this record.';

/** What a cursor the server can't read here answers, on the `cursor` field. */
export const LINK_CURSOR_MESSAGE = 'That cursor is not valid here. Start again from the top.';

/** Which page of one side to read: from the start, or after `cursor` (the last page's `nextCursor`). */
export interface LinkPageInput {
  readonly recordId: string;
  readonly attributeId: string;
  readonly cursor?: string;
  /** 1 to `LINK_PAGE_MAX`; `LINK_PREVIEW` (20) when left out. */
  readonly limit?: number;
}

/**
 * A page of one side's linked records, in its order, the cursor to the next
 * when there are more, and on the first page the total (a later page leaves
 * it out: counting a hub's 150,000 links again for each Show more would
 * spend the read budget on a number the browser already holds).
 */
export interface LinkPageAnswer {
  readonly items: readonly RecordRefDisplay[];
  readonly nextCursor?: string;
  readonly total?: number;
}

/**
 * Where a page ended: the last link's place in the side's order, bound to
 * the record and side it was read from, so a cursor from another side or
 * record is refused rather than read somewhere it means nothing.
 */
const LinkCursor = z.object({
  r: z.uuid(),
  a: z.uuid(),
  // A link's position is a Postgres integer, and its start a real instant: anything else never reaches SQL.
  p: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  f: z.iso.datetime({ precision: 6 }),
  k: z.uuid(),
});
type LinkCursor = z.infer<typeof LinkCursor>;

/** Encodes where a page ended as the opaque cursor: base64url JSON. */
export function encodeLinkCursor(bound: LinkCursor): string {
  return Buffer.from(JSON.stringify(bound)).toString('base64url');
}

/** Decodes a cursor for this record and side, refusing anything else (400 `INPUT_INVALID` on `cursor`). */
export function decodeLinkCursor(cursor: string, recordId: string, attributeId: string): LinkCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw inputInvalid('cursor', LINK_CURSOR_MESSAGE);
  }
  const bound = LinkCursor.safeParse(parsed);
  if (!bound.success || bound.data.r !== recordId || bound.data.a !== attributeId) {
    throw inputInvalid('cursor', LINK_CURSOR_MESSAGE);
  }
  return bound.data;
}

/** The near record's object, when it is live on a live object; undefined otherwise (missing, trashed, archived). */
async function liveObjectOf(tx: WorkspaceTx, recordId: string): Promise<string | undefined> {
  const found = await tx.execute<{ object_id: string }>(sql`
    select r.object_id::text as object_id
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid and r.deleted_at is null and o.archived_at is null
  `);
  return found.rows[0]?.object_id;
}

/**
 * A page of the records linked on one side of one record (spec 0014, AC-299,
 * AC-304, AC-308): live far records the reader may see, in the side's order,
 * at most `limit`, with the exact total on the first page. A record that is missing, hidden,
 * in the trash (its links come back with a restore) or on an archived object
 * is `NOT_FOUND` with the unknown record's words; a side that isn't a record
 * reference of its object, is hidden from the reader or is archived (its own
 * row, or its far object) is `NOT_FOUND` too. A cursor that isn't this side's
 * is 400 `INPUT_INVALID` on `cursor`. Reads only.
 */
export async function pageLinks(scope: EngineScope, input: LinkPageInput): Promise<LinkPageAnswer> {
  const limit = input.limit ?? LINK_PREVIEW;
  if (!Number.isInteger(limit) || limit < 1 || limit > LINK_PAGE_MAX) {
    throw inputInvalid('limit', `Ask for 1 to ${String(LINK_PAGE_MAX)} records.`);
  }
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  const attributeId = checkId(input.attributeId, UNKNOWN_SIDE);
  const after = input.cursor === undefined ? undefined : decodeLinkCursor(input.cursor, recordId, attributeId);
  return inWorkspace(scope, async (tx) => {
    const objectId = await liveObjectOf(tx, recordId);
    if (objectId === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
    await checkObject(tx, scope.access, objectId, 'read', UNKNOWN_RECORD);
    await checkRecordVisible(tx, scope.access, { objectId, recordId });
    const attribute = (await loadAttributes(tx, objectId)).get(attributeId);
    if (
      attribute?.type !== 'record_reference' ||
      attribute.relationshipId === null ||
      isArchivedNow(attribute) ||
      !attributeVisible(scope.access, attribute)
    ) {
      throw refuse('NOT_FOUND', UNKNOWN_SIDE);
    }
    const relationship = await relationshipOf(tx, attribute);
    const end = endOf(relationship, attribute.id);
    // Fixed column names for this end, never input.
    const mine = sql.raw(end.isFrom ? 'k.from_record_id' : 'k.to_record_id');
    const far = sql.raw(end.isFrom ? 'k.to_record_id' : 'k.from_record_id');
    const position = sql.raw(end.isFrom ? 'k.position' : 'k.to_position');
    const farVisible = farVisibleSql(scope.access, end.allowed, 'r');
    const links = sql`
      from record_links k
      join records r on r.workspace_id = k.workspace_id and r.id = ${far} and r.deleted_at is null${
        farVisible === undefined ? sql`` : sql` and ${farVisible}`
      }
      where k.relationship_id = ${relationship.id}::uuid and ${mine} = ${recordId}::uuid and k.active_until is null
    `;
    const past =
      after === undefined
        ? sql``
        : sql` and (${position}, k.active_from, k.id) > (${after.p}, ${after.f}::timestamptz, ${after.k}::uuid)`;
    // One more than the page, so a page that isn't the last is known to be followed.
    const rows = await tx.execute<{ record_id: string; p: number; f: string; kid: string }>(sql`
      select r.id::text as record_id, ${position} as p,
        to_char(k.active_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as f, k.id::text as kid
      ${links}${past}
      order by ${position}, k.active_from, k.id
      limit ${limit + 1}
    `);
    const page = rows.rows.slice(0, limit);
    // The first page only, and only when the side holds more than it: otherwise its rows are the whole side.
    const total =
      after !== undefined
        ? undefined
        : rows.rows.length <= limit
          ? page.length
          : ((await tx.execute<{ n: number }>(sql`select count(*)::int as n ${links}`)).rows[0]?.n ?? 0);
    // Every far record came from a statement that kept only records the reader may see.
    const views = await readRecords(
      tx,
      scope.access,
      page.map((row) => row.record_id),
      { attributeIds: [], visibleAlready: true },
    );
    const display = new Map(views.map((view) => [view.id, view.display]));
    const items = page.flatMap((row) => {
      const shown = display.get(row.record_id);
      return shown === undefined ? [] : [shown];
    });
    const last = page.at(-1);
    const counted = total === undefined ? {} : { total };
    if (rows.rows.length <= limit || last === undefined) return { items, ...counted };
    return {
      items,
      ...counted,
      nextCursor: encodeLinkCursor({ r: recordId, a: attributeId, p: last.p, f: last.f, k: last.kid }),
    };
  });
}
