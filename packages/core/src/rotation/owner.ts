// A form lead's owner from a rotation (spec 0029 milestone 3, AC-755, AC-756;
// spec 0023 AC-567, AC-1050). Spec 0029's `assignOwner`, in two steps so the
// owner lands in the same write as the record it owns: `pickLeadOwner` runs
// first, inside the submission's transaction, takes the rotation's lock (the
// one bookings take, so leads and meetings share one fair count and the lock
// is held to commit) and picks; once the record exists, `recordLeadOwner`
// writes the ledger row (`source = form`) under that same lock.
//
// Who may take a lead now: switched on, active, not a guest (as for
// bookings), not waiting under Even, under their daily and weekly caps (a
// lead counts on the day it was assigned, in the member's own zone), and not
// on a day off today in their own zone (a date their default schedule gives
// no hours; a weekday without hours is not a day off, so a lead on a Saturday
// still gets an owner), and not on time off now (spec 0037, AC-1283). A record that already has an owner keeps them
// (AC-567): the rotation counts it to them (`owner`) when it sends returning
// people to their owner and the owner may take a lead now, and otherwise
// takes no turn; an owner away now (spec 0037, AC-1284) gives way to their
// stand in, when the stand in may take a lead now, whether or not they are in
// the rotation (reason `standin`; the record keeps its owner, and the lead and
// its notice go to the stand in). One lead never has two live assignments in one rotation:
// one already there answers again, and a submission filed a second time (its
// record went to the trash, Add to CRM) keeps the member it was given. The
// rotation gone, or nobody able to take the lead, is a typed answer, never a
// throw, so the submission still files with no owner (AC-756).
import { DateTime } from 'luxon';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isTimeZone } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { resolveMany } from '../availability/resolve.ts';
import { uuidArray } from '../engine/ids.ts';
import { awayAt } from '../scheduling/time-off.ts';
import { capStarts, lockRotation, windowCounts, windowStart, writeAssignment } from './ledger.ts';
import { evenWaiting, pickMember, type Candidate, type PickDetail, type Picked, type PickReason } from './pick.ts';
import { candidatesOf, eligibleMembers, rulesOf, underCaps, type RotationRules } from './team.ts';

const { rotationAssignments, rotations } = schema;

const DAY_MS = 86_400_000;

/** Why a lead got no owner from its rotation (AC-756). */
export type NoLeadOwner = 'none_available' | 'rotation_gone';

/** What picking a lead's owner from a rotation answered. */
export type LeadOwner =
  /** Picked now: the caller gives them the record, then writes the ledger row with `recordLeadOwner`. */
  | {
      readonly kind: 'picked';
      readonly rotationId: string;
      readonly memberId: string;
      readonly reason: PickReason;
      readonly detail: PickDetail & { readonly windowDays: number };
    }
  /** The rotation gave this lead to this member before: they get it again, and nothing more is counted. */
  | { readonly kind: 'held'; readonly rotationId: string; readonly memberId: string }
  /** The record keeps the owner it has, and the rotation takes no turn (AC-567). */
  | { readonly kind: 'kept'; readonly rotationId: string }
  /** Nobody: the record keeps no owner (AC-756). */
  | { readonly kind: 'none'; readonly rotationId: string; readonly reason: NoLeadOwner };

/** What picking reads besides the rotation: the record matched, if any, and what this submission was given before. */
export interface LeadOwnerInput {
  readonly workspaceId: string;
  readonly rotationId: string;
  readonly now: Date;
  /** The live record the submission matched (absent for a new one). */
  readonly recordId?: string;
  /** Whether that record has an owner, and the member it is when it is one. */
  readonly current?: { readonly memberId?: string };
  /** The member this rotation gave this submission before (filed again after its record went to the trash). */
  readonly previousMemberId?: string;
  /** Filing again into the record this submission filed into before (Sync): an owner it has is never counted again. */
  readonly again?: boolean;
}

/** The rotation, live; undefined when it was deleted. */
async function liveRotation(tx: WorkspaceTx, rotationId: string): Promise<RotationRules | undefined> {
  const [row] = await tx
    .select()
    .from(rotations)
    .where(and(eq(rotations.id, rotationId), isNull(rotations.deletedAt)));
  return row === undefined ? undefined : rulesOf(row);
}

/** Which of these members are active in the workspace now. */
async function activeOf(tx: WorkspaceTx, memberIds: readonly string[]): Promise<ReadonlySet<string>> {
  if (memberIds.length === 0) return new Set();
  const rows = await tx.execute<{ id: string }>(sql`
    select id::text from members where id = any(${uuidArray(memberIds)}) and status = 'active'
  `);
  return new Set(rows.rows.map((row) => row.id));
}

/**
 * Each member's own zone and whether today is a day off in it: their default
 * schedule (spec 0035), else the virtual default in their profile's zone, else
 * the workspace's.
 */
async function todayOf(
  tx: WorkspaceTx,
  memberIds: readonly string[],
  now: Date,
): Promise<ReadonlyMap<string, { readonly zone: string; readonly isDayOff: boolean }>> {
  if (memberIds.length === 0) return new Map();
  const zones = await tx.execute<{ id: string; zone: string | null }>(sql`
    select m.id::text, coalesce(m.time_zone, w.time_zone) as zone
    from members m join workspaces w on w.id = m.workspace_id
    where m.id = any(${uuidArray(memberIds)})
  `);
  const fallback = new Map(
    zones.rows.map((row) => [row.id, row.zone !== null && isTimeZone(row.zone) ? row.zone : 'UTC']),
  );
  const resolved = await resolveMany(
    tx,
    memberIds.map((memberId) => ({ memberId, fallbackZone: fallback.get(memberId) ?? 'UTC' })),
  );
  return new Map(
    memberIds.map((memberId, index) => {
      const hours = resolved[index]?.availability;
      const zone = hours?.timeZone ?? fallback.get(memberId) ?? 'UTC';
      const today = DateTime.fromJSDate(now, { zone }).toISODate();
      const isDayOff = hours?.overrides.some((day) => day.date === today && day.ranges.length === 0) === true;
      return [memberId, { zone, isDayOff }] as const;
    }),
  );
}

/** The rotation's members who may take a lead now, with their counts (see the file's header). */
async function openCandidates(tx: WorkspaceTx, rules: RotationRules, now: Date): Promise<readonly Candidate[]> {
  const pool = (await eligibleMembers(tx, [rules.id])).get(rules.id) ?? [];
  const ids = pool.map((member) => member.memberId);
  const counts = await windowCounts(tx, rules.id, windowStart(now, rules.windowDays));
  // A week either side, so the weekly cap counts the whole of this week in every member's zone. Read only when
  // someone in the pool has a cap: it reads the rotation's ledger, which leads grow by one row each.
  const capped = pool.some((member) => member.dailyCap !== null || member.weeklyCap !== null);
  const starts = capped
    ? await capStarts(tx, rules.id, ids, new Date(now.getTime() - 8 * DAY_MS), new Date(now.getTime() + 8 * DAY_MS))
    : new Map<string, readonly Date[]>();
  const today = await todayOf(tx, ids, now);
  // Away now (spec 0037, AC-1283): skipped, as a day off is.
  const away = await awayAt(tx, ids, now);
  const everyone = candidatesOf({ rules, members: pool }, { counts, starts });
  const waiting = rules.strategy === 'even' ? evenWaiting(everyone, rules.evenGap) : new Set<string>();
  return everyone.filter((candidate, index) => {
    const member = pool[index];
    const day = today.get(candidate.memberId);
    return (
      member !== undefined &&
      day !== undefined &&
      !waiting.has(candidate.memberId) &&
      !day.isDayOff &&
      !away.has(candidate.memberId) &&
      underCaps(member, starts.get(candidate.memberId) ?? [], day.zone, now)
    );
  });
}

/**
 * Whether a stand in outside the rotation may take a lead now (AC-1284): active and not a guest (`awayAt` names only
 * such a stand in), not away now themself, and not on a day off today in their own zone.
 */
async function mayTakeLeadNow(tx: WorkspaceTx, memberId: string, now: Date): Promise<boolean> {
  if ((await awayAt(tx, [memberId], now)).has(memberId)) return false;
  const day = (await todayOf(tx, [memberId], now)).get(memberId);
  return day !== undefined && !day.isDayOff;
}

/** The lead's live row in the rotation, if it has one (one per lead and rotation: the unique index). */
async function liveRow(
  tx: WorkspaceTx,
  recordId: string,
  rotationId: string,
): Promise<{ readonly id: string; readonly memberId: string } | undefined> {
  const [row] = await tx
    .select({ id: rotationAssignments.id, memberId: rotationAssignments.memberId })
    .from(rotationAssignments)
    .where(
      and(
        eq(rotationAssignments.recordId, recordId),
        eq(rotationAssignments.rotationId, rotationId),
        isNull(rotationAssignments.voidedAt),
      ),
    );
  return row;
}

/** A pick as `LeadOwner` answers it. */
const picked = (rules: RotationRules, pick: Picked): LeadOwner => ({
  kind: 'picked',
  rotationId: rules.id,
  memberId: pick.memberId,
  reason: pick.reason,
  detail: { ...pick.detail, windowDays: rules.windowDays },
});

/**
 * Picks who owns a form's lead (see the file's header), inside the caller's
 * transaction. Takes the rotation's lock, which stays held to commit: the
 * caller writes the record and then `recordLeadOwner` under it.
 */
export async function pickLeadOwner(tx: WorkspaceTx, input: LeadOwnerInput): Promise<LeadOwner> {
  const { rotationId, now } = input;
  await lockRotation(tx, input.workspaceId, rotationId);
  const kept: LeadOwner = { kind: 'kept', rotationId };
  const rules = await liveRotation(tx, rotationId);
  if (rules === undefined)
    return input.current === undefined ? { kind: 'none', rotationId, reason: 'rotation_gone' } : kept;
  const live = input.recordId === undefined ? undefined : await liveRow(tx, input.recordId, rotationId);

  if (input.current !== undefined) {
    // A record with an owner keeps them (AC-567). Owner first (AC-739, AC-755): the lead counts to that owner when
    // the rotation sends returning people to their owner, the owner may take a lead now, and it isn't counted yet.
    const ownerId = input.current.memberId;
    if (live !== undefined || input.again === true || rules.returning !== 'owner' || ownerId === undefined) return kept;
    const open = await openCandidates(tx, rules, now);
    // Away now with a stand in (AC-1284): the stand in takes the lead in the owner's place.
    const standinId = (await awayAt(tx, [ownerId], now)).get(ownerId);
    const pick = pickMember(open, rules, { ownerId, ...(standinId === undefined ? {} : { standinId }) });
    if (pick?.reason === 'owner' || pick?.reason === 'standin') return picked(rules, pick);
    if (standinId !== undefined && !open.some((each) => each.memberId === standinId)) {
      // Outside the rotation: they take it when free of time off and a day off today; it counts toward no share.
      if (await mayTakeLeadNow(tx, standinId, now)) {
        return picked(rules, {
          memberId: standinId,
          reason: 'standin',
          detail: { strategy: rules.strategy, compared: [] },
        });
      }
    }
    return kept;
  }

  // Given before (its live row, or this submission's earlier pick): theirs again while they are still here.
  const earlier = live?.memberId ?? input.previousMemberId;
  if (earlier !== undefined) {
    if ((await activeOf(tx, [earlier])).has(earlier)) return { kind: 'held', rotationId, memberId: earlier };
    // The member it went to has left: their row stops counting, and the lead is picked again.
    if (live !== undefined) {
      await tx
        .update(rotationAssignments)
        .set({ voidedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(rotationAssignments.id, live.id));
    }
  }
  const pick = pickMember(await openCandidates(tx, rules, now), rules);
  return pick === undefined ? { kind: 'none', rotationId, reason: 'none_available' } : picked(rules, pick);
}

/**
 * Writes a picked lead's ledger row once its record exists (`source = form`),
 * as the scope's actor (the form, or the member filing it), in the
 * transaction that still holds the rotation's lock. What the row says beside
 * the pick: the form and the submission.
 */
export async function recordLeadOwner(
  tx: WorkspaceTx,
  scope: EngineScope,
  picked: Extract<LeadOwner, { kind: 'picked' }>,
  input: { readonly recordId: string; readonly formId: string; readonly submissionId: string },
): Promise<string> {
  return writeAssignment(tx, scope, {
    rotationId: picked.rotationId,
    memberId: picked.memberId,
    source: 'form',
    recordId: input.recordId,
    reason: picked.reason,
    detail: { ...picked.detail, formId: input.formId, submissionId: input.submissionId },
  });
}
