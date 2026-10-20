// A booking links the person and company its guest was filed as. Those are
// records like any other, so a reader learns of one only if the access door
// lets them see it: hidden means absent, even as a bare id on a booking.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { isOpen, type Access } from '../access/policy.ts';
import { visibleRecords } from '../access/visibility.ts';
import { uuidList } from '../engine/ids.ts';

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
