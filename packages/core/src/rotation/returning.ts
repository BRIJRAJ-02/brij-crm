// Where a returning guest goes (spec 0029, AC-739; spec 0037, AC-1328): the
// owner of the person their email names, and the host they met last on a page
// using the rotation. Both are read inside the booking's transaction, under
// the rotation's lock, and only ever choose among the members already free;
// nothing here reaches the visitor.
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';

/** How far back the host a guest met last is looked for (spec 0037's Numbers: 180 days). */
export const LAST_HOST_DAYS = 180;

/** The member who owns the live person holding this email on People, if any (AC-739). */
export async function ownerOfEmail(
  tx: WorkspaceTx,
  peopleObjectId: string,
  email: string,
): Promise<string | undefined> {
  const found = await tx.execute<{ member_id: string }>(sql`
    select o.actor_member_id::text as member_id
    from "values" e
    join attributes ea on ea.id = e.attribute_id and ea.object_id = ${peopleObjectId}::uuid
      and ea.api_slug = 'email_addresses'
    join records r on r.workspace_id = e.workspace_id and r.id = e.record_id and r.deleted_at is null
    join attributes oa on oa.workspace_id = e.workspace_id and oa.object_id = ${peopleObjectId}::uuid
      and oa.api_slug = 'owner' and oa.archived_at is null
    join "values" o on o.workspace_id = e.workspace_id and o.record_id = e.record_id and o.attribute_id = oa.id
      and o.active_until is null and o.actor_type = 'member'
    where e.unique_key = ${email} and e.active_until is null
    limit 1
  `);
  return found.rows[0]?.member_id;
}

/**
 * The member this rotation gave the guest's most recent confirmed booking to,
 * on any page, within the last 180 days (AC-1328), matched by email.
 */
export async function lastHostOf(
  tx: WorkspaceTx,
  rotationId: string,
  email: string,
  now: Date,
): Promise<string | undefined> {
  const found = await tx.execute<{ member_id: string }>(sql`
    select a.member_id::text as member_id
    from rotation_assignments a
    join bookings b on b.workspace_id = a.workspace_id and b.id = a.booking_id
    where a.rotation_id = ${rotationId}::uuid and a.voided_at is null and a.source = 'booking'
      and a.assigned_at >= ${now.toISOString()}::timestamptz - make_interval(days => ${LAST_HOST_DAYS})
      and b.visitor_email = ${email} and b.status = 'confirmed'
    order by b.starts_at desc, a.assigned_at desc
    limit 1
  `);
  return found.rows[0]?.member_id;
}
