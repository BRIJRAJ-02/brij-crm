// Settings › Staff and Settings › Shifts (spec 0066 B1, AC-6611 to AC-6613): staff profiles that never sign in unless
// linked to a member, where they work, what they do, and when: a weekly pattern per place with date overrides (one
// `PlaceHours` document, written whole, so copying a week to every week saves all seven days in one write), time off
// and blocked time. Profiles are `services.manage`'s; shifts, time off and blocks `services.calendar`'s (the front
// desk sets the rota without editing the catalogue). Linked staff use their member's own time off and calendar (one
// source): their `staff_time_off` and `staff_blocks` are refused. Every write is audited and stores one `visits` event
// naming the places it touched, and purges those places' offered times.
import {
  CATALOGUE_LIMITS,
  HOSPITALITY_LIMITS,
  hoursProblem,
  VISIT_LIMITS,
  type Hue,
  type PlaceHours,
  type StaffFields,
  type StaffView,
  type StaffTeamView,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { auditSetup, hospitalityMember, requireApp } from '../hospitality/gate.ts';
import type { CatalogueDeps } from './catalogue.ts';
import {
  ALL_REACH,
  PLACE_OUT_OF_REACH,
  propertyReachSql,
  reachesPlace,
  reachOf,
  type Reach,
} from '../hospitality/reach.ts';
import { readServicePlaces } from './catalogue.ts';

/** The refusal for a change to a staff profile by someone who works in only some businesses or places. */
const STAFF_WHOLE_WORKSPACE = 'Staff profiles work across every business. Ask an admin to change this one.';
import { personLockKeys } from './locks.ts';
import { linkStaffMember } from './staff-link.ts';

const L = CATALOGUE_LIMITS;

/** The refusal for a staff member who isn't there. */
export const STAFF_MISSING = 'That staff member doesn’t exist.';
/** The refusal for time off or a block of a linked staff member: theirs live in Availability. */
export const LINKED_TIME = 'Their time off comes from their own Availability, as a member of the workspace.';

/** The live services a profile does: all-staff ones, and those that chose them. */
const DOES = sql`
  select s.id::text from services s
  where s.archived_at is null and s.capacity_mode = 'one'
    and (s.staff_rule = 'all' or (s.staff_rule = 'chosen' and exists (
      select 1 from service_staff ss where ss.workspace_id = s.workspace_id and ss.service_id = s.id and ss.staff_id = st.id
    )))
`;

/** The team as the screens show it, read in the caller's transaction; the members list only for `services.manage`. */
export async function readTeam(tx: WorkspaceTx, canManage: boolean, reach: Reach = ALL_REACH): Promise<StaffTeamView> {
  const staff = (
    await tx.execute<{
      id: string;
      name: string;
      title: string | null;
      bio: string | null;
      color: Hue | null;
      photo_path: string | null;
      member_id: string | null;
      member_name: string | null;
      archived: boolean;
      service_ids: string[] | null;
      upcoming: number;
    }>(sql`
      select st.id::text, st.name, st.title, st.bio, st.color, st.photo_path, st.member_id::text, m.name as member_name,
        st.archived_at is not null as archived, array(${DOES} order by s.position, s.id) as service_ids,
        (select count(distinct h.appointment_id)::int from appointment_holds h
          where h.workspace_id = st.workspace_id and h.staff_id = st.id and h.live and h.ends_at > now()) as upcoming
      from staff st left join members m on m.workspace_id = st.workspace_id and m.id = st.member_id
      order by st.position, st.id
    `)
  ).rows;
  const works = (
    await tx.execute<{ staff_id: string; place_id: string; shifts: PlaceHours; outside_hours: boolean }>(sql`
      select sp.staff_id::text, sp.place_id::text, sp.shifts, sp.outside_hours
      from staff_places sp join places p on p.workspace_id = sp.workspace_id and p.id = sp.place_id
      order by p.position, p.id
    `)
  ).rows;
  // Time off and blocks from a month back (the shifts grid's last weeks) onwards, at most 2,000 of each.
  const timeOff = (
    await tx.execute<{
      id: string;
      staff_id: string;
      place_id: string | null;
      starts_at: string;
      ends_at: string;
      reason: StaffView['timeOff'][number]['reason'];
    }>(sql`
      select id::text, staff_id::text, place_id::text, starts_at, ends_at, reason from staff_time_off
      where ends_at > now() - interval '35 days' order by starts_at limit 2000
    `)
  ).rows;
  const blocks = (
    await tx.execute<{
      id: string;
      staff_id: string;
      place_id: string;
      starts_at: string;
      ends_at: string;
      reason: string | null;
    }>(sql`
      select id::text, staff_id::text, place_id::text, starts_at, ends_at, reason from staff_blocks
      where ends_at > now() - interval '35 days' order by starts_at limit 2000
    `)
  ).rows;
  // Services and categories of the businesses the reader sees only (AC-6596).
  const seenBusiness = propertyReachSql(reach, sql`property_id`) ?? sql`true`;
  const services = (
    await tx.execute<{ id: string; name: string; category_id: string | null; staff_rule: 'all' | 'chosen' }>(sql`
      select id::text, name, category_id::text, staff_rule from services
      where archived_at is null and capacity_mode = 'one' and staff_rule <> 'none' and ${seenBusiness}
      order by position, id
    `)
  ).rows;
  const categories = (
    await tx.execute<{ id: string; name: string }>(
      sql`select id::text, name from service_categories where ${seenBusiness} order by position, id`,
    )
  ).rows;
  const members = canManage
    ? (
        await tx.execute<{ id: string; name: string; staff_id: string | null }>(sql`
          select m.id::text, m.name, (select st.id::text from staff st where st.workspace_id = m.workspace_id and st.member_id = m.id)
            as staff_id
          from members m where m.status = 'active' order by m.name, m.id
        `)
      ).rows
    : undefined;
  const iso = (value: string) => new Date(value).toISOString();
  // A member with limited reach (spec 0065 H7, AC-6596) sees the staff who work in a place they reach, and only those
  // places' shifts, time off and blocks; time off at every place (no place) stays.
  const inReach = (placeId: string | null) => placeId === null || reachesPlace(reach, placeId);
  const reachedStaff = reach.all
    ? staff
    : staff.filter((row) => works.some((each) => each.staff_id === row.id && reachesPlace(reach, each.place_id)));
  return {
    staff: reachedStaff.map((row): StaffView => ({
      id: row.id,
      name: row.name,
      ...(row.title === null ? {} : { title: row.title }),
      ...(row.bio === null ? {} : { bio: row.bio }),
      ...(row.color === null ? {} : { color: row.color }),
      // The photo's version is the tail of its stored path (a new upload, a new path), never the path itself.
      ...(row.photo_path === null ? {} : { photo: row.photo_path.split('/').pop()?.split('.')[0] ?? 'photo' }),
      ...(row.member_id === null ? {} : { memberId: row.member_id }),
      ...(row.member_name === null ? {} : { memberName: row.member_name }),
      archived: row.archived,
      places: works
        .filter((each) => each.staff_id === row.id && inReach(each.place_id))
        .map((each) => ({ placeId: each.place_id, shifts: each.shifts, outsideHours: each.outside_hours })),
      serviceIds: row.service_ids ?? [],
      timeOff: timeOff
        .filter((each) => each.staff_id === row.id && inReach(each.place_id))
        .map((each) => ({
          id: each.id,
          ...(each.place_id === null ? {} : { placeId: each.place_id }),
          start: iso(each.starts_at),
          end: iso(each.ends_at),
          reason: each.reason,
        })),
      blocks: blocks
        .filter((each) => each.staff_id === row.id && inReach(each.place_id))
        .map((each) => ({
          id: each.id,
          placeId: each.place_id,
          start: iso(each.starts_at),
          end: iso(each.ends_at),
          ...(each.reason === null ? {} : { reason: each.reason }),
        })),
      upcoming: row.upcoming,
    })),
    places: await readServicePlaces(tx, undefined, reach),
    services: services.map((row) => ({
      id: row.id,
      name: row.name,
      ...(row.category_id === null ? {} : { categoryId: row.category_id }),
      staffRule: row.staff_rule,
    })),
    categories,
    ...(members === undefined
      ? {}
      : {
          members: members.map((row) => ({
            id: row.id,
            name: row.name,
            ...(row.staff_id === null ? {} : { staffId: row.staff_id }),
          })),
        }),
    canManage,
  };
}

/** Settings › Staff: every profile, the places and services they may be given, and the members to link. */
export async function getTeam(scope: EngineScope): Promise<StaffTeamView> {
  requirePermission(scope, 'services.manage');
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'appointments');
    return readTeam(tx, true, await reachOf(tx, scope));
  });
}

/** Settings › Shifts: the same team for `services.calendar` (no members list unless they also manage). */
export async function getShifts(scope: EngineScope): Promise<StaffTeamView> {
  requirePermission(scope, 'services.calendar');
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'appointments');
    return readTeam(tx, can(scope.access, 'services.manage'), await reachOf(tx, scope));
  });
}

/** The places a staff member works at now. */
async function placesOf(tx: WorkspaceTx, staffId: string): Promise<string[]> {
  return (
    await tx.execute<{ place_id: string }>(
      sql`select place_id::text from staff_places where staff_id = ${staffId}::uuid`,
    )
  ).rows.map((row) => row.place_id);
}

/** A live staff row, locked for the write, or NOT_FOUND. */
async function lockedStaff(
  tx: WorkspaceTx,
  staffId: string,
  archived = false,
): Promise<{ readonly name: string; readonly member_id: string | null }> {
  const [row] = (
    await tx.execute<{ name: string; member_id: string | null }>(sql`
      select name, member_id::text from staff where id = ${staffId}::uuid and (archived_at is not null) = ${archived}
      for no key update
    `)
  ).rows;
  if (row === undefined) throw refuse('NOT_FOUND', STAFF_MISSING);
  return row;
}

/**
 * Runs one team write: the permission, the member, the app, the work, its audit line, one `visits` event naming the
 * places it touched, and their offered times purged once it commits. Answers the team as it now stands.
 */
async function teamWrite(
  scope: EngineScope,
  permission: 'services.manage' | 'services.calendar',
  deps: CatalogueDeps,
  hooks: readonly AfterWrite[],
  what: string,
  work: (
    context: WriteContext,
    by: string,
  ) => Promise<{ readonly places: readonly string[]; readonly ids?: Record<string, string> }>,
): Promise<StaffTeamView> {
  requirePermission(scope, permission);
  const by = hospitalityMember(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await requireApp(tx, scope.workspaceId, 'appointments');
      // Staff are the workspace's, working across businesses (spec 0065 H7): a profile changes only for someone who
      // reaches every business, and a shift, time off or block only in places the member reaches (AC-6595).
      const reach = await reachOf(tx, scope);
      if (!reach.all && permission === 'services.manage') throw refuse('FORBIDDEN', STAFF_WHOLE_WORKSPACE);
      await lockKey(tx, `staff:${scope.workspaceId}`);
      const done = await work(context, by);
      if (done.places.some((placeId) => !reachesPlace(reach, placeId))) {
        throw refuse('NOT_FOUND', PLACE_OUT_OF_REACH);
      }
      await auditSetup(tx, scope, what, done.ids ?? {});
      if (done.places.length > 0) context.record({ visits: [...done.places] });
      return { view: await readTeam(tx, can(scope.access, 'services.manage'), reach), places: done.places };
    },
    hooks,
  );
  for (const placeId of result.places) deps.slotCache?.purge(placeId);
  return result.view;
}

/** A place's opening week as a first shift pattern: a new staff member works the hours the place opens. */
async function placeWeek(tx: WorkspaceTx, placeId: string): Promise<PlaceHours> {
  const [row] = (await tx.execute<{ hours: PlaceHours }>(sql`select hours from places where id = ${placeId}::uuid`))
    .rows;
  return { weekly: row?.hours.weekly ?? {}, exceptions: [] };
}

/**
 * Adds a staff profile or changes one (AC-6611): name, title, bio, colour, the places they work at (a new place starts
 * with its opening hours as their shifts) and every service they do. Leaving out a service every staff member did turns
 * it to the chosen staff (everyone else), so nobody else loses it. Up to 300 profiles and 60 at a place.
 */
export async function saveStaff(
  scope: EngineScope,
  input: { readonly id: string; readonly staff: StaffFields },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.id, STAFF_MISSING);
  const fields = input.staff;
  const placeIds = [...new Set(fields.placeIds.map((each) => checkId(each, 'That place doesn’t exist.')))];
  const serviceIds = new Set(fields.serviceIds.map((each) => checkId(each, 'That service doesn’t exist.')));
  const blank = (value: string | undefined) => (value === undefined || value.trim() === '' ? null : value.trim());
  return teamWrite(scope, 'services.manage', deps, hooks, 'staff.saved', async ({ tx }, by) => {
    const [found] = (
      await tx.execute<{ archived: boolean }>(sql`
        select archived_at is not null as archived from staff where id = ${id}::uuid for no key update
      `)
    ).rows;
    if (found?.archived === true) throw refuse('NOT_FOUND', STAFF_MISSING);
    const known = (
      await tx.execute<{ id: string }>(
        sql`select id::text from places where id = any(${`{${placeIds.join(',')}}`}::uuid[])`,
      )
    ).rows;
    if (known.length !== placeIds.length) throw inputInvalid('placeIds', 'One of those places doesn’t exist.');
    const before = found === undefined ? [] : await placesOf(tx, id);
    if (found === undefined) {
      const [counted] = (
        await tx.execute<{ n: number; next: number }>(sql`
          select count(*) filter (where archived_at is null)::int as n, coalesce(max(position) + 1, 0)::int as next
          from staff
        `)
      ).rows;
      if ((counted?.n ?? 0) >= L.staff) {
        throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.staff)} staff members.`);
      }
      await tx.execute(sql`
        insert into staff (workspace_id, id, name, title, bio, color, position, created_by_member_id, updated_by_member_id)
        values (${scope.workspaceId}::uuid, ${id}::uuid, ${fields.name.trim()}, ${blank(fields.title)},
          ${blank(fields.bio)}, ${fields.color}, ${counted?.next ?? 0}, ${by}::uuid, ${by}::uuid)
      `);
    } else {
      await tx.execute(sql`
        update staff set name = ${fields.name.trim()}, title = ${blank(fields.title)}, bio = ${blank(fields.bio)},
          color = ${fields.color}, updated_at = now(), updated_by_member_id = ${by}::uuid
        where id = ${id}::uuid
      `);
    }
    // Places: the ones left out go (with their shifts), new ones start on the place's opening week.
    const leaving = before.filter((each) => !placeIds.includes(each));
    if (leaving.length > 0) {
      await tx.execute(sql`
        delete from staff_places where staff_id = ${id}::uuid and place_id = any(${`{${leaving.join(',')}}`}::uuid[])
      `);
    }
    for (const placeId of placeIds.filter((each) => !before.includes(each))) {
      const [full] = (
        await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from staff_places sp join staff st on st.workspace_id = sp.workspace_id and st.id = sp.staff_id
          where sp.place_id = ${placeId}::uuid and st.archived_at is null
        `)
      ).rows;
      if ((full?.n ?? 0) >= VISIT_LIMITS.staffPerPlace) {
        throw refuse('LIMIT_REACHED', `A place takes up to ${String(VISIT_LIMITS.staffPerPlace)} staff members.`);
      }
      await tx.execute(sql`
        insert into staff_places (workspace_id, staff_id, place_id, shifts)
        values (${scope.workspaceId}::uuid, ${id}::uuid, ${placeId}::uuid, ${JSON.stringify(await placeWeek(tx, placeId))}::jsonb)
      `);
    }
    // Services: every live one of the catalogue, set to match the list.
    const services = (
      await tx.execute<{ id: string; staff_rule: string; does: boolean }>(sql`
        select s.id::text, s.staff_rule, exists (
          select 1 from service_staff ss where ss.workspace_id = s.workspace_id and ss.service_id = s.id and ss.staff_id = ${id}::uuid
        ) as does
        from services s where s.archived_at is null and s.capacity_mode = 'one' and s.staff_rule <> 'none'
      `)
    ).rows;
    for (const id_ of serviceIds) {
      if (!services.some((service) => service.id === id_))
        throw inputInvalid('serviceIds', 'One of those services doesn’t exist.');
    }
    for (const service of services) {
      const wanted = serviceIds.has(service.id);
      if (service.staff_rule === 'all' && !wanted) {
        // Everyone did it: it turns to the chosen staff, everyone else, so nobody else loses it.
        await tx.execute(
          sql`update services set staff_rule = 'chosen', updated_at = now() where id = ${service.id}::uuid`,
        );
        await tx.execute(sql`
          insert into service_staff (workspace_id, service_id, staff_id)
          select ${scope.workspaceId}::uuid, ${service.id}::uuid, st.id from staff st
          where st.archived_at is null and st.id <> ${id}::uuid
          on conflict do nothing
        `);
      } else if (service.staff_rule === 'chosen' && wanted && !service.does) {
        await tx.execute(sql`
          insert into service_staff (workspace_id, service_id, staff_id)
          values (${scope.workspaceId}::uuid, ${service.id}::uuid, ${id}::uuid) on conflict do nothing
        `);
      } else if (service.staff_rule === 'chosen' && !wanted && service.does) {
        await tx.execute(sql`
          delete from service_staff where service_id = ${service.id}::uuid and staff_id = ${id}::uuid
        `);
      }
    }
    return { places: [...new Set([...before, ...placeIds])], ids: { staffId: id } };
  });
}

/** Moves a profile to `toIndex` (the order lists show and "Any professional" breaks ties by). */
export async function moveStaff(
  scope: EngineScope,
  input: { readonly staffId: string; readonly toIndex: number },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.staffId, STAFF_MISSING);
  return teamWrite(scope, 'services.manage', deps, hooks, 'staff.moved', async ({ tx }) => {
    await lockedStaff(tx, id);
    const order = (
      await tx.execute<{ id: string }>(sql`select id::text from staff where archived_at is null order by position, id`)
    ).rows.map((row) => row.id);
    const rest = order.filter((each) => each !== id);
    rest.splice(Math.min(Math.max(input.toIndex, 0), rest.length), 0, id);
    await tx.execute(sql`
      update staff t set position = o.at - 1
      from unnest(${`{${rest.join(',')}}`}::uuid[]) with ordinality as o(id, at)
      where t.id = o.id and t.position is distinct from (o.at - 1)::int
    `);
    return { places: await placesOf(tx, id), ids: { staffId: id } };
  });
}

/**
 * Archives a profile: refused CONFLICT with the count while they have visits to come (move them first); unlinks a
 * linked member, so that member can be someone else's profile. Restore brings it back.
 */
export async function archiveStaff(
  scope: EngineScope,
  input: { readonly staffId: string },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.staffId, STAFF_MISSING);
  return teamWrite(scope, 'services.manage', deps, hooks, 'staff.archived', async ({ tx }) => {
    // Their person lock first, as a booking takes it, so a visit being booked for them now finishes before the count,
    // and one after sees them archived (Rules settled: Locks).
    const [seen] = (
      await tx.execute<{ member_id: string | null }>(sql`select member_id::text from staff where id = ${id}::uuid`)
    ).rows;
    for (const key of personLockKeys(scope.workspaceId, [{ id, memberId: seen?.member_id ?? undefined }])) {
      await lockKey(tx, key);
    }
    const row = await lockedStaff(tx, id);
    const [upcoming] = (
      await tx.execute<{ n: number }>(sql`
        select count(distinct appointment_id)::int as n from appointment_holds
        where staff_id = ${id}::uuid and live and ends_at > now()
      `)
    ).rows;
    const n = upcoming?.n ?? 0;
    if (n > 0) {
      throw refuse(
        'CONFLICT',
        `${row.name} has ${String(n)} ${n === 1 ? 'visit' : 'visits'} to come. Move ${n === 1 ? 'it' : 'them'} to someone else first.`,
      );
    }
    await tx.execute(sql`
      update staff set archived_at = now(), member_id = null, updated_at = now() where id = ${id}::uuid
    `);
    return { places: await placesOf(tx, id), ids: { staffId: id } };
  });
}

/** Restores an archived profile, at the end of the order. */
export async function restoreStaff(
  scope: EngineScope,
  input: { readonly staffId: string },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.staffId, STAFF_MISSING);
  return teamWrite(scope, 'services.manage', deps, hooks, 'staff.restored', async ({ tx }) => {
    await lockedStaff(tx, id, true);
    const [counted] = (
      await tx.execute<{ n: number; next: number }>(sql`
        select count(*) filter (where archived_at is null)::int as n, coalesce(max(position) + 1, 0)::int as next from staff
      `)
    ).rows;
    if ((counted?.n ?? 0) >= L.staff)
      throw refuse('LIMIT_REACHED', `A workspace takes up to ${String(L.staff)} staff members.`);
    await tx.execute(sql`
      update staff set archived_at = null, position = ${counted?.next ?? 0}, updated_at = now() where id = ${id}::uuid
    `);
    return { places: await placesOf(tx, id), ids: { staffId: id } };
  });
}

/**
 * Links a profile to a member or unlinks it, through the engine's one link (`linkStaffMember`, which refuses CONFLICT
 * while their visits and the member's meetings overlap), then answers the team.
 */
export async function linkStaff(
  scope: EngineScope,
  input: { readonly staffId: string; readonly memberId: string | null },
  deps: { readonly now?: () => Date } = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.manage');
  // The engine's link gates on either engine app; these screens are Appointments', so refuse first, before writing.
  await inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'appointments');
    // A profile is the whole workspace's (spec 0065 H7): only someone who reaches every business links it.
    if (!(await reachOf(tx, scope)).all) throw refuse('FORBIDDEN', STAFF_WHOLE_WORKSPACE);
  });
  await linkStaffMember(scope, input, deps, hooks);
  return getTeam(scope);
}

/** Where a profile's photos live: under its workspace and its own id, nothing typed by anyone. */
export const staffPhotoFolder = (workspaceId: string, staffId: string): string => `staff/${workspaceId}/${staffId}-`;

/**
 * Points a profile at a new photo the API has already stored at `path` (inside `staffPhotoFolder`). Answers the photo
 * it replaced, for the API to remove from the store once this commits, so a face never outlives its profile's choice.
 */
export async function setStaffPhoto(
  scope: EngineScope,
  input: { readonly staffId: string; readonly path: string },
): Promise<{ readonly previous?: string }> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.staffId, STAFF_MISSING);
  if (!input.path.startsWith(staffPhotoFolder(scope.workspaceId, id)) || !/^[a-z0-9/.-]+$/.test(input.path)) {
    throw inputInvalid('path', 'That photo can’t be kept here.');
  }
  const found: { previous: string | null } = { previous: null };
  await teamWrite(scope, 'services.manage', {}, [], 'staff.photo', async ({ tx }) => {
    await lockedStaff(tx, id);
    const [row] = (
      await tx.execute<{ photo_path: string | null }>(sql`select photo_path from staff where id = ${id}::uuid`)
    ).rows;
    found.previous = row?.photo_path ?? null;
    await tx.execute(sql`update staff set photo_path = ${input.path}, updated_at = now() where id = ${id}::uuid`);
    return { places: await placesOf(tx, id), ids: { staffId: id } };
  });
  return found.previous === null ? {} : { previous: found.previous };
}

/**
 * Takes a profile's photo away; once that commits, `deps.forgetFile` removes it from the store (the API's), so nothing
 * keeps a face nobody points at.
 */
export async function removeStaffPhoto(
  scope: EngineScope,
  input: { readonly staffId: string },
  deps: CatalogueDeps & { readonly forgetFile?: (path: string) => Promise<void> } = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.manage');
  const id = checkId(input.staffId, STAFF_MISSING);
  const found: { previous: string | null } = { previous: null };
  const view = await teamWrite(scope, 'services.manage', deps, hooks, 'staff.photo_removed', async ({ tx }) => {
    await lockedStaff(tx, id);
    const [row] = (
      await tx.execute<{ photo_path: string | null }>(sql`select photo_path from staff where id = ${id}::uuid`)
    ).rows;
    found.previous = row?.photo_path ?? null;
    await tx.execute(sql`update staff set photo_path = null, updated_at = now() where id = ${id}::uuid`);
    return { places: await placesOf(tx, id), ids: { staffId: id } };
  });
  if (found.previous !== null) await deps.forgetFile?.(found.previous);
  return view;
}

/** A profile's photo for the screens (`services.manage` or `services.calendar`), or undefined. */
export async function readStaffPhoto(
  scope: EngineScope,
  input: { readonly staffId: string },
): Promise<{ readonly path: string; readonly type: string } | undefined> {
  if (!can(scope.access, 'services.manage')) requirePermission(scope, 'services.calendar');
  const id = checkId(input.staffId, STAFF_MISSING);
  return inWorkspace(scope, async (tx) => {
    await requireApp(tx, scope.workspaceId, 'appointments');
    const [row] = (
      await tx.execute<{ photo_path: string | null }>(sql`select photo_path from staff where id = ${id}::uuid`)
    ).rows;
    if (row?.photo_path === null || row?.photo_path === undefined) return undefined;
    const type = row.photo_path.endsWith('.png')
      ? 'image/png'
      : row.photo_path.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    return { path: row.photo_path, type };
  });
}

/** Refuses NOT_FOUND unless the staff member works at the place. */
async function requireWorks(tx: WorkspaceTx, staffId: string, placeId: string, name: string): Promise<void> {
  const [row] = (
    await tx.execute<{ ok: boolean }>(sql`
      select true as ok from staff_places where staff_id = ${staffId}::uuid and place_id = ${placeId}::uuid
    `)
  ).rows;
  if (row === undefined) throw refuse('NOT_FOUND', `${name} doesn’t work there. Add the place on their profile first.`);
}

/**
 * Sets a staff member's shifts at a place, whole (AC-6612): the weekly pattern and every date override, checked by the
 * place hours' one rule, and whether they may work outside the place's opening hours. One write for the whole week, so
 * "copy to all weeks" never saves one day of seven.
 */
export async function setShifts(
  scope: EngineScope,
  input: {
    readonly staffId: string;
    readonly placeId: string;
    readonly shifts: PlaceHours;
    readonly outsideHours: boolean;
  },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.calendar');
  const id = checkId(input.staffId, STAFF_MISSING);
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  const problem = hoursProblem(input.shifts);
  if (problem !== undefined) throw inputInvalid('shifts', problem);
  if (input.shifts.exceptions.length > HOSPITALITY_LIMITS.exceptions) {
    throw inputInvalid('shifts', `Use up to ${String(HOSPITALITY_LIMITS.exceptions)} date changes.`);
  }
  return teamWrite(scope, 'services.calendar', deps, hooks, 'staff.shifts', async ({ tx }) => {
    const row = await lockedStaff(tx, id);
    await requireWorks(tx, id, placeId, row.name);
    await tx.execute(sql`
      update staff_places set shifts = ${JSON.stringify(input.shifts)}::jsonb, outside_hours = ${input.outsideHours},
        updated_at = now()
      where staff_id = ${id}::uuid and place_id = ${placeId}::uuid
    `);
    return { places: [placeId], ids: { staffId: id, placeId } };
  });
}

/** Copies one staff member's weekly shifts (and their outside hours switch) at a place to others there (AC-6612). */
export async function copyShifts(
  scope: EngineScope,
  input: { readonly staffId: string; readonly placeId: string; readonly toStaffIds: readonly string[] },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.calendar');
  const id = checkId(input.staffId, STAFF_MISSING);
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  const targets = [...new Set(input.toStaffIds.map((each) => checkId(each, STAFF_MISSING)))].filter(
    (each) => each !== id,
  );
  return teamWrite(scope, 'services.calendar', deps, hooks, 'staff.shifts_copied', async ({ tx }) => {
    const row = await lockedStaff(tx, id);
    const [from] = (
      await tx.execute<{ shifts: PlaceHours; outside_hours: boolean }>(sql`
        select shifts, outside_hours from staff_places where staff_id = ${id}::uuid and place_id = ${placeId}::uuid
      `)
    ).rows;
    if (from === undefined) throw refuse('NOT_FOUND', `${row.name} doesn’t work there.`);
    if (targets.length === 0) return { places: [] };
    // Each target keeps their own date overrides; the weekly pattern becomes the source's.
    const changed = await tx.execute(sql`
      update staff_places sp set shifts = jsonb_set(sp.shifts, '{weekly}', ${JSON.stringify(from.shifts.weekly)}::jsonb),
        outside_hours = ${from.outside_hours}, updated_at = now()
      from staff st
      where st.workspace_id = sp.workspace_id and st.id = sp.staff_id and st.archived_at is null
        and sp.place_id = ${placeId}::uuid and sp.staff_id = any(${`{${targets.join(',')}}`}::uuid[])
    `);
    if ((changed.rowCount ?? 0) !== targets.length) {
      throw refuse('NOT_FOUND', 'Not everyone chosen works there. Add the place on their profiles first.');
    }
    return { places: [placeId], ids: { staffId: id, placeId } };
  });
}

/** Refuses CONFLICT for a linked staff member (their time off is their member's own) and answers their places. */
async function unlinkedPlaces(tx: WorkspaceTx, staffId: string): Promise<{ name: string; places: string[] }> {
  const row = await lockedStaff(tx, staffId);
  if (row.member_id !== null) throw refuse('CONFLICT', LINKED_TIME);
  return { name: row.name, places: await placesOf(tx, staffId) };
}

/**
 * After an insert that may have met its own id (a retry): refuses CONFLICT unless the row there is this one (the same
 * staff member and span), so a reused id never answers success for a write that didn't happen.
 */
async function sameRetry(
  tx: WorkspaceTx,
  table: 'staff_time_off' | 'staff_blocks',
  id: string,
  staffId: string,
  start: string,
  end: string,
): Promise<void> {
  const [row] = (
    await tx.execute<{ same: boolean }>(sql`
      select (staff_id = ${staffId}::uuid and starts_at = ${start}::timestamptz and ends_at = ${end}::timestamptz) as same
      from ${sql.identifier(table)} where id = ${id}::uuid
    `)
  ).rows;
  if (row?.same !== true) throw refuse('CONFLICT', 'That time was already used for something else. Try again.');
}

/** Checks a span: start before end, at most `days` long. */
function checkSpan(start: string, end: string, days: number): void {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!(to > from)) throw inputInvalid('end', 'End after it starts.');
  if (to - from > days * 86_400_000) throw inputInvalid('end', `Keep it to ${String(days)} days or fewer.`);
}

/** Adds time off for an unlinked staff member: holiday, sick, training or other, at one place or all of theirs. */
export async function addStaffTimeOff(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly staffId: string;
    readonly placeId?: string | undefined;
    readonly start: string;
    readonly end: string;
    readonly reason: StaffView['timeOff'][number]['reason'];
  },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.calendar');
  const id = checkId(input.id, 'That time off doesn’t exist.');
  const staffId = checkId(input.staffId, STAFF_MISSING);
  const placeId = input.placeId === undefined ? undefined : checkId(input.placeId, 'That place doesn’t exist.');
  checkSpan(input.start, input.end, L.timeOffDays);
  return teamWrite(scope, 'services.calendar', deps, hooks, 'staff.time_off_added', async ({ tx }, by) => {
    const { name, places } = await unlinkedPlaces(tx, staffId);
    if (placeId !== undefined) await requireWorks(tx, staffId, placeId, name);
    await tx.execute(sql`
      insert into staff_time_off (workspace_id, id, staff_id, place_id, starts_at, ends_at, reason, created_by_member_id)
      values (${scope.workspaceId}::uuid, ${id}::uuid, ${staffId}::uuid, ${placeId ?? null}::uuid,
        ${input.start}::timestamptz, ${input.end}::timestamptz, ${input.reason}, ${by}::uuid)
      on conflict do nothing
    `);
    await sameRetry(tx, 'staff_time_off', id, staffId, input.start, input.end);
    return { places: placeId === undefined ? places : [placeId], ids: { staffId, timeOffId: id } };
  });
}

/** Removes one time off. */
export async function removeStaffTimeOff(
  scope: EngineScope,
  input: { readonly id: string },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.calendar');
  const id = checkId(input.id, 'That time off doesn’t exist.');
  return teamWrite(scope, 'services.calendar', deps, hooks, 'staff.time_off_removed', async ({ tx }) => {
    const [row] = (
      await tx.execute<{ staff_id: string; place_id: string | null }>(sql`
        delete from staff_time_off where id = ${id}::uuid returning staff_id::text, place_id::text
      `)
    ).rows;
    if (row === undefined) throw refuse('NOT_FOUND', 'That time off doesn’t exist.');
    return {
      places: row.place_id === null ? await placesOf(tx, row.staff_id) : [row.place_id],
      ids: { staffId: row.staff_id, timeOffId: id },
    };
  });
}

/** Blocks time at a place for an unlinked staff member (lunch, training): busy for online booking. */
export async function addStaffBlock(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly staffId: string;
    readonly placeId: string;
    readonly start: string;
    readonly end: string;
    readonly reason?: string | undefined;
  },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.calendar');
  const id = checkId(input.id, 'That block doesn’t exist.');
  const staffId = checkId(input.staffId, STAFF_MISSING);
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  checkSpan(input.start, input.end, L.blockDays);
  const reason = input.reason === undefined || input.reason.trim() === '' ? null : input.reason.trim();
  return teamWrite(scope, 'services.calendar', deps, hooks, 'staff.block_added', async ({ tx }, by) => {
    const { name } = await unlinkedPlaces(tx, staffId);
    await requireWorks(tx, staffId, placeId, name);
    await tx.execute(sql`
      insert into staff_blocks (workspace_id, id, staff_id, place_id, starts_at, ends_at, reason, created_by_member_id)
      values (${scope.workspaceId}::uuid, ${id}::uuid, ${staffId}::uuid, ${placeId}::uuid, ${input.start}::timestamptz,
        ${input.end}::timestamptz, ${reason}, ${by}::uuid)
      on conflict do nothing
    `);
    await sameRetry(tx, 'staff_blocks', id, staffId, input.start, input.end);
    return { places: [placeId], ids: { staffId, blockId: id } };
  });
}

/** Removes one block. */
export async function removeStaffBlock(
  scope: EngineScope,
  input: { readonly id: string },
  deps: CatalogueDeps = {},
  hooks: readonly AfterWrite[] = [],
): Promise<StaffTeamView> {
  requirePermission(scope, 'services.calendar');
  const id = checkId(input.id, 'That block doesn’t exist.');
  return teamWrite(scope, 'services.calendar', deps, hooks, 'staff.block_removed', async ({ tx }) => {
    const [row] = (
      await tx.execute<{ staff_id: string; place_id: string }>(sql`
        delete from staff_blocks where id = ${id}::uuid returning staff_id::text, place_id::text
      `)
    ).rows;
    if (row === undefined) throw refuse('NOT_FOUND', 'That block doesn’t exist.');
    return { places: [row.place_id], ids: { staffId: row.staff_id, blockId: id } };
  });
}
