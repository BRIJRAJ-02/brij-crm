// The purge registry (spec 0022, AC-536): every feature's rows that hang off
// records, deleted explicitly before the records themselves whenever records
// are removed for good (the daily purge, Delete forever, an erasure), in the
// same transaction. Foreign keys to `records` restrict, never cascade, so a
// feature that forgets to register here fails the purge loudly in its tests
// instead of leaving rows behind or losing them unseen. Each dependent deletes
// through an index that leads with its record, so a batch of 500 costs index
// lookups. Features add their entry here: notes and task links (#19),
// comments (#29), files (#32, which also starts a light job to delete the
// stored objects, since a transaction can't call the network).
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { uuidArray } from './ids.ts';

/** Rows of a feature that hang off records and must go when a record is removed for good. */
export interface PurgeDependent {
  /** Its name in `RemovedCounts.dependents`: 'task_records', 'notes', 'comments', 'files'. */
  readonly name: string;
  /** Deletes (or detaches) its rows of these records inside the purge's transaction; answers how many. */
  readonly remove: (tx: WorkspaceTx, recordIds: readonly string[]) => Promise<number>;
}

/** Deletes with one statement and answers its row count. */
const removing = (
  name: string,
  statement: (ids: ReturnType<typeof uuidArray>) => ReturnType<typeof sql>,
): PurgeDependent => ({
  name,
  remove: async (tx, recordIds) => (await tx.execute(statement(uuidArray(recordIds)))).rowCount ?? 0,
});

/**
 * Every registered dependent, in the order they run (before values, links,
 * entries and the records). Tasks live on without the records removed for
 * good, their links going (spec 0019, AC-446); meetings too, leaving those
 * records' timelines, an attendee who was one of them unknown again (spec
 * 0024); a form submission keeps its answers, its note of the record going
 * (spec 0023), and so does its main record, held with no foreign key; a
 * booking keeps its time, its person, company and deal (also held with no
 * foreign key) cleared (spec 0025). Frozen: a feature registers here, in the
 * source, never at run time.
 */
export const PURGE_DEPENDENTS: readonly PurgeDependent[] = Object.freeze([
  {
    name: 'task_records',
    // A task losing links this way is marked first: one left with none stays its creator's and assignee's, never
    // turning into everyone's task (late trap #79: a private task linked only to a record others couldn't see).
    remove: async (tx, recordIds) => {
      const ids = uuidArray(recordIds);
      await tx.execute(sql`
        update tasks t set links_purged = true
        where not t.links_purged and t.id in (select l.task_id from task_records l where l.record_id = any(${ids}))
      `);
      return (await tx.execute(sql`delete from task_records where record_id = any(${ids})`)).rowCount ?? 0;
    },
  },
  // The records' notes, deleted ones too, go with them (spec 0019, AC-446); notes' foreign key refuses a removal
  // that skipped this.
  removing('notes', (ids) => sql`delete from notes where record_id = any(${ids})`),
  // The records' comments go with them, their versions and reactions by cascade, and the notifications about them
  // first, since a notification's record has no foreign key action (spec 0038, AC-1160).
  removing('notifications', (ids) => sql`delete from notifications where record_id = any(${ids})`),
  removing('comments', (ids) => sql`delete from comments where record_id = any(${ids})`),
  removing('meeting_records', (ids) => sql`delete from meeting_records where record_id = any(${ids})`),
  removing(
    'meeting_attendees',
    (ids) =>
      sql`update meeting_attendees set person_record_id = null, match = 'unknown' where person_record_id = any(${ids})`,
  ),
  removing('form_submission_records', (ids) => sql`delete from form_submission_records where record_id = any(${ids})`),
  // Held with no foreign key, so nothing refuses a purge that forgot them: cleared here, each through its index.
  removing(
    'form_submissions',
    (ids) => sql`update form_submissions set main_record_id = null where main_record_id = any(${ids})`,
  ),
  removing(
    'bookings_person',
    (ids) => sql`update bookings set person_record_id = null where person_record_id = any(${ids})`,
  ),
  removing(
    'bookings_company',
    (ids) => sql`update bookings set company_record_id = null where company_record_id = any(${ids})`,
  ),
  removing('bookings_deal', (ids) => sql`update bookings set deal_record_id = null where deal_record_id = any(${ids})`),
]);

/**
 * Runs every dependent for the records, in order, and answers each one's
 * count by name (spec 0022, `RemovedCounts.dependents`). Nothing for no records.
 */
export async function removeDependents(
  tx: WorkspaceTx,
  recordIds: readonly string[],
  dependents: readonly PurgeDependent[] = PURGE_DEPENDENTS,
): Promise<Readonly<Record<string, number>>> {
  if (recordIds.length === 0) return {};
  const counts: Record<string, number> = {};
  for (const dependent of dependents) counts[dependent.name] = await dependent.remove(tx, recordIds);
  return counts;
}
