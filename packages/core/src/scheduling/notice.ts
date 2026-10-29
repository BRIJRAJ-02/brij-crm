// The member told (spec 0037, AC-1264): changes someone else makes to a
// member's scheduling are gathered per actor for ten minutes from the first
// and sent as one email, "Priya changed your scheduling", a line each.
//
// Every change writes its audit row in its own transaction and queues
// `crm_scheduling_notice` there (`queueSchedulingNotice`, migration 0122: run
// ten minutes on, keyed `scheduling-notice:<workspace>:<actor>:<member>` with
// `preserve_run_at`, so a burst is one waiting row keeping its first time).
// When it runs (`runSchedulingNotice`, the worker's task, as the system), it
// reads that actor's rows about that member since the last notice it queued
// for the pair (the previous email's key ends with the last row it told, so a
// retried run makes the same email once), folds them into each item's first
// before and last after, drops what ends as it began, and queues one
// `scheduling_changed` email through the workspace email queue. Nothing is
// sent when the changes cancel out. Today the rows are a schedule's
// (`schedule.changed`); time off, limits, personal pages and rotations add
// their actions to `NOTICE_ACTIONS` as their jobs land.
import { sql } from 'drizzle-orm';
import { clockLabel } from '@crm/contracts/hours';
import type { SchedulingChangedEmail } from '@crm/contracts/emails';
import type { WorkspaceTx } from '@crm/db';
import { inWorkspace } from '../access/run.ts';
import { queueEmail } from '../emails/queue.ts';
import { isUuid } from '../engine/ids.ts';
import type { EngineScope } from '../engine/scope.ts';

/** A schedule as an audit row keeps it (`schedule.changed`): its fields, a day off's note never. */
export interface ScheduleAudited {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly timeZone: string;
  readonly weekly: Readonly<Record<string, readonly (readonly [string, string])[]>>;
  readonly overrides: readonly { readonly date: string; readonly ranges: readonly (readonly [string, string])[] }[];
}

/** The fields an audit row compares, and keeps only when they changed. */
export const SCHEDULE_AUDIT_FIELDS = ['name', 'isDefault', 'timeZone', 'weekly', 'overrides'] as const;

/** One schedule on one side of an audit row: its id and name, and the fields that changed. */
export type ScheduleAuditEntry = { readonly id: string; readonly name: string } & Partial<
  Omit<ScheduleAudited, 'id' | 'name'>
>;

/** The audit actions a notice tells (AC-1264). */
export const NOTICE_ACTIONS = ['schedule.changed'] as const;

/** How long a notice gathers changes, from the first (AC-1264); the queue function holds the same. */
export const NOTICE_WINDOW_MINUTES = 10;

/** The most lines one email lists; the rest are counted. */
export const NOTICE_LINES_MAX = 30;

/**
 * Queues the member's notice in the change's transaction (AC-1264): ten minutes on, one waiting row per actor and
 * member however many changes. `crm_enqueue_scheduling_notice` builds the row itself, ids only.
 */
export async function queueSchedulingNotice(tx: WorkspaceTx, actorMemberId: string, memberId: string): Promise<void> {
  await tx.execute(sql`select crm_enqueue_scheduling_notice(${actorMemberId}::uuid, ${memberId}::uuid)`);
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const DAY_NAMES: Readonly<Record<(typeof WEEKDAYS)[number], string>> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** A day's ranges in words: "9:00 AM to 5:00 PM, 6:00 PM to 8:00 PM", or "Closed". */
function rangesLabel(ranges: readonly (readonly [string, string])[] | undefined): string {
  if (ranges === undefined || ranges.length === 0) return 'Closed';
  return ranges.map(([start, end]) => `${clockLabel(start, 'en-US')} to ${clockLabel(end, 'en-US')}`).join(', ');
}

/** "Tue 3 Nov" for a `YYYY-MM-DD`, read as a calendar date. */
function dateLabel(date: string): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** One stored side of a `schedule.changed` row, read defensively. */
function entriesOf(side: unknown): readonly ScheduleAuditEntry[] {
  if (typeof side !== 'object' || side === null) return [];
  const { schedules } = side as { readonly schedules?: unknown };
  if (!Array.isArray(schedules)) return [];
  return schedules.filter(
    (each): each is ScheduleAuditEntry =>
      typeof each === 'object' &&
      each !== null &&
      typeof (each as { id?: unknown }).id === 'string' &&
      typeof (each as { name?: unknown }).name === 'string',
  );
}

/** One schedule's first state before the window and last state after it, field by field. */
interface Folded {
  existedBefore: boolean;
  existsAfter: boolean;
  nameBefore: string;
  nameAfter: string;
  readonly before: Partial<Record<(typeof SCHEDULE_AUDIT_FIELDS)[number], unknown>>;
  readonly after: Partial<Record<(typeof SCHEDULE_AUDIT_FIELDS)[number], unknown>>;
}

/**
 * The lines a notice lists for a run of `schedule.changed` rows, oldest first (pure): each schedule's first before
 * against its last after, field by field, so changes that cancel out say nothing. "Working hours, Monday: 9:00 AM
 * to 5:00 PM became 10:00 AM to 6:00 PM"; "New schedule: Evenings"; "Working hours, date override added, Tue 3
 * Nov: Closed".
 */
export function noticeLines(rows: readonly { readonly before: unknown; readonly after: unknown }[]): string[] {
  const folded = new Map<string, Folded>();
  for (const row of rows) {
    const before = entriesOf(row.before);
    const after = entriesOf(row.after);
    const ids = new Set([...before.map((each) => each.id), ...after.map((each) => each.id)]);
    for (const id of ids) {
      const was = before.find((each) => each.id === id);
      const now = after.find((each) => each.id === id);
      let item = folded.get(id);
      if (item === undefined) {
        item = {
          existedBefore: was !== undefined,
          existsAfter: true,
          nameBefore: (was ?? now)?.name ?? '',
          nameAfter: (now ?? was)?.name ?? '',
          before: {},
          after: {},
        };
        folded.set(id, item);
      }
      item.existsAfter = now !== undefined;
      if (now !== undefined) item.nameAfter = now.name;
      for (const field of SCHEDULE_AUDIT_FIELDS) {
        if (was !== undefined && field in was && !(field in item.before)) item.before[field] = was[field];
        if (now !== undefined && field in now) item.after[field] = now[field];
      }
    }
  }
  const lines: string[] = [];
  for (const item of folded.values()) {
    if (!item.existedBefore && !item.existsAfter) continue;
    if (!item.existedBefore) {
      lines.push(`New schedule: ${item.nameAfter}`);
      continue;
    }
    if (!item.existsAfter) {
      lines.push(`Schedule deleted: ${item.nameBefore}`);
      continue;
    }
    const changed = (field: (typeof SCHEDULE_AUDIT_FIELDS)[number]) =>
      field in item.after && JSON.stringify(item.before[field]) !== JSON.stringify(item.after[field]);
    const name = item.nameAfter;
    if (changed('name')) lines.push(`Schedule renamed: ${item.nameBefore} to ${name}`);
    if (changed('isDefault') && item.after.isDefault === true) lines.push(`${name} is now your default schedule`);
    if (changed('timeZone')) lines.push(`${name}: time zone changed to ${String(item.after.timeZone)}`);
    if (changed('weekly')) {
      const was = (item.before.weekly ?? {}) as ScheduleAudited['weekly'];
      const now = (item.after.weekly ?? {}) as ScheduleAudited['weekly'];
      for (const day of WEEKDAYS) {
        const from = rangesLabel(was[day]);
        const to = rangesLabel(now[day]);
        if (from !== to) lines.push(`${name}, ${DAY_NAMES[day]}: ${from} became ${to}`);
      }
    }
    if (changed('overrides')) {
      const byDate = (list: unknown) =>
        new Map(
          (Array.isArray(list) ? (list as ScheduleAudited['overrides']) : []).map((each) => [
            each.date,
            rangesLabel(each.ranges),
          ]),
        );
      const was = byDate(item.before.overrides);
      const now = byDate(item.after.overrides);
      for (const date of [...new Set([...was.keys(), ...now.keys()])].sort()) {
        const from = was.get(date);
        const to = now.get(date);
        if (from === to) continue;
        if (from === undefined) lines.push(`${name}, date override added, ${dateLabel(date)}: ${String(to)}`);
        else if (to === undefined) lines.push(`${name}, date override removed, ${dateLabel(date)}`);
        else lines.push(`${name}, ${dateLabel(date)}: ${from} became ${to}`);
      }
    }
  }
  return lines;
}

/** What one notice run did: queued the email, found it queued already, had nothing to tell, or the member left. */
export type SchedulingNoticeOutcome = 'queued' | 'exists' | 'nothing' | 'gone';

/**
 * The worker's `crm_scheduling_notice` (AC-1264), as the system in the workspace: the actor's rows about the
 * member since the last notice for the pair (never more than a day back), folded into lines, queued as one
 * `scheduling_changed` email keyed by the last row told, so a retry makes the same email once.
 */
export async function runSchedulingNotice(
  scope: EngineScope,
  input: { readonly actorMemberId: string; readonly memberId: string },
): Promise<SchedulingNoticeOutcome> {
  if (scope.access.principal.kind !== 'system') {
    throw new Error('Only the system tells a member of a change to their scheduling (the worker’s task).');
  }
  const { actorMemberId: actor, memberId: member } = input;
  if (!isUuid(actor) || !isUuid(member) || actor === member) return 'nothing';
  return inWorkspace(scope, async (tx) => {
    const people = await tx.execute<{ id: string; name: string; active: boolean; slug: string }>(sql`
      select m.id::text as id, m.name, m.status = 'active' as active, w.slug
      from members m join workspaces w on w.id = m.workspace_id
      where m.id in (${actor}::uuid, ${member}::uuid)
    `);
    const told = people.rows.find((row) => row.id === member);
    if (told === undefined || !told.active) return 'gone';
    const actorName = people.rows.find((row) => row.id === actor)?.name ?? 'Someone';
    const prefix = `scheduling_changed:${actor}:${member}:`;
    // The last row the pair's previous notice told: the end of its key.
    const previous = await tx.execute<{ key: string }>(sql`
      select key from emails
      where to_member_id = ${member}::uuid and kind = 'scheduling_changed' and starts_with(key, ${prefix})
      order by created_at desc, id desc
      limit 1
    `);
    const lastTold = previous.rows[0]?.key.slice(prefix.length);
    const after =
      lastTold !== undefined && isUuid(lastTold)
        ? sql`and (a.at, a.id) > (select p.at, p.id from audit_events p where p.id = ${lastTold}::uuid)`
        : sql``;
    const rows = await tx.execute<{ id: string; before: unknown; after: unknown }>(sql`
      select a.id::text as id, a.before, a.after
      from audit_events a
      where a.target_type = 'member' and a.target_id = ${member} and a.actor_member_id = ${actor}::uuid
        and a.action in (${sql.join(
          NOTICE_ACTIONS.map((action) => sql`${action}`),
          sql`, `,
        )})
        and a.at > now() - interval '1 day' ${after}
      order by a.at, a.id
      limit 500
    `);
    const last = rows.rows.at(-1);
    if (last === undefined) return 'nothing';
    const lines = noticeLines(rows.rows);
    if (lines.length === 0) return 'nothing';
    const params: SchedulingChangedEmail = {
      actorName,
      lines: lines.slice(0, NOTICE_LINES_MAX),
      more: Math.max(0, lines.length - NOTICE_LINES_MAX),
      availabilityPath: `/w/${told.slug}/bookings/availability`,
    };
    const queued = await queueEmail(tx, {
      kind: 'scheduling_changed',
      ids: [actor, member, last.id],
      to: { memberId: member },
      params,
    });
    return queued.outcome === 'refused' ? 'nothing' : queued.outcome;
  });
}
