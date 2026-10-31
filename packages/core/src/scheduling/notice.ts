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
// `scheduling_changed` email through the workspace email queue, and the same
// notice in the member's inbox (spec 0038). Nothing is sent when the changes
// cancel out. The rows are a schedule's (`schedule.changed`), time off's
// (`time_off.*`), meeting limits' (`limits.changed`), a personal booking
// page's (`booking_page.changed_for`), all aimed at the member, and a
// rotation's (`rotation.changed`, aimed at the rotation) that added or
// removed them.
import { sql } from 'drizzle-orm';
import { clockLabel } from '@crm/contracts/hours';
import type { SchedulingChangedEmail } from '@crm/contracts/emails';
import type { WorkspaceTx } from '@crm/db';
import { queueEmail } from '../emails/queue.ts';
import { isUuid } from '../engine/ids.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { notifySchedulingChanged } from '../notifications/notify.ts';

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
export const NOTICE_ACTIONS = [
  'schedule.changed',
  'time_off.created',
  'time_off.changed',
  'time_off.deleted',
  'limits.changed',
  'booking_page.changed_for',
] as const;

/** How long a notice gathers changes, from the first (AC-1264); the queue function holds the same. */
export const NOTICE_WINDOW_MINUTES = 10;

/** The most lines one email lists; the rest are counted. */
export const NOTICE_LINES_MAX = 30;

/** The longest line an email takes (`SchedulingChangedEmail`'s lines); a longer one ends in an ellipsis. */
const LINE_MAX = 200;

/** The most rows one run folds; past it, the run queues the next one for the rest. */
const ROWS_MAX = 500;

/**
 * A line cut to what the email takes (its length in UTF-16 units, as the schema counts), so one long day never
 * refuses the whole email. A lone surrogate left at the cut is dropped.
 */
const fitted = (line: string): string =>
  line.length <= LINE_MAX
    ? line
    : `${line
        .slice(0, LINE_MAX - 1)
        .replace(/[\uD800-\uDBFF]$/, '')
        .trimEnd()}…`;

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
  return lines.map(fitted);
}

const REASON_WORDS: Readonly<Record<string, string>> = {
  vacation: 'Vacation',
  sick: 'Sick leave',
  travel: 'Travel',
  holiday: 'Public holiday',
  other: 'Other',
};

/** One side of a `time_off.*` row, read defensively: the entry's id, dates and reason, never a note. */
function awayOf(side: unknown): { id: string; fromDate: string; toDate: string; reason?: string } | undefined {
  if (typeof side !== 'object' || side === null) return undefined;
  const { timeOffId, fromDate, toDate, reason } = side as Record<string, unknown>;
  if (typeof timeOffId !== 'string' || typeof fromDate !== 'string' || typeof toDate !== 'string') return undefined;
  return { id: timeOffId, fromDate, toDate, ...(typeof reason === 'string' ? { reason } : {}) };
}

/** "3 Nov" or "3 Nov to 7 Nov", read as calendar dates. */
function daysLabel(fromDate: string, toDate: string): string {
  const day = (date: string) => dateLabel(date).replace(/^\w+,?\s/, '');
  return fromDate === toDate ? day(fromDate) : `${day(fromDate)} to ${day(toDate)}`;
}

/**
 * The lines a notice lists for a run of time off rows, oldest first (pure, AC-1264): each entry's first before
 * against its last after, so an entry added and removed in one window says nothing. "Time off added: Vacation, 3
 * Nov to 7 Nov"; "Time off changed: Sick leave, 4 Nov to 5 Nov"; "Time off removed: 3 Nov to 7 Nov". Never a note.
 */
export function timeOffLines(rows: readonly { readonly before: unknown; readonly after: unknown }[]): string[] {
  const folded = new Map<string, { first: ReturnType<typeof awayOf>; last: ReturnType<typeof awayOf> }>();
  for (const row of rows) {
    const before = awayOf(row.before);
    const after = awayOf(row.after);
    const id = before?.id ?? after?.id;
    if (id === undefined) continue;
    const item = folded.get(id);
    if (item === undefined) folded.set(id, { first: before, last: after });
    else item.last = after;
  }
  const lines: string[] = [];
  const words = (entry: NonNullable<ReturnType<typeof awayOf>>) =>
    `${REASON_WORDS[entry.reason ?? ''] ?? 'Away'}, ${daysLabel(entry.fromDate, entry.toDate)}`;
  for (const { first, last } of folded.values()) {
    if (first === undefined && last === undefined) continue;
    if (first === undefined && last !== undefined) lines.push(`Time off added: ${words(last)}`);
    else if (last === undefined && first !== undefined)
      lines.push(`Time off removed: ${daysLabel(first.fromDate, first.toDate)}`);
    else if (first !== undefined && last !== undefined && words(first) !== words(last)) {
      lines.push(`Time off changed: ${words(last)}`);
    }
  }
  return lines.map(fitted);
}

/** One side of a `limits.changed` row, read defensively: each limit set, or none. */
function limitsOf(side: unknown): { readonly perDay?: number; readonly perWeek?: number } {
  if (typeof side !== 'object' || side === null) return {};
  const { perDay, perWeek } = side as Record<string, unknown>;
  return {
    ...(typeof perDay === 'number' ? { perDay } : {}),
    ...(typeof perWeek === 'number' ? { perWeek } : {}),
  };
}

/**
 * The lines a notice lists for a run of `limits.changed` rows, oldest first (pure, AC-1264): the first before
 * against the last after, a line per limit that ends differently. "Meetings a day: at most 4 (was no limit)";
 * "Meetings a week: no limit (was at most 20)".
 */
export function limitsLines(rows: readonly { readonly before: unknown; readonly after: unknown }[]): string[] {
  const first = rows[0];
  const last = rows.at(-1);
  if (first === undefined || last === undefined) return [];
  const was = limitsOf(first.before);
  const now = limitsOf(last.after);
  const words = (value: number | undefined) => (value === undefined ? 'no limit' : `at most ${String(value)}`);
  const lines: string[] = [];
  if (was.perDay !== now.perDay) lines.push(`Meetings a day: ${words(now.perDay)} (was ${words(was.perDay)})`);
  if (was.perWeek !== now.perWeek) lines.push(`Meetings a week: ${words(now.perWeek)} (was ${words(was.perWeek)})`);
  return lines.map(fitted);
}

const LOCATION_WORDS: Readonly<Record<string, string>> = {
  video: 'Video call',
  phone: 'Phone',
  address: 'In person',
  custom: 'Custom place',
};

const VIEW_WORDS: Readonly<Record<string, string>> = { month: 'Month', list: 'List', chat: 'Chat' };

/** Minutes as a page's settings show them: "45 min", "1 h 30 min", "none" for 0. */
function minutesWords(value: unknown): string {
  if (typeof value !== 'number' || value === 0) return 'none';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours === 0) return `${String(minutes)} min`;
  return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`;
}

/** The lengths a page offers: "30 min", "30 or 60 min". */
function lengthsWords(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return 'none';
  const numbers = value.filter((each): each is number => typeof each === 'number');
  if (numbers.length <= 1) return `${String(numbers[0] ?? 0)} min`;
  return `${numbers.slice(0, -1).join(', ')} or ${String(numbers.at(-1) ?? 0)} min`;
}

/** One field's change on a page, as a notice line's end, or undefined for a change it doesn't word. */
function pageChange(field: string, from: unknown, to: unknown, scheduleName: string | undefined): string | undefined {
  const fromTo = (words: (value: unknown) => string, label: string) =>
    `${label} changed from ${words(from)} to ${words(to)}`;
  switch (field) {
    case 'status':
      return to === 'paused' ? 'turned off' : 'turned on';
    case 'durations':
      return fromTo(lengthsWords, 'length');
    case 'location':
      return fromTo((value) => LOCATION_WORDS[String(value)] ?? 'somewhere else', 'location');
    case 'scheduleId':
      return to === null ? 'now books by the default schedule' : `now books by ${scheduleName ?? 'another schedule'}`;
    case 'bufferBefore':
      return fromTo(minutesWords, 'buffer before');
    case 'bufferAfter':
      return fromTo(minutesWords, 'buffer after');
    case 'minNoticeMinutes':
      return fromTo(minutesWords, 'minimum notice');
    case 'windowDays':
      return fromTo((value) => `${String(value)} days`, 'booking window');
    case 'dailyLimit':
      return fromTo((value) => (typeof value === 'number' ? String(value) : 'no limit'), 'max per day');
    case 'slotStep':
      return fromTo(
        (value) => (typeof value === 'number' ? `every ${String(value)} min` : 'the length'),
        'start times',
      );
    case 'isPrivate':
      return to === true ? 'now Link only' : 'now Public';
    case 'description':
      return 'description changed';
    case 'questions':
      return 'questions changed';
    case 'rescheduleHost':
      return to === 'rotation' ? 'a reschedule may go to someone else' : 'a reschedule keeps the same host';
    case 'defaultView':
      return fromTo((value) => VIEW_WORDS[String(value)] ?? 'Month', 'opens in');
    case 'fileToCrm':
      return to === true ? 'bookers now added to People' : 'bookers no longer added to People';
    case 'answersObjectId':
      return 'where answers are filed changed';
    default:
      return undefined;
  }
}

/** One side of a `booking_page.changed_for` row, read defensively. */
interface PageSide {
  readonly pageId: string;
  readonly title: string;
  readonly scheduleName?: string;
  readonly deleted: boolean;
  readonly fields: Readonly<Record<string, unknown>>;
}

function pageSideOf(side: unknown): PageSide | undefined {
  if (typeof side !== 'object' || side === null) return undefined;
  const { pageId, title, scheduleName, deleted, fields } = side as Record<string, unknown>;
  if (typeof pageId !== 'string' || typeof title !== 'string') return undefined;
  return {
    pageId,
    title,
    ...(typeof scheduleName === 'string' ? { scheduleName } : {}),
    deleted: deleted === true,
    fields: typeof fields === 'object' && fields !== null ? (fields as Record<string, unknown>) : {},
  };
}

/** One page folded over a notice's window. */
interface FoldedPage {
  title: string;
  readonly firstTitle: string;
  scheduleName: string | undefined;
  deleted: boolean;
  readonly from: Map<string, unknown>;
  readonly to: Map<string, unknown>;
}

/**
 * The lines a notice lists for a run of `booking_page.changed_for` rows, oldest first (pure, AC-1264): each page's
 * fields, first before against last after, so a change undone in the window says nothing. "Intro call: location
 * changed from Video call to Phone"; "Page renamed: Intro call to First chat"; "Intro call: page deleted".
 */
export function pageLines(rows: readonly { readonly before: unknown; readonly after: unknown }[]): string[] {
  const folded = new Map<string, FoldedPage>();
  for (const row of rows) {
    const before = pageSideOf(row.before);
    const after = pageSideOf(row.after);
    if (before === undefined || after === undefined) continue;
    let item = folded.get(after.pageId);
    if (item === undefined) {
      item = {
        title: after.title,
        firstTitle: before.title,
        scheduleName: undefined,
        deleted: false,
        from: new Map(),
        to: new Map(),
      };
      folded.set(after.pageId, item);
    }
    item.title = after.title;
    if (after.scheduleName !== undefined) item.scheduleName = after.scheduleName;
    if (after.deleted) item.deleted = true;
    for (const [field, value] of Object.entries(before.fields)) if (!item.from.has(field)) item.from.set(field, value);
    for (const [field, value] of Object.entries(after.fields)) item.to.set(field, value);
  }
  const lines: string[] = [];
  for (const item of folded.values()) {
    if (item.deleted) {
      lines.push(`${item.firstTitle}: page deleted`);
      continue;
    }
    for (const [field, to] of item.to) {
      const from = item.from.get(field);
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      if (field === 'title') {
        lines.push(`Page renamed: ${String(from)} to ${String(to)}`);
        continue;
      }
      const words = pageChange(field, from, to, item.scheduleName);
      if (words !== undefined) lines.push(`${item.title}: ${words}`);
    }
  }
  return lines.map(fitted);
}

/**
 * The lines a notice lists for a run of `rotation.changed` rows that added or removed `memberId`, oldest first
 * (pure, AC-1264): where each rotation leaves them against where it found them, so added then removed in one window
 * says nothing. "Added to the Sales rotation"; "Removed from the Sales rotation".
 */
export function rotationLines(
  memberId: string,
  rows: readonly { readonly targetId: string | null; readonly after: unknown }[],
): string[] {
  const folded = new Map<string, { name: string; readonly first: boolean; last: boolean }>();
  for (const row of rows) {
    if (row.targetId === null || typeof row.after !== 'object' || row.after === null) continue;
    const { name, added, removed } = row.after as Record<string, unknown>;
    const joined = Array.isArray(added) && added.includes(memberId);
    const left = Array.isArray(removed) && removed.includes(memberId);
    if (joined === left) continue;
    const item = folded.get(row.targetId);
    // In it before the first change exactly when that change took them out.
    if (item === undefined) {
      folded.set(row.targetId, { name: typeof name === 'string' ? name : '', first: left, last: joined });
    } else {
      item.last = joined;
      if (typeof name === 'string') item.name = name;
    }
  }
  const lines: string[] = [];
  for (const item of folded.values()) {
    if (item.first === item.last) continue;
    const rotation = item.name === '' ? 'a rotation' : `the ${item.name} rotation`;
    lines.push(item.last ? `Added to ${rotation}` : `Removed from ${rotation}`);
  }
  return lines.map(fitted);
}

/** What one notice run did: queued the email, found it queued already, had nothing to tell, or the member left. */
export type SchedulingNoticeOutcome = 'queued' | 'exists' | 'nothing' | 'gone' | 'refused';

/**
 * The worker's `crm_scheduling_notice` (AC-1264), as the system in the workspace: the actor's rows about the
 * member since the last notice for the pair (never more than a day back), folded into lines, queued as one
 * `scheduling_changed` email keyed by the last row told, so a retry makes the same email once.
 */
export async function runSchedulingNotice(
  scope: EngineScope,
  input: { readonly actorMemberId: string; readonly memberId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<SchedulingNoticeOutcome> {
  if (scope.access.principal.kind !== 'system') {
    throw new Error('Only the system tells a member of a change to their scheduling (the worker’s task).');
  }
  const { actorMemberId: actor, memberId: member } = input;
  if (!isUuid(actor) || !isUuid(member) || actor === member) return 'nothing';
  const { result } = await runWrite(
    scope,
    async (context): Promise<SchedulingNoticeOutcome> => {
      const { tx } = context;
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
      // From the last row told on; when that row is gone, the day's bound alone.
      const after =
        lastTold !== undefined && isUuid(lastTold)
          ? sql`and (
            not exists (select 1 from audit_events p where p.id = ${lastTold}::uuid)
            or (a.at, a.id) > (select p.at, p.id from audit_events p where p.id = ${lastTold}::uuid)
          )`
          : sql``;
      // The member's own rows, and a rotation's that added or removed them.
      const rows = await tx.execute<{
        id: string;
        action: string;
        target_id: string | null;
        before: unknown;
        after: unknown;
      }>(sql`
      select a.id::text as id, a.action, a.target_id, a.before, a.after
      from audit_events a
      where a.actor_member_id = ${actor}::uuid
        and (
          (a.target_type = 'member' and a.target_id = ${member} and a.action in (${sql.join(
            NOTICE_ACTIONS.map((action) => sql`${action}`),
            sql`, `,
          )}))
          or (a.action = 'rotation.changed' and a.target_type = 'rotation'
            and (a.after -> 'added' @> to_jsonb(${member}::text) or a.after -> 'removed' @> to_jsonb(${member}::text)))
        )
        and a.at > now() - interval '1 day' ${after}
      order by a.at, a.id
      limit ${ROWS_MAX}
    `);
      const last = rows.rows.at(-1);
      if (last === undefined) return 'nothing';
      // More than one run holds: the next one, queued now, tells the rest.
      if (rows.rows.length === ROWS_MAX) await queueSchedulingNotice(tx, actor, member);
      const lines = [
        ...noticeLines(rows.rows.filter((row) => row.action === 'schedule.changed')),
        ...timeOffLines(rows.rows.filter((row) => row.action.startsWith('time_off.'))),
        ...limitsLines(rows.rows.filter((row) => row.action === 'limits.changed')),
        ...pageLines(rows.rows.filter((row) => row.action === 'booking_page.changed_for')),
        ...rotationLines(
          member,
          rows.rows
            .filter((row) => row.action === 'rotation.changed')
            .map((row) => ({ targetId: row.target_id, after: row.after })),
        ),
      ];
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
      // The same notice in their inbox (spec 0038): once, with the email that was newly queued.
      if (
        queued.outcome === 'queued' &&
        (await notifySchedulingChanged(tx, { workspaceId: scope.workspaceId, memberId: member, actorMemberId: actor }))
      ) {
        context.record({ notifications: [member] });
      }
      return queued.outcome;
    },
    hooks,
  );
  return result;
}
