// Rotations for members (spec 0029, AC-728 to AC-730, AC-751, AC-752,
// AC-757, AC-758): list, make, change and delete the pools round robin pages
// book from. Making, changing and deleting need `booking.admin`; anyone with
// `booking.manage` lists the rotations they are in, with everyone's names but
// only their own count (everyone's with `booking.admin`). Rotations are
// settings, not CRM data: their writes store no outbox row.
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  PERMISSIONS,
  ROTATION_MEMBERS,
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
import { writeAudit } from '../members/audit.ts';
import { queueSchedulingNotice } from '../scheduling/notice.ts';
import { lockRotation, windowCounts, windowStart } from './ledger.ts';
import { keepRosterRows, rosterCalibration } from './roster.ts';
import { eligibleMembers, ROTATION_ROLES, rulesOf } from './team.ts';

const {
  availabilitySchedules,
  bookingPageRotations,
  bookingPages,
  calendarConnections,
  forms,
  members,
  rotationMembers,
  rotationRoster,
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
  // Through `rotation_roster`: "Everyone on the roster" lists every active member who isn't a guest.
  const held = await tx
    .select({
      rotationId: rotationRoster.rotationId,
      memberId: rotationRoster.memberId,
      name: members.name,
      weight: rotationRoster.weight,
      priority: rotationRoster.priority,
      dailyCap: rotationRoster.dailyCap,
      weeklyCap: rotationRoster.weeklyCap,
      isOn: rotationRoster.isOn,
      calibration: rotationRoster.calibration,
      stored: rotationRoster.stored,
      joinsLate: rotationRoster.joinsLate,
      // Qualified by hand: drizzle writes a column unqualified in a select, and `member_id` would be `c`'s own.
      hasCalendar: sql<boolean>`exists (
        select 1 from ${calendarConnections} c
        where c.workspace_id = "rotation_roster"."workspace_id" and c.member_id = "rotation_roster"."member_id"
          and c.status in ('syncing', 'connected')
      )`,
    })
    .from(rotationRoster)
    .innerJoin(
      members,
      and(eq(members.workspaceId, rotationRoster.workspaceId), eq(members.id, rotationRoster.memberId)),
    )
    .where(inArray(rotationRoster.rotationId, ids))
    .orderBy(asc(rotationRoster.position), asc(members.name), asc(rotationRoster.memberId));
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
  return rows.map((row) => {
    const listed = held.filter((member) => member.rotationId === row.id);
    // Someone in "Everyone on the roster" with no row yet counts from the pool's average (`rosterCalibration`).
    const calibrated = rosterCalibration(
      listed.map((member) => ({
        stored: member.stored,
        joinsLate: member.joinsLate,
        isOn: member.isOn,
        weight: member.weight,
        calibration: member.calibration,
        count: counts.get(`${row.id}:${member.memberId}`) ?? 0,
      })),
    );
    return {
      id: row.id,
      ...(row.follows === 'everyone' ? { follows: 'everyone' as const } : {}),
      name: row.name,
      strategy: rulesOf(row).strategy,
      windowDays: row.windowDays === 7 || row.windowDays === 90 ? row.windowDays : 30,
      evenGap: row.evenGap,
      returning: rulesOf(row).returning,
      members: listed.map((member, index) => ({
        memberId: member.memberId,
        name: member.name,
        weight: member.weight,
        priority: member.priority,
        dailyCap: member.dailyCap,
        weeklyCap: member.weeklyCap,
        isOn: member.isOn,
        // Spec 0037, AC-1315: nothing about a colleague's calendar unless the reader is an admin.
        ...(everyone || member.memberId === me ? { hasCalendar: member.hasCalendar } : {}),
        ...(everyone || member.memberId === me
          ? {
              count: (counts.get(`${row.id}:${member.memberId}`) ?? 0) + (calibrated[index] ?? member.calibration),
              upcoming: upcoming.get(`${row.id}:${member.memberId}`) ?? 0,
            }
          : {}),
      })),
      pages: pageCounts.get(row.id) ?? 0,
      canChange: everyone,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
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
            : sql`exists (select 1 from ${rotationRoster} m where m.workspace_id = "rotations"."workspace_id"
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
    await membersChanged(
      tx,
      scope,
      row,
      input.members.map((member) => member.memberId),
      [],
    );
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

/**
 * Who is in a rotation changed (spec 0037, AC-1264): one `rotation.changed` row naming who joined and who left, and
 * each of them told, by the notice, when someone else made the change ("Added to the Sales rotation"). Nothing when
 * nobody joined or left.
 */
async function membersChanged(
  tx: WorkspaceTx,
  scope: EngineScope,
  rotation: { readonly id: string; readonly name: string },
  added: readonly string[],
  removed: readonly string[],
): Promise<void> {
  if (added.length === 0 && removed.length === 0) return;
  await writeAudit(tx, scope.workspaceId, scope.actor, {
    action: 'rotation.changed',
    targetType: 'rotation',
    targetId: rotation.id,
    before: { name: rotation.name },
    after: { name: rotation.name, added: [...added], removed: [...removed] },
  });
  const actor = memberOf(scope);
  if (actor === undefined) return;
  for (const memberId of [...new Set([...added, ...removed])]) {
    if (memberId !== actor) await queueSchedulingNotice(tx, actor, memberId);
  }
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
    if (input.members !== undefined) {
      if (row.follows === 'everyone') await setRosterSettings(tx, scope, row, input.members);
      else {
        checkMemberCount(input.members);
        await replaceMembers(tx, scope, row, input.members, now);
      }
      await checkStillBooks(tx, row.id);
    }
    return firstOf(await viewsOf(tx, scope, [row], now));
  });
}

/**
 * Refuses IN_USE when a change leaves the rotation with nobody who may take work (switched on, active, not a guest)
 * while a live page books through it (late trap #22): every booking on a round robin page seats one of each of its
 * rotations, so the page would stay Live offering no times at all, and nobody would be told. Pausing the page first,
 * or moving it to another rotation, lets the change through.
 */
async function checkStillBooks(tx: WorkspaceTx, rotationId: string): Promise<void> {
  if ((await eligibleMembers(tx, [rotationId])).get(rotationId)?.length !== 0) return;
  const pages = await tx
    .select({ title: bookingPages.title })
    .from(bookingPageRotations)
    .innerJoin(
      bookingPages,
      and(
        eq(bookingPages.workspaceId, bookingPageRotations.workspaceId),
        eq(bookingPages.id, bookingPageRotations.pageId),
      ),
    )
    .where(
      and(
        eq(bookingPageRotations.rotationId, rotationId),
        isNull(bookingPages.deletedAt),
        eq(bookingPages.status, 'live'),
      ),
    )
    .orderBy(asc(bookingPages.title));
  const [first] = pages;
  if (first === undefined) return;
  const named = pages.length === 1 ? `“${first.title}”` : `“${first.title}” and ${String(pages.length - 1)} more`;
  throw refuseOn(
    'IN_USE',
    `${named} ${pages.length === 1 ? 'books' : 'book'} through this group, so it needs someone switched on. Keep someone on, or pause ${pages.length === 1 ? 'that page' : 'those pages'} first.`,
    'members',
  );
}

/** A rotation of chosen people holds 2 to 20 (AC-728): the contract lets a roster change name up to 200. */
function checkMemberCount(list: readonly RotationMemberInput[]): void {
  // An empty list falls to the live page check (`checkStillBooks`), as it always has.
  if ((list.length > 0 && list.length < ROTATION_MEMBERS.min) || list.length > ROTATION_MEMBERS.max) {
    throw refuseOn(
      'CONFIG_INVALID',
      `A rotation holds ${String(ROTATION_MEMBERS.min)} to ${String(ROTATION_MEMBERS.max)} members.`,
      'members',
    );
  }
}

/**
 * Sets the own settings of the people named in "Everyone on the roster" (on or off, weight, priority, caps), each
 * stored as their row; nobody joins or leaves by it, since its members are the workspace's. Someone named who has
 * left the roster since the list was read (removed, or made a guest) is skipped. Rows not stored yet take the pool's
 * average now (AC-730), as their first assignment would have; then one update sets everyone named.
 */
async function setRosterSettings(
  tx: WorkspaceTx,
  scope: EngineScope,
  rotation: RotationRow,
  list: readonly RotationMemberInput[],
): Promise<void> {
  const listed = await tx
    .select({ memberId: rotationRoster.memberId })
    .from(rotationRoster)
    .where(
      and(
        eq(rotationRoster.rotationId, rotation.id),
        inArray(
          rotationRoster.memberId,
          list.map((member) => member.memberId),
        ),
      ),
    );
  const onRoster = new Set(listed.map((member) => member.memberId));
  const kept = list.filter((member) => onRoster.has(member.memberId));
  if (kept.length === 0) return;
  await keepRosterRows(
    tx,
    scope,
    rotation.id,
    kept.map((member) => member.memberId),
  );
  const by = actorRow(scope.actor);
  const values = sql.join(
    kept.map(
      (member) =>
        sql`(${member.memberId}::uuid, ${member.weight}::smallint, ${member.priority}::smallint, ${member.dailyCap}::smallint, ${member.weeklyCap}::smallint, ${member.isOn}::boolean)`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    update rotation_members m
    set weight = v.weight, priority = v.priority, daily_cap = v.daily_cap, weekly_cap = v.weekly_cap, is_on = v.is_on,
      updated_at = now(), updated_by_type = ${by.type}, updated_by_id = ${by.id}::uuid,
      updated_by_member_id = ${by.memberId}::uuid
    from (values ${values}) as v (member_id, weight, priority, daily_cap, weekly_cap, is_on)
    where m.workspace_id = ${scope.workspaceId}::uuid and m.rotation_id = ${rotation.id}::uuid and m.member_id = v.member_id
  `);
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
  await membersChanged(
    tx,
    scope,
    rotation,
    joining.map((member) => member.memberId),
    leaving.map((member) => member.memberId),
  );
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
 * Deletes a rotation no live page books from and no form gives owners from
 * (AC-758): refused IN_USE ("Used by 2 pages and 1 form") while one does; an
 * archived form doesn't hold it (restored, its leads get no owner until it
 * names another). Its ledger stays, for the bookings and leads it explains.
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
    const [owning] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(forms)
      .where(and(eq(forms.ownerRotationId, current.id), ne(forms.status, 'archived')));
    const formCount = owning?.count ?? 0;
    if (pages > 0 || formCount > 0) {
      const named = [
        ...(pages > 0 ? [`${String(pages)} ${pages === 1 ? 'page' : 'pages'}`] : []),
        ...(formCount > 0 ? [`${String(formCount)} ${formCount === 1 ? 'form' : 'forms'}`] : []),
      ];
      throw refuse('IN_USE', `Used by ${named.join(' and ')}. Move them to another rotation first.`);
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
