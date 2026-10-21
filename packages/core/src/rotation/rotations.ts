// Rotations for members (spec 0029, AC-728 to AC-730, AC-751, AC-752,
// AC-757, AC-758): list, make, change and delete the pools round robin pages
// book from. Making, changing and deleting need `booking.admin`; anyone with
// `booking.manage` lists the rotations they are in, with everyone's names but
// only their own count (everyone's with `booking.admin`). Rotations are
// settings, not CRM data: their writes store no outbox row.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  PERMISSIONS,
  type CreateRotationInput,
  type RotationMemberInput,
  type RotationView,
  type UpdateRotationInput,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import { uuidArray } from '../engine/ids.ts';
import { actorRow } from '../engine/scope.ts';
import { lockRotation, windowCounts, windowStart } from './ledger.ts';
import { ROTATION_ROLES, rulesOf } from './team.ts';

const {
  availabilitySchedules,
  bookingPageRotations,
  bookingPages,
  calendarConnections,
  members,
  rotationMembers,
  rotations,
} = schema;

const NOT_FOUND_MESSAGE = 'That rotation doesn’t exist any more.';

/** The member the scope acts for, or undefined (a key, the system). */
function memberOf(scope: EngineScope): string | undefined {
  return scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
}

type RotationRow = typeof rotations.$inferSelect;

/** Each rotation's members, counts and pages, as the reader may see them (AC-752). */
async function viewsOf(
  tx: WorkspaceTx,
  scope: EngineScope,
  rows: readonly RotationRow[],
  now: Date,
): Promise<readonly RotationView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const everyone = can(scope.access, 'booking.admin');
  const me = memberOf(scope);
  const held = await tx
    .select({
      rotationId: rotationMembers.rotationId,
      memberId: rotationMembers.memberId,
      name: members.name,
      weight: rotationMembers.weight,
      priority: rotationMembers.priority,
      dailyCap: rotationMembers.dailyCap,
      weeklyCap: rotationMembers.weeklyCap,
      isOn: rotationMembers.isOn,
      calibration: rotationMembers.calibration,
      // Qualified by hand: drizzle writes a column unqualified in a select, and `member_id` would be `c`'s own.
      hasCalendar: sql<boolean>`exists (
        select 1 from ${calendarConnections} c
        where c.workspace_id = "rotation_members"."workspace_id" and c.member_id = "rotation_members"."member_id"
          and c.status in ('syncing', 'connected')
      )`,
    })
    .from(rotationMembers)
    .innerJoin(
      members,
      and(eq(members.workspaceId, rotationMembers.workspaceId), eq(members.id, rotationMembers.memberId)),
    )
    .where(inArray(rotationMembers.rotationId, ids))
    .orderBy(asc(rotationMembers.position), asc(rotationMembers.memberId));
  // Each rotation's live counts over its own window, in one grouped read.
  const counted = await tx.execute<{ rotation_id: string; member_id: string; count: number }>(sql`
    select a.rotation_id::text as rotation_id, a.member_id::text as member_id, sum(a.units)::int as count
    from rotation_assignments a
    join rotations r on r.workspace_id = a.workspace_id and r.id = a.rotation_id
    where a.rotation_id = any(${uuidArray(ids)}) and a.voided_at is null
      and a.assigned_at >= ${now.toISOString()}::timestamptz - make_interval(days => r.window_days)
    group by a.rotation_id, a.member_id
  `);
  const counts = new Map(counted.rows.map((row) => [`${row.rotation_id}:${row.member_id}`, row.count]));
  // Each member's upcoming confirmed bookings each rotation seats them on (AC-750's "their N upcoming bookings"):
  // from the bookings ahead, never the ledger's whole history, through its live row per booking.
  const ahead = await tx.execute<{ rotation_id: string; member_id: string; count: number }>(sql`
    select a.rotation_id::text as rotation_id, a.member_id::text as member_id, count(*)::int as count
    from bookings b
    join rotation_assignments a on a.workspace_id = b.workspace_id and a.booking_id = b.id
      and a.voided_at is null and a.booking_id is not null
    where b.status = 'confirmed' and b.starts_at > ${now.toISOString()}::timestamptz
      and a.rotation_id = any(${uuidArray(ids)})
    group by a.rotation_id, a.member_id
  `);
  const upcoming = new Map(ahead.rows.map((row) => [`${row.rotation_id}:${row.member_id}`, row.count]));
  const pages = await tx
    .select({ rotationId: bookingPageRotations.rotationId, count: sql<number>`count(*)::int` })
    .from(bookingPageRotations)
    .innerJoin(
      bookingPages,
      and(
        eq(bookingPages.workspaceId, bookingPageRotations.workspaceId),
        eq(bookingPages.id, bookingPageRotations.pageId),
      ),
    )
    .where(and(inArray(bookingPageRotations.rotationId, ids), isNull(bookingPages.deletedAt)))
    .groupBy(bookingPageRotations.rotationId);
  const pageCounts = new Map(pages.map((row) => [row.rotationId, row.count]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    strategy: rulesOf(row).strategy,
    windowDays: row.windowDays === 7 || row.windowDays === 90 ? row.windowDays : 30,
    evenGap: row.evenGap,
    returning: rulesOf(row).returning,
    members: held
      .filter((member) => member.rotationId === row.id)
      .map((member) => ({
        memberId: member.memberId,
        name: member.name,
        weight: member.weight,
        priority: member.priority,
        dailyCap: member.dailyCap,
        weeklyCap: member.weeklyCap,
        isOn: member.isOn,
        hasCalendar: member.hasCalendar,
        ...(everyone || member.memberId === me
          ? {
              count: (counts.get(`${row.id}:${member.memberId}`) ?? 0) + member.calibration,
              upcoming: upcoming.get(`${row.id}:${member.memberId}`) ?? 0,
            }
          : {}),
      })),
    pages: pageCounts.get(row.id) ?? 0,
    canChange: everyone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** The rotations the reader may see (AC-752): every live one with `booking.admin`, else the ones they're in. */
export async function listRotations(scope: EngineScope, now: Date = new Date()): Promise<readonly RotationView[]> {
  requirePermission(scope, 'booking.manage');
  const me = memberOf(scope);
  const everyone = can(scope.access, 'booking.admin');
  if (!everyone && me === undefined) return [];
  return inWorkspace(scope, async (tx) => {
    const rows = await tx
      .select()
      .from(rotations)
      .where(
        and(
          isNull(rotations.deletedAt),
          everyone
            ? undefined
            : sql`exists (select 1 from ${rotationMembers} m where m.workspace_id = "rotations"."workspace_id"
                and m.rotation_id = "rotations"."id" and m.member_id = ${me ?? null}::uuid)`,
        ),
      )
      .orderBy(asc(rotations.name), asc(rotations.id))
      .limit(200);
    return viewsOf(tx, scope, rows, now);
  });
}

/**
 * Refuses members a rotation can't hold (AC-729): anyone not an active,
 * non guest member of the workspace, and anyone with neither their own hours
 * nor a calendar connected.
 */
async function checkMembers(tx: WorkspaceTx, list: readonly RotationMemberInput[]): Promise<void> {
  const ids = list.map((member) => member.memberId);
  const found = await tx
    .select({
      id: members.id,
      name: members.name,
      status: members.status,
      role: members.role,
      // Qualified by hand: inside a select drizzle writes a column unqualified, and `id` would be the subquery's own.
      hasHours: sql<boolean>`exists (
        select 1 from ${availabilitySchedules} h where h.workspace_id = "members"."workspace_id" and h.member_id = "members"."id"
      )`,
      hasCalendar: sql<boolean>`exists (
        select 1 from ${calendarConnections} c where c.workspace_id = "members"."workspace_id" and c.member_id = "members"."id"
          and c.status in ('syncing', 'connected')
      )`,
    })
    .from(members)
    .where(inArray(members.id, ids));
  const byId = new Map(found.map((row) => [row.id, row]));
  for (const [index, member] of list.entries()) {
    const row = byId.get(member.memberId);
    if (row === undefined || row.status !== 'active' || !ROTATION_ROLES.includes(row.role)) {
      throw refuseOn(
        'CONFIG_INVALID',
        'Only active members of this workspace can be in a rotation.',
        `members.${String(index)}`,
      );
    }
    if (!row.hasHours && !row.hasCalendar) {
      throw refuseOn(
        'CONFIG_INVALID',
        `${row.name} needs to set hours or connect a calendar first.`,
        `members.${String(index)}`,
      );
    }
  }
}

/** The rotation's row, live, locked for the change; NOT_FOUND otherwise. */
async function rotationToChange(tx: WorkspaceTx, rotationId: string): Promise<RotationRow> {
  const [row] = await tx
    .select()
    .from(rotations)
    .where(and(eq(rotations.id, rotationId), isNull(rotations.deletedAt)))
    .for('no key update');
  if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
  return row;
}

/** A new rotation (AC-728): its settings and 2 to 20 members, each starting even. The same id again answers it. */
export async function createRotation(
  scope: EngineScope,
  input: Pick<CreateRotationInput, 'id' | 'settings' | 'members'>,
  now: Date = new Date(),
): Promise<RotationView> {
  requirePermission(scope, 'booking.admin');
  if (memberOf(scope) === undefined) throw refuse('FORBIDDEN', PERMISSIONS['booking.admin'].message);
  const by = actorRow(scope.actor);
  return inWorkspace(scope, async (tx) => {
    const [existing] = await tx.select().from(rotations).where(eq(rotations.id, input.id));
    if (existing !== undefined) {
      if (existing.deletedAt !== null) throw refuse('ID_TAKEN', 'A rotation with that id already exists.');
      return firstOf(await viewsOf(tx, scope, [existing], now));
    }
    await checkMembers(tx, input.members);
    const [row] = await tx
      .insert(rotations)
      .values({
        workspaceId: scope.workspaceId,
        id: input.id,
        name: input.settings.name,
        strategy: input.settings.strategy,
        windowDays: input.settings.windowDays,
        evenGap: input.settings.evenGap,
        returning: input.settings.returning,
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .returning();
    if (row === undefined) throw new Error('The rotation was not created.');
    await tx.insert(rotationMembers).values(
      input.members.map((member, position) => ({
        workspaceId: scope.workspaceId,
        rotationId: row.id,
        memberId: member.memberId,
        weight: member.weight,
        priority: member.priority,
        dailyCap: member.dailyCap,
        weeklyCap: member.weeklyCap,
        isOn: member.isOn,
        calibration: 0,
        position,
        createdByType: by.type,
        createdById: by.id,
        createdByMemberId: by.memberId,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })),
    );
    return firstOf(await viewsOf(tx, scope, [row], now));
  });
}

/** The one view a single row made. */
function firstOf(views: readonly RotationView[]): RotationView {
  const [view] = views;
  if (view === undefined) throw new Error('The rotation was not read back.');
  return view;
}

/**
 * Changes a rotation (AC-757): the settings given; `members`, when given,
 * replaces the list. A member who stays keeps their count; one who joins
 * starts at the pool's average load for their weight (AC-730), so they
 * aren't handed every booking until they catch up; one who leaves keeps
 * their bookings (AC-750). The next assignment uses the change.
 */
export async function updateRotation(
  scope: EngineScope,
  input: Pick<UpdateRotationInput, 'rotationId' | 'settings' | 'members'>,
  now: Date = new Date(),
): Promise<RotationView> {
  requirePermission(scope, 'booking.admin');
  const by = actorRow(scope.actor);
  return inWorkspace(scope, async (tx) => {
    const current = await rotationToChange(tx, input.rotationId);
    // Under the rotation's lock, so a booking's pick never sees half a change, and the joiners' calibration is exact.
    await lockRotation(tx, scope.workspaceId, current.id);
    const { settings } = input;
    const [row] = await tx
      .update(rotations)
      .set({
        ...(settings.name === undefined ? {} : { name: settings.name }),
        ...(settings.strategy === undefined ? {} : { strategy: settings.strategy }),
        ...(settings.windowDays === undefined ? {} : { windowDays: settings.windowDays }),
        ...(settings.evenGap === undefined ? {} : { evenGap: settings.evenGap }),
        ...(settings.returning === undefined ? {} : { returning: settings.returning }),
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(rotations.id, current.id))
      .returning();
    if (row === undefined) throw refuse('NOT_FOUND', NOT_FOUND_MESSAGE);
    if (input.members !== undefined) await replaceMembers(tx, scope, row, input.members, now);
    return firstOf(await viewsOf(tx, scope, [row], now));
  });
}

/** Replaces a rotation's members, keeping the stayers' counts and calibrating the joiners (AC-730). */
async function replaceMembers(
  tx: WorkspaceTx,
  scope: EngineScope,
  rotation: RotationRow,
  list: readonly RotationMemberInput[],
  now: Date,
): Promise<void> {
  const by = actorRow(scope.actor);
  const before = await tx.select().from(rotationMembers).where(eq(rotationMembers.rotationId, rotation.id));
  const kept = new Map(before.map((member) => [member.memberId, member]));
  const joining = list.filter((member) => !kept.has(member.memberId));
  if (joining.length > 0) await checkMembers(tx, joining);
  const counts = await windowCounts(tx, rotation.id, windowStart(now, rotation.windowDays));
  // The pool's average load (count and calibration for each unit of weight), over the members switched on now.
  const on = before.filter((member) => member.isOn);
  const load =
    on.length === 0
      ? 0
      : on.reduce(
          (sum, member) => sum + ((counts.get(member.memberId)?.count ?? 0) + member.calibration) / member.weight,
          0,
        ) / on.length;
  const leaving = before.filter((member) => !list.some((each) => each.memberId === member.memberId));
  if (leaving.length > 0) {
    await tx.delete(rotationMembers).where(
      and(
        eq(rotationMembers.rotationId, rotation.id),
        inArray(
          rotationMembers.memberId,
          leaving.map((member) => member.memberId),
        ),
      ),
    );
  }
  for (const [position, member] of list.entries()) {
    const stays = kept.get(member.memberId);
    const values = {
      weight: member.weight,
      priority: member.priority,
      dailyCap: member.dailyCap,
      weeklyCap: member.weeklyCap,
      isOn: member.isOn,
      position,
      updatedAt: sql`now()`,
      updatedByType: by.type,
      updatedById: by.id,
      updatedByMemberId: by.memberId,
    };
    if (stays !== undefined) {
      await tx
        .update(rotationMembers)
        .set(values)
        .where(and(eq(rotationMembers.rotationId, rotation.id), eq(rotationMembers.memberId, member.memberId)));
      continue;
    }
    const credited = Math.max(0, load * member.weight - (counts.get(member.memberId)?.count ?? 0));
    await tx.insert(rotationMembers).values({
      workspaceId: scope.workspaceId,
      rotationId: rotation.id,
      memberId: member.memberId,
      ...values,
      calibration: Math.round(credited * 100) / 100,
      createdByType: by.type,
      createdById: by.id,
      createdByMemberId: by.memberId,
    });
  }
}

/**
 * Deletes a rotation no live page books from (AC-758): refused IN_USE ("Used
 * by 2 pages") while one does. Its ledger stays, for the bookings it explains.
 */
export async function deleteRotation(
  scope: EngineScope,
  input: { readonly rotationId: string },
): Promise<{ readonly rotationId: string }> {
  requirePermission(scope, 'booking.admin');
  const by = actorRow(scope.actor);
  return inWorkspace(scope, async (tx) => {
    const current = await rotationToChange(tx, input.rotationId);
    const [used] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingPageRotations)
      .innerJoin(
        bookingPages,
        and(
          eq(bookingPages.workspaceId, bookingPageRotations.workspaceId),
          eq(bookingPages.id, bookingPageRotations.pageId),
        ),
      )
      .where(and(eq(bookingPageRotations.rotationId, current.id), isNull(bookingPages.deletedAt)));
    const pages = used?.count ?? 0;
    if (pages > 0) {
      throw refuse(
        'IN_USE',
        `Used by ${String(pages)} ${pages === 1 ? 'page' : 'pages'}. Move them to another rotation first.`,
      );
    }
    await tx
      .update(rotations)
      .set({
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
        updatedByType: by.type,
        updatedById: by.id,
        updatedByMemberId: by.memberId,
      })
      .where(eq(rotations.id, current.id));
    return { rotationId: current.id };
  });
}
