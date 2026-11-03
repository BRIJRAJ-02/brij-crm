// One person, two engines (spec 0066, AC-6606; Rules settled: Meeting side busy). A staff profile linked to a member
// is that member: their appointment holds block meeting slots. `computeSlots` stays pure; this one loader adds the
// holds to every place that loads member busy today, through `memberBookings` (so `bookedSpans`, `readTeam` and with
// them the public slots, a booking's recheck, a move, round robin's `chooseHosts` and a reseat, routing's free time
// and managed pages) and the Team day's busy items.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import { uuidList } from '../engine/ids.ts';

/** One live appointment hold of a linked member, as busy. */
export interface AppointmentSpan {
  readonly memberId: string;
  readonly start: Date;
  readonly end: Date;
}

/**
 * Every live hold of the staff profiles linked to `memberIds` touching [from, to), one query (`staff_member` then
 * `appointment_holds_by_staff`). Ids and times only: what a meeting screen may show of a client visit is "busy".
 */
export async function appointmentSpans(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  from: Date,
  to: Date,
): Promise<readonly AppointmentSpan[]> {
  if (memberIds.length === 0) return [];
  const rows = await tx.execute<{ member_id: string; starts_at: string; ends_at: string }>(sql`
    select s.member_id::text as member_id, h.starts_at, h.ends_at
    from staff s
    join appointment_holds h on h.workspace_id = s.workspace_id and h.staff_id = s.id and h.live
    where s.member_id = any(${uuidList([...new Set(memberIds)])})
      and h.starts_at < ${to.toISOString()}::timestamptz and h.ends_at > ${from.toISOString()}::timestamptz
    order by h.starts_at
  `);
  return rows.rows.map((row) => ({
    memberId: row.member_id,
    start: new Date(row.starts_at),
    end: new Date(row.ends_at),
  }));
}
