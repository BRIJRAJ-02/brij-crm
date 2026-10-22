// A booking links the person and company its guest was filed as, and the
// record its member linked it to by hand (a deal, or another object's record,
// polish F2). Those are records like any other, so a reader learns of one only
// if the access door lets them see it: hidden means absent, even as a bare id
// on a booking. A hand linked record in the trash, or on an archived object,
// is absent too, and comes back with its restore.
import { sql } from 'drizzle-orm';
import type { RecordRefDisplay } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { isOpen, type Access } from '../access/policy.ts';
import { visibleRecords } from '../access/visibility.ts';
import { uuidList } from '../engine/ids.ts';
import { readRecords } from '../engine/records.ts';

/** A booking row's links, as stored. */
export interface BookingLinks {
  readonly personRecordId: string | null;
  readonly companyRecordId: string | null;
}

/** The linked record ids among `rows` the reader may see. */
export async function seenLinks(
  tx: WorkspaceTx,
  access: Access,
  rows: readonly BookingLinks[],
): Promise<ReadonlySet<string>> {
  const ids = [
    ...new Set(rows.flatMap((row) => [row.personRecordId, row.companyRecordId].filter((id) => id !== null))),
  ];
  if (ids.length === 0) return new Set();
  if (isOpen(access)) return new Set(ids);
  const found = await tx.execute<{ id: string; object_id: string }>(
    sql`select r.id::text as id, r.object_id::text as object_id from records r where r.id = any(${uuidList(ids)})`,
  );
  return visibleRecords(
    tx,
    access,
    found.rows.map((row) => ({ objectId: row.object_id, recordId: row.id })),
  );
}

/** A booking's links the reader may see, as the views spread them. */
export function linksOf(
  row: BookingLinks,
  seen: ReadonlySet<string>,
): { readonly personRecordId?: string; readonly companyRecordId?: string } {
  return {
    ...(row.personRecordId === null || !seen.has(row.personRecordId) ? {} : { personRecordId: row.personRecordId }),
    ...(row.companyRecordId === null || !seen.has(row.companyRecordId) ? {} : { companyRecordId: row.companyRecordId }),
  };
}

/** The record a booking row was linked to by hand, as stored (`deal_record_id`). */
export interface HandLink {
  readonly dealRecordId: string | null;
}

/**
 * The hand linked records among `rows` the reader may see, live on a live object, as chips show them, by id: one
 * statement for the live ones and one read of their displays (which keeps only what the reader may see), however
 * many rows.
 */
export async function linkedRecords(
  tx: WorkspaceTx,
  access: Access,
  rows: readonly HandLink[],
): Promise<ReadonlyMap<string, RecordRefDisplay>> {
  const ids = [...new Set(rows.flatMap((row) => (row.dealRecordId === null ? [] : [row.dealRecordId])))];
  if (ids.length === 0) return new Map();
  const live = await tx.execute<{ id: string }>(sql`
    select r.id::text as id from records r
    join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = any(${uuidList(ids)}) and r.deleted_at is null and o.archived_at is null
  `);
  const views = await readRecords(
    tx,
    access,
    live.rows.map((row) => row.id),
    { attributeIds: [] },
  );
  return new Map(views.map((view) => [view.id, view.display]));
}

/** A booking's hand linked record the reader may see, as the views spread it. */
export function handLinkOf(
  row: HandLink,
  linked: ReadonlyMap<string, RecordRefDisplay>,
): { readonly linkedRecord?: RecordRefDisplay } {
  const display = row.dealRecordId === null ? undefined : linked.get(row.dealRecordId);
  return display === undefined ? {} : { linkedRecord: display };
}
