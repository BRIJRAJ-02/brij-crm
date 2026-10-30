// The inbox (spec 0038): a member's own notifications and email settings.
// Every function acts on the caller's own rows only and takes no member id
// (AC-1181). What a notification is about is resolved through the access
// door when it is read (AC-1166): a comment's record through `readRecords`
// with the reader's access (live, on a live object they may read, inside
// their record rule), a task through the task rule (`readTaskViews`), a form's
// new submission as the reader may open it (`submissionNotices`, spec 0023
// AC-568). One the reader may not see is absent from the list and the count,
// and comes back if access returns. Marks and settings go through `runWrite`, so the member's
// other tabs hear of them through one `notifications` outbox row naming them.
import { sql, type SQL } from 'drizzle-orm';
import {
  excerptOf,
  NOTIFICATION_COUNT_CAP,
  NOTIFICATION_EXCERPT,
  NOTIFICATION_MARK_MAX,
  NOTIFICATION_PAGE,
  NotificationCursor,
  type NotificationCount,
  type NotificationKind,
  type NotificationPage,
  type NotificationSettings,
  type NotificationStatus,
  type NotificationView,
} from '@crm/contracts';
import type { RecordRefDisplay } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { checkScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { canonicalId, isUuid, uuidList } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import type { Actor, EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { submissionNotices } from '../forms/submissions.ts';
import { linkedDisplays, readTaskViews } from '../tasks/tasks.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';

/** What a notification id that isn't the caller's (or doesn't exist) answers. */
export const UNKNOWN_NOTIFICATION = 'That notification does not exist.';
/** What a cursor the server didn't make answers, on `cursor`. */
export const NOTIFICATION_CURSOR_MESSAGE = 'That inbox cursor is not valid here. Start again from the top.';
/** What turning the digest on without a time zone answers, on `timeZone`. */
export const DIGEST_ZONE_MESSAGE = 'The daily digest needs your time zone.';

/** A time zone the database doesn't know, so the digest's hour can't be read in it. */
export const UNKNOWN_ZONE_MESSAGE = 'That time zone is not known. Pick a city name, such as Europe/London.';

/** How many times a page reads further to fill itself past notifications the reader may not see. */
const READ_AHEAD = 3;

/** The settings a member has before they change anything (AC-1179). */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = Object.freeze({
  emailMentions: true,
  emailReplies: false,
  emailAssignments: true,
  digest: false,
  version: 0,
});

/** A moment as fixed width UTC text with milliseconds. */
const millis = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
/** A moment with microseconds, for cursors. */
const micros = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

/** The member the caller is, or undefined for a principal that isn't a member (a key has no inbox). */
function callerOf(scope: EngineScope): string | undefined {
  const { access, actor } = scope;
  if (access.principal.kind !== 'member' || actor.type !== 'member' || actor.id === null) return undefined;
  return actor.id;
}

/** The caller as a member, or `NOT_FOUND`: only a member has notifications to change. */
function memberOrUnknown(scope: EngineScope): string {
  const me = callerOf(scope);
  if (me === undefined) throw refuse('NOT_FOUND', UNKNOWN_NOTIFICATION);
  return me;
}

/** A stored notification, with its comment's text when it has one. */
interface NotificationRow extends Record<string, unknown> {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly actor_type: Actor['type'];
  readonly actor_id: string | null;
  readonly created_at: string;
  readonly read_at: string | null;
  readonly done_at: string | null;
  readonly record_id: string | null;
  readonly thread_id: string | null;
  readonly comment_id: string | null;
  readonly task_id: string | null;
  readonly note_id: string | null;
  readonly submission_id: string | null;
  readonly join_request_id: string | null;
  /** An open join request's name (null once it was decided). */
  readonly join_name: string | null;
  /** An automation's notice (parity #53): its automation, the first notify message it holds, and a due task. */
  readonly automation_id: string | null;
  readonly automation_message: string | null;
  readonly due_task_id: string | null;
  readonly due_title: string | null;
  readonly body: string | null;
  /** A note mention's note title, while the note is live (null when it is in the trash or gone). */
  readonly note_title: string | null;
  /** The sort moment for the cursor: made (inbox) or done (done), with microseconds. */
  readonly at: string;
}

const NOTIFICATION_COLUMNS = sql`n.id::text as id, n.kind, n.actor_type, n.actor_id::text as actor_id,
  ${millis('n.created_at')} as created_at, ${millis('n.read_at')} as read_at, ${millis('n.done_at')} as done_at,
  n.record_id::text as record_id, n.thread_id::text as thread_id, n.comment_id::text as comment_id,
  n.task_id::text as task_id, n.note_id::text as note_id, n.submission_id::text as submission_id,
  n.join_request_id::text as join_request_id, jr.name as join_name, n.automation_id::text as automation_id,
  jsonb_path_query_first(au.actions, '$[*] ? (@.kind == "notify").message') #>> '{}' as automation_message,
  n.due_task_id::text as due_task_id, dtk.title as due_title, c.body, nt.title as note_title`;

/** The comment a notification is about, joined when it is live (a deleted one's notifications are gone already). */
const COMMENT_JOIN = sql`left join comments c on c.workspace_id = n.workspace_id and c.id = n.comment_id
  and c.deleted_at is null
  left join notes nt on nt.workspace_id = n.workspace_id and nt.id = n.note_id and nt.deleted_at is null
  left join join_requests jr on jr.workspace_id = n.workspace_id and jr.id = n.join_request_id
    and jr.status = 'open'
  left join automations au on au.workspace_id = n.workspace_id and au.id = n.automation_id and au.deleted_at is null
  left join tasks dtk on dtk.workspace_id = n.workspace_id and dtk.id = n.due_task_id and dtk.deleted_at is null`;

/**
 * The rows among `rows` the reader may see, as views, in order (AC-1166): a
 * comment's when its record reads for them and the comment is live, a task's
 * when the task rule lets them see it.
 */
async function visibleViews(
  tx: WorkspaceTx,
  scope: EngineScope,
  rows: readonly NotificationRow[],
): Promise<readonly NotificationView[]> {
  if (rows.length === 0) return [];
  const recordIds = rows.flatMap((row) => (row.task_id === null && row.record_id !== null ? [row.record_id] : []));
  const submissionIds = rows.flatMap((row) => (row.submission_id === null ? [] : [row.submission_id]));
  const submissions = await submissionNotices(tx, scope, submissionIds);
  const taskIds = rows.flatMap((row) => (row.task_id === null ? [] : [row.task_id]));
  const records: ReadonlyMap<string, RecordRefDisplay> =
    recordIds.length === 0 ? new Map() : await linkedDisplays(tx, scope.access, recordIds);
  const tasks = new Map(
    (taskIds.length === 0 ? [] : await readTaskViews(tx, scope, [...new Set(taskIds)])).map((task) => [task.id, task]),
  );
  return rows.flatMap((row): NotificationView[] => {
    const base = {
      id: row.id,
      kind: row.kind,
      actor: { type: row.actor_type, id: row.actor_id },
      createdAt: row.created_at,
      ...(row.read_at === null ? {} : { readAt: row.read_at }),
      ...(row.done_at === null ? {} : { doneAt: row.done_at }),
    };
    if (row.automation_id !== null) {
      // An automation's notice: shown while the automation lives, its record reads for the reader and its due task
      // exists. The words are the automation's own (its first notify message), else the due task's title.
      const record = row.record_id === null ? undefined : records.get(row.record_id);
      const gone =
        (row.record_id !== null && record === undefined) || (row.due_task_id !== null && row.due_title === null);
      if (gone || (row.automation_message === null && row.due_title === null && record === undefined)) return [];
      return [
        {
          ...base,
          ...(record === undefined ? {} : { record }),
          ...(row.due_task_id === null ? {} : { taskId: row.due_task_id }),
          excerpt: excerptOf(row.automation_message ?? row.due_title ?? '', NOTIFICATION_EXCERPT),
        },
      ];
    }
    if (row.join_request_id !== null) {
      // Someone asks to join: shown while the request is open and the reader may still approve it.
      if (row.join_name === null || !can(scope.access, 'members.invite')) return [];
      return [{ ...base, joinRequestId: row.join_request_id, excerpt: excerptOf(row.join_name, NOTIFICATION_EXCERPT) }];
    }
    if (row.task_id !== null) {
      const task = tasks.get(row.task_id);
      if (task === undefined) return [];
      const [record] = task.records;
      return [{ ...base, taskId: row.task_id, excerpt: task.title, ...(record === undefined ? {} : { record }) }];
    }
    if (row.submission_id !== null) {
      // A form's new submission: shown while the reader may open it, with the record it filed when they may see it.
      const notice = submissions.get(row.submission_id);
      if (notice === undefined) return [];
      return [
        {
          ...base,
          submissionId: row.submission_id,
          formId: notice.formId,
          formName: notice.formName,
          ...(notice.record === undefined ? {} : { record: notice.record }),
          excerpt: '',
        },
      ];
    }
    if (row.note_id !== null) {
      // A mention in a note (spec 0019): shown while the note is live and its record reads for the reader.
      const record = row.record_id === null ? undefined : records.get(row.record_id);
      if (record === undefined || row.note_title === null) return [];
      return [{ ...base, record, noteId: row.note_id, excerpt: excerptOf(row.note_title, NOTIFICATION_EXCERPT) }];
    }
    if (row.record_id === null || row.comment_id === null || row.thread_id === null || row.body === null) return [];
    const record = records.get(row.record_id);
    if (record === undefined) return [];
    return [
      {
        ...base,
        record,
        threadId: row.thread_id,
        commentId: row.comment_id,
        excerpt: excerptOf(row.body, NOTIFICATION_EXCERPT),
      },
    ];
  });
}

/** Encodes where a page ended as the opaque cursor. */
function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Decodes a cursor of the same tab, refusing anything that isn't one of ours (400 `INPUT_INVALID` on `cursor`). */
function decodeCursor(cursor: string, status: NotificationStatus): NotificationCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw inputInvalid('cursor', NOTIFICATION_CURSOR_MESSAGE);
  }
  const bound = NotificationCursor.safeParse(parsed);
  if (!bound.success || bound.data.status !== status) throw inputInvalid('cursor', NOTIFICATION_CURSOR_MESSAGE);
  const moment = bound.data.at;
  const stamp = Date.parse(moment);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(moment) ||
    Number.isNaN(stamp) ||
    moment.startsWith('0000') ||
    new Date(stamp).toISOString().slice(0, 19) !== moment.slice(0, 19)
  ) {
    throw inputInvalid('cursor', NOTIFICATION_CURSOR_MESSAGE);
  }
  return bound.data;
}

/** The filters a list and Mark all as read share: the tab, a kind, unread only. */
function filters(
  me: string,
  input: { readonly status: NotificationStatus; readonly kind?: NotificationKind; readonly unreadOnly?: boolean },
): SQL {
  const parts: SQL[] = [
    sql`n.member_id = ${me}::uuid`,
    input.status === 'inbox' ? sql`n.done_at is null` : sql`n.done_at is not null`,
  ];
  if (input.kind !== undefined) parts.push(sql`n.kind = ${input.kind}::notification_kind`);
  if (input.unreadOnly === true) parts.push(sql`n.read_at is null`);
  return sql.join(parts, sql` and `);
}

/** What `listNotifications` takes. */
export interface ListNotificationsInput {
  readonly status: NotificationStatus;
  readonly kind?: NotificationKind;
  readonly unreadOnly?: boolean;
  readonly cursor?: string;
}

/**
 * A page of the caller's inbox (AC-1169, AC-1170): Inbox (not done) newest
 * first, or Done newest done first, 50 at a time, filtered by kind and unread;
 * the ones the caller may not see left out, reading further up to 3 times to
 * fill the page. A key has no inbox: an empty page.
 */
export async function listNotifications(scope: EngineScope, input: ListNotificationsInput): Promise<NotificationPage> {
  checkScope(scope);
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor, input.status);
  const me = callerOf(scope);
  if (me === undefined) return { items: [] };
  const sortColumn = input.status === 'inbox' ? 'n.created_at' : 'n.done_at';
  return inWorkspace(scope, async (tx) => {
    const items: NotificationView[] = [];
    let bound = after;
    let more = false;
    for (let round = 0; round <= READ_AHEAD && items.length < NOTIFICATION_PAGE; round += 1) {
      const want = NOTIFICATION_PAGE - items.length;
      const page = await tx.execute<NotificationRow>(sql`
        select ${NOTIFICATION_COLUMNS}, ${micros(sortColumn)} as at
        from notifications n ${COMMENT_JOIN}
        where ${filters(me, input)}
          ${bound === undefined ? sql`` : sql`and (${sql.raw(sortColumn)}, n.id) < (${bound.at}::timestamptz, ${bound.id}::uuid)`}
        order by ${sql.raw(sortColumn)} desc, n.id desc
        limit ${want + 1}
      `);
      const rows = page.rows.slice(0, want);
      more = page.rows.length > want;
      items.push(...(await visibleViews(tx, scope, rows)));
      const last = rows.at(-1);
      if (last !== undefined) bound = { status: input.status, at: last.at, id: last.id };
      if (!more) break;
    }
    return { items, ...(more && bound !== undefined && bound !== after ? { nextCursor: encodeCursor(bound) } : {}) };
  });
}

/**
 * The caller's unread count (AC-1174): unread and not done, of those they
 * may see, read newest first up to `NOTIFICATION_COUNT_CAP + 1` rows, so the
 * read stays bounded; `atLeast` when more were left unread past them.
 */
export async function countUnread(scope: EngineScope): Promise<NotificationCount> {
  checkScope(scope);
  const me = callerOf(scope);
  if (me === undefined) return { count: 0, atLeast: false };
  const cap = NOTIFICATION_COUNT_CAP + 1;
  return inWorkspace(scope, async (tx) => {
    const page = await tx.execute<NotificationRow>(sql`
      select ${NOTIFICATION_COLUMNS}, ${micros('n.created_at')} as at
      from notifications n ${COMMENT_JOIN}
      where n.member_id = ${me}::uuid and n.read_at is null and n.done_at is null
      order by n.created_at desc
      limit ${cap * 2}
    `);
    // Hidden rows neither count nor say that more exist: only what the reader may see moves the badge.
    const count = (await visibleViews(tx, scope, page.rows)).length;
    return { count: Math.min(count, cap), atLeast: count > cap };
  });
}

/** What `markNotifications` takes: any of read and done. */
export interface MarkNotificationsInput {
  readonly ids: readonly string[];
  readonly read?: boolean;
  readonly done?: boolean;
}

/**
 * Marks some of the caller's notifications read or unread, done or back in
 * the inbox (AC-1171). Done marks it read too. Any id that isn't the caller's
 * answers `NOT_FOUND` and changes nothing. Answers how many changed.
 */
export async function markNotifications(
  scope: EngineScope,
  input: MarkNotificationsInput,
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly changed: number }> {
  checkScope(scope);
  const me = memberOrUnknown(scope);
  if (input.ids.length > NOTIFICATION_MARK_MAX) {
    throw refuse('CONFIG_INVALID', `Mark at most ${String(NOTIFICATION_MARK_MAX)} notifications at once.`);
  }
  if (!input.ids.every(isUuid)) throw refuse('NOT_FOUND', UNKNOWN_NOTIFICATION);
  if (input.read === false && input.done === true) {
    throw inputInvalid('read', 'A notification marked done is read. Leave out read, or mark it unread on its own.');
  }
  const ids = [...new Set(input.ids.map(canonicalId))];
  const sets: SQL[] = [];
  if (input.read === true || input.done === true) sets.push(sql`read_at = coalesce(read_at, now())`);
  if (input.read === false) sets.push(sql`read_at = null`);
  if (input.done === true) sets.push(sql`done_at = coalesce(done_at, now())`);
  if (input.done === false) sets.push(sql`done_at = null`);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const mine = await tx.execute<NotificationRow>(sql`
        select ${NOTIFICATION_COLUMNS}, ${micros('n.created_at')} as at
        from notifications n ${COMMENT_JOIN}
        where n.member_id = ${me}::uuid and n.id = any(${uuidList(ids)})
        order by n.id
        for update of n
      `);
      // Another member's, a missing one and one the caller may not see now answer alike (hidden means absent).
      if ((await visibleViews(tx, scope, mine.rows)).length < ids.length) {
        throw refuse('NOT_FOUND', UNKNOWN_NOTIFICATION);
      }
      if (sets.length === 0) return { changed: 0 };
      // Only rows whose state moves: a mark that changes nothing writes nothing and tells no tab.
      const moving: SQL[] = [];
      if (input.read === true || input.done === true) moving.push(sql`read_at is null`);
      if (input.read === false) moving.push(sql`read_at is not null`);
      if (input.done === true) moving.push(sql`done_at is null`);
      if (input.done === false) moving.push(sql`done_at is not null`);
      const changed = await tx.execute(sql`
        update notifications set ${sql.join(sets, sql`, `)}
        where member_id = ${me}::uuid and id = any(${uuidList(ids)}) and (${sql.join(moving, sql` or `)})
      `);
      const count = changed.rowCount ?? 0;
      if (count > 0) context.record({ notifications: [me] });
      return { changed: count };
    },
    hooks,
  );
  return result;
}

/** The most notifications one Mark all as read (or done) reads: the newest, so a second press reaches older ones. */
const MARK_ALL_MAX = 1_000;

/**
 * Marks every unread notification of the caller's tab (and kind) that they
 * may see read (AC-1171), up to the newest `MARK_ALL_MAX`; with `done`, every
 * one of the inbox tab, read or not, done (and read), which empties the inbox
 * in one press. Hidden ones stay as they are and are never counted. Answers
 * how many changed.
 */
export async function markAllRead(
  scope: EngineScope,
  input: { readonly status: NotificationStatus; readonly kind?: NotificationKind; readonly done?: boolean },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly changed: number }> {
  checkScope(scope);
  const me = memberOrUnknown(scope);
  const isDone = input.done === true;
  // The Done tab is done already: marking it done again changes nothing.
  if (isDone && input.status === 'done') return { changed: 0 };
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const found = await tx.execute<NotificationRow>(sql`
        select ${NOTIFICATION_COLUMNS}, ${micros('n.created_at')} as at
        from notifications n ${COMMENT_JOIN}
        where ${filters(me, { status: input.status, ...(input.kind === undefined ? {} : { kind: input.kind }), unreadOnly: !isDone })}
        order by n.created_at desc, n.id desc
        limit ${MARK_ALL_MAX}
      `);
      const shown = (await visibleViews(tx, scope, found.rows)).map((view) => view.id);
      if (shown.length === 0) return { changed: 0 };
      const changed = await tx.execute(
        isDone
          ? sql`
            update notifications set read_at = coalesce(read_at, now()), done_at = now()
            where member_id = ${me}::uuid and id = any(${uuidList(shown)}) and done_at is null
          `
          : sql`
            update notifications set read_at = now()
            where member_id = ${me}::uuid and id = any(${uuidList(shown)}) and read_at is null
          `,
      );
      const count = changed.rowCount ?? 0;
      if (count > 0) context.record({ notifications: [me] });
      return { changed: count };
    },
    hooks,
  );
  return result;
}

/** A settings row as stored. */
interface SettingsRow extends Record<string, unknown> {
  readonly email_mentions: boolean;
  readonly email_replies: boolean;
  readonly email_assignments: boolean;
  readonly digest: boolean;
  readonly time_zone: string | null;
  readonly version: number;
}

/** A settings row as the contract carries it. */
const settingsOf = (row: SettingsRow | undefined): NotificationSettings =>
  row === undefined
    ? DEFAULT_NOTIFICATION_SETTINGS
    : {
        emailMentions: row.email_mentions,
        emailReplies: row.email_replies,
        emailAssignments: row.email_assignments,
        digest: row.digest,
        ...(row.time_zone === null ? {} : { timeZone: row.time_zone }),
        version: row.version,
      };

/** Reads the caller's settings row, if they have one. */
async function settingsRow(tx: WorkspaceTx, me: string, lock = false): Promise<SettingsRow | undefined> {
  const rows = await tx.execute<SettingsRow>(sql`
    select email_mentions, email_replies, email_assignments, digest, time_zone, version
    from notification_settings where member_id = ${me}::uuid
    ${lock ? sql`for update` : sql``}
  `);
  return rows.rows[0];
}

/** Whether `me` turned mentions off from an email's preferences link (the `mentions` topic). */
async function mentionsTopicOff(tx: WorkspaceTx, me: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    select 1 from email_preferences where member_id = ${me}::uuid and topic = 'mentions' and not subscribed
  `);
  return rows.rows.length > 0;
}

/**
 * The caller's switches as they act: Email mentions reads off when the `mentions` topic was turned off from an
 * email's link, since no mention email or digest line goes then (late trap #87: Settings showed it on, and turning
 * it on there changed nothing).
 */
async function actingSettings(tx: WorkspaceTx, me: string, lock = false): Promise<NotificationSettings> {
  const settings = settingsOf(await settingsRow(tx, me, lock));
  return settings.emailMentions && (await mentionsTopicOff(tx, me)) ? { ...settings, emailMentions: false } : settings;
}

/** The caller's email settings for this workspace (AC-1179); no row means the defaults. */
export async function getNotificationSettings(scope: EngineScope): Promise<NotificationSettings> {
  checkScope(scope);
  const me = callerOf(scope);
  if (me === undefined) return DEFAULT_NOTIFICATION_SETTINGS;
  return inWorkspace(scope, async (tx) => actingSettings(tx, me));
}

/** What `setNotificationSettings` takes: only the switches given change. */
export interface SetNotificationSettingsInput {
  readonly emailMentions?: boolean;
  readonly emailReplies?: boolean;
  readonly emailAssignments?: boolean;
  readonly digest?: boolean;
  /** The browser's IANA zone, stored with the digest (AC-1178). */
  readonly timeZone?: string;
}

/**
 * Changes some of the caller's switches (AC-1179), writing their row the
 * first time. Turning the digest on needs a time zone, given now or stored
 * before (`INPUT_INVALID` on `timeZone`). Their other tabs hear of it through
 * the `notifications` event naming them (AC-1180).
 */
export async function setNotificationSettings(
  scope: EngineScope,
  input: SetNotificationSettingsInput,
  hooks: readonly AfterWrite[] = [],
): Promise<NotificationSettings> {
  checkScope(scope);
  const me = callerOf(scope);
  if (me === undefined) throw refuse('FORBIDDEN', 'Only members have notification settings.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      // The stored switches, which the row keeps; what the caller saw (`before`) reads mentions off while its email
      // topic is, so turning it on here is a change even when the stored switch was on all along.
      const stored = settingsOf(await settingsRow(tx, me, true));
      const before = await actingSettings(tx, me);
      const next = {
        emailMentions: input.emailMentions ?? stored.emailMentions,
        emailReplies: input.emailReplies ?? before.emailReplies,
        emailAssignments: input.emailAssignments ?? before.emailAssignments,
        digest: input.digest ?? before.digest,
        timeZone: input.timeZone ?? before.timeZone,
      };
      if (next.digest && next.timeZone === undefined) throw inputInvalid('timeZone', DIGEST_ZONE_MESSAGE);
      if (input.timeZone !== undefined) {
        // The digest's hour is read in Postgres, whose zone list differs from the browser's: only one it knows.
        const known = await tx.execute(sql`select 1 from pg_timezone_names where name = ${input.timeZone}`);
        if (known.rows.length === 0) throw inputInvalid('timeZone', UNKNOWN_ZONE_MESSAGE);
      }
      const same =
        next.emailMentions === before.emailMentions &&
        next.emailReplies === before.emailReplies &&
        next.emailAssignments === before.emailAssignments &&
        next.digest === before.digest &&
        next.timeZone === before.timeZone;
      if (same) return before;
      if (
        input.emailMentions !== true &&
        next.emailMentions === stored.emailMentions &&
        next.emailReplies === stored.emailReplies &&
        next.emailAssignments === stored.emailAssignments &&
        next.digest === stored.digest &&
        next.timeZone === stored.timeZone
      ) {
        return before;
      }
      const rows = await tx.execute<SettingsRow>(sql`
        insert into notification_settings (workspace_id, member_id, email_mentions, email_replies, email_assignments,
          digest, time_zone, version)
        values (${scope.workspaceId}::uuid, ${me}::uuid, ${next.emailMentions}, ${next.emailReplies},
          ${next.emailAssignments}, ${next.digest}, ${next.timeZone ?? null}, 1)
        on conflict (workspace_id, member_id) do update set email_mentions = excluded.email_mentions,
          email_replies = excluded.email_replies, email_assignments = excluded.email_assignments,
          digest = excluded.digest, time_zone = excluded.time_zone,
          version = notification_settings.version + 1, updated_at = now()
        returning email_mentions, email_replies, email_assignments, digest, time_zone, version
      `);
      // Turned on here, mentions are on: the `mentions` topic an email's link turned off goes back on with it.
      if (input.emailMentions === true) {
        await tx.execute(sql`
          update email_preferences set subscribed = true, updated_via = 'app', updated_at = now()
          where member_id = ${me}::uuid and topic = 'mentions' and not subscribed
        `);
      }
      // The digest turned off: the new submissions it was holding go in an email of their own instead, never lost.
      if (before.digest && !next.digest) {
        await tx.execute(sql`
          select crm_enqueue_notification_email(${me}::uuid)
          where exists (
            select 1 from notifications
            where member_id = ${me}::uuid and kind::text = 'form_submission' and emailed_at is null
              and read_at is null and done_at is null
          )
        `);
      }
      context.record({ notifications: [me] });
      const saved = settingsOf(rows.rows[0]);
      return saved.emailMentions && (await mentionsTopicOff(tx, me)) ? { ...saved, emailMentions: false } : saved;
    },
    hooks,
  );
  return result;
}

/**
 * A removed member's notifications and settings go (AC-1168), inside
 * `removeMember`'s write; their clients hear of it.
 */
export async function deleteMemberNotifications(context: WriteContext, memberId: string): Promise<void> {
  const removed = await context.tx.execute(sql`delete from notifications where member_id = ${memberId}::uuid`);
  await context.tx.execute(sql`delete from notification_settings where member_id = ${memberId}::uuid`);
  if ((removed.rowCount ?? 0) > 0) context.record({ notifications: [memberId] });
}

/** At most this many notifications in one email; the rest wait for the next one. */
export const NOTIFICATION_EMAIL_MAX = 20;

/** How far one email's read looks: unemailed rows past this wait for the next email. */
const NOTIFICATION_EMAIL_READ = 200;

/** What one email holds: the caller's notifications to send, newest first, and how many more wait. */
export interface NotificationEmailBatch {
  readonly items: readonly NotificationView[];
  readonly more: number;
}

/**
 * The caller's notifications an email may carry now (AC-1176, AC-1177): unread,
 * not done, not yet emailed, of a kind whose email the caller has on (every
 * kind for the daily digest, AC-1178; never a mention while the `mentions`
 * email topic is off), and that
 * they may see at this moment (the inbox's own rule, read as them). At most
 * `NOTIFICATION_EMAIL_MAX`, newest first; `more` counts the rest.
 */
export async function unemailedNotifications(
  scope: EngineScope,
  options: { readonly digest?: boolean } = {},
): Promise<NotificationEmailBatch> {
  checkScope(scope);
  const me = callerOf(scope);
  if (me === undefined) return { items: [], more: 0 };
  return inWorkspace(scope, async (tx) => {
    const settings = settingsOf(await settingsRow(tx, me));
    // Mentions turned off from an email's preferences link (the `mentions` topic): this is the one email a mention
    // gets, so no email or digest holds them.
    const offRows = await tx.execute<{ off: boolean }>(sql`
      select true as off from email_preferences
      where member_id = ${me}::uuid and topic = 'mentions' and not subscribed
    `);
    const mentionsOn = offRows.rows.length === 0;
    // The digest holds every kind still unread (AC-1178); an email after a notification, the kinds switched on. A
    // form's new submission is emailed on its own, with its answers, and marked emailed then (`tellOne`); one still
    // unemailed here was waiting for a digest since turned off, or its own email was refused, so it goes in this one.
    const kinds: NotificationKind[] = (
      options.digest
        ? (['mention', 'reply', 'task_assigned', 'form_submission'] as const)
        : [
            ...(settings.emailMentions ? (['mention'] as const) : []),
            ...(settings.emailReplies ? (['reply'] as const) : []),
            ...(settings.emailAssignments ? (['task_assigned'] as const) : []),
            ...(settings.digest ? [] : (['form_submission'] as const)),
          ]
    ).filter((kind) => kind !== 'mention' || mentionsOn);
    if (kinds.length === 0) return { items: [], more: 0 };
    const rows = await tx.execute<NotificationRow>(sql`
      select ${NOTIFICATION_COLUMNS}, ${micros('n.created_at')} as at
      from notifications n ${COMMENT_JOIN}
      where n.member_id = ${me}::uuid and n.read_at is null and n.done_at is null and n.emailed_at is null
        and n.kind = any(${`{${kinds.join(',')}}`}::notification_kind[])
      order by n.created_at desc, n.id desc
      limit ${NOTIFICATION_EMAIL_READ}
    `);
    const views = await visibleViews(tx, scope, rows.rows);
    return { items: views.slice(0, NOTIFICATION_EMAIL_MAX), more: Math.max(views.length - NOTIFICATION_EMAIL_MAX, 0) };
  });
}

/**
 * Marks the caller's notifications emailed, committed before the email goes
 * out, so a task that sent and then failed never sends them again on its
 * retry (AC-1176). A send that fails gives them back with `releaseEmailed`.
 */
export async function markEmailed(scope: EngineScope, ids: readonly string[]): Promise<void> {
  checkScope(scope);
  const me = callerOf(scope);
  if (me === undefined || ids.length === 0) return;
  await inWorkspace(scope, async (tx) => {
    await tx.execute(sql`
      update notifications set emailed_at = now()
      where member_id = ${me}::uuid and id = any(${uuidList(ids)}) and emailed_at is null
    `);
  });
}

/**
 * Gives back notifications claimed for an email that failed to send, and the
 * day's digest when it was one, for the task's retry to carry.
 */
export async function releaseEmailed(
  scope: EngineScope,
  ids: readonly string[],
  options: { readonly digest?: boolean } = {},
): Promise<void> {
  checkScope(scope);
  const me = callerOf(scope);
  if (me === undefined) return;
  await inWorkspace(scope, async (tx) => {
    if (ids.length > 0) {
      await tx.execute(sql`
        update notifications set emailed_at = null
        where member_id = ${me}::uuid and id = any(${uuidList(ids)})
      `);
    }
    if (options.digest === true) {
      await tx.execute(sql`update notification_settings set digest_sent_on = null where member_id = ${me}::uuid`);
    }
  });
}

/**
 * Queues the caller's next notifications email (AC-1176): the email that just
 * went held at most `NOTIFICATION_EMAIL_MAX`, so the rest go in another, five
 * minutes on. Keyed per member as every queueing is, so it is one waiting email
 * however often it is asked for; what the last one held is claimed already.
 */
export async function queueNextEmail(scope: EngineScope): Promise<void> {
  checkScope(scope);
  const me = callerOf(scope);
  if (me === undefined) return;
  await inWorkspace(scope, async (tx) => {
    await tx.execute(sql`select crm_enqueue_notification_email(${me}::uuid)`);
  });
}

/**
 * Claims today's daily digest for the caller (AC-1178): their digest is on,
 * their own day (in the time zone they turned it on in) has reached 08:00 and
 * has none yet (a retry past midnight never sends the next day's early), so the
 * day is marked now, before the email goes, and a second run that day gets
 * false. Answers whether this run may send it.
 */
export async function claimDigest(scope: EngineScope): Promise<boolean> {
  checkScope(scope);
  const me = callerOf(scope);
  if (me === undefined) return false;
  return inWorkspace(scope, async (tx) => {
    const claimed = await tx.execute(sql`
      update notification_settings set digest_sent_on = (now() at time zone time_zone)::date
      where member_id = ${me}::uuid and digest and time_zone is not null
        and time_zone in (select name from pg_timezone_names)
        and extract(hour from now() at time zone time_zone) >= 8
        and (digest_sent_on is null or digest_sent_on < (now() at time zone time_zone)::date)
    `);
    return (claimed.rowCount ?? 0) > 0;
  });
}

/** A removal (spec 0031, AC-814): their notifications and notification settings go (spec 0038, AC-1168). */
export const notificationsRemoval: RemovalEffect = {
  feature: 'notifications',
  constraints: ['notification_settings_member', 'notifications_member'],
  run: deleteMemberNotifications,
};
