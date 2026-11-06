// Whether a salon or clinic can take its first booking (spec 0066 B1; spec 0068, Foolproof): the facts Settings ›
// Services' setup checklist shows and the business page's Publish refuses on. Read in the caller's transaction, three
// `exists` over workspace led indexes, so it costs the same at 5 services or 500.
import { hasWeeklyHours, type AppointmentsSetup, type PlaceHoursShape } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';

/** Whether an online service has someone to do it, and whether that someone has weekly shifts where it is offered. */
export interface AppointmentsReadiness {
  readonly hasService: boolean;
  readonly hasStaff: boolean;
  readonly hasShifts: boolean;
}

/** A live, online, one client service with a live variant, offered at a place. */
const BOOKABLE = sql`
  s.archived_at is null and s.online and s.capacity_mode = 'one'
  and exists (select 1 from service_variants v where v.workspace_id = s.workspace_id and v.service_id = s.id and v.archived_at is null)
`;

/** Someone (live) who does service `s` at place `sp`, working there (`stp`). */
const DOES = sql`
  st.archived_at is null and (s.staff_rule = 'all' or exists (
    select 1 from service_staff ss where ss.workspace_id = s.workspace_id and ss.service_id = s.id and ss.staff_id = st.id
  ))
`;

/** A shifts document with at least one weekly range. */
const HAS_SHIFTS = sql`exists (
  select 1 from jsonb_each(case when jsonb_typeof(stp.shifts->'weekly') = 'object' then stp.shifts->'weekly' else '{}'::jsonb end) d
  where jsonb_typeof(d.value) = 'array' and jsonb_array_length(d.value) > 0
)`;

/** The three facts, in one statement. */
export async function appointmentsReadiness(tx: WorkspaceTx): Promise<AppointmentsReadiness> {
  const [row] = (
    await tx.execute<{ service: boolean; staff: boolean; shifts: boolean }>(sql`
      select
        exists (
          select 1 from services s join service_places sp on sp.workspace_id = s.workspace_id and sp.service_id = s.id
          where ${BOOKABLE}
        ) as service,
        exists (
          select 1 from services s
          join service_places sp on sp.workspace_id = s.workspace_id and sp.service_id = s.id
          join staff_places stp on stp.workspace_id = sp.workspace_id and stp.place_id = sp.place_id
          join staff st on st.workspace_id = stp.workspace_id and st.id = stp.staff_id
          where ${BOOKABLE} and ${DOES}
        ) as staff,
        exists (
          select 1 from services s
          join service_places sp on sp.workspace_id = s.workspace_id and sp.service_id = s.id
          join staff_places stp on stp.workspace_id = sp.workspace_id and stp.place_id = sp.place_id
          join staff st on st.workspace_id = stp.workspace_id and st.id = stp.staff_id
          where ${BOOKABLE} and ${DOES} and ${HAS_SHIFTS}
        ) as shifts
    `)
  ).rows;
  return { hasService: row?.service === true, hasStaff: row?.staff === true, hasShifts: row?.shifts === true };
}

/**
 * The setup checklist (spec 0068, Foolproof): the business and a place, every place's hours, a bookable service,
 * someone to do it, their shifts, then the business page published. One step's place is named when it is one place's.
 */
export async function appointmentsSetup(
  tx: WorkspaceTx,
  places: readonly { readonly id: string; readonly hours: PlaceHoursShape }[],
): Promise<AppointmentsSetup> {
  const ready = await appointmentsReadiness(tx);
  const [facts] = (
    await tx.execute<{ profile: boolean; published: boolean }>(sql`
      select exists (select 1 from properties where name is not null) as profile,
        exists (select 1 from business_pages where published_at is not null) as published
    `)
  ).rows;
  const noHours = places.find((place) => !hasWeeklyHours(place.hours));
  return {
    steps: [
      { id: 'business', done: facts?.profile === true && places.length > 0 },
      {
        id: 'hours',
        done: places.length > 0 && noHours === undefined,
        ...(noHours === undefined ? {} : { placeId: noHours.id }),
      },
      { id: 'service', done: ready.hasService },
      { id: 'staff', done: ready.hasStaff },
      { id: 'shifts', done: ready.hasShifts },
      { id: 'publish', done: facts?.published === true },
    ],
  };
}
