// Writing notifications (spec 0038): the one module every source calls inside
// its own write, so a comment or a task assignment and the notifications it
// makes commit or fail together (AC-1167). A notification names what it is
// about by id and copies no text. The actor is never notified of their own
// action; only active members are notified; each recipient gets one per
// comment and one per task assignment (the unique indexes). Every recipient
// whose inbox changed is recorded in `Change.notifications`, so one
// `notifications` outbox row names them, and those whose settings email that
// kind get the email task queued (`crm_enqueue_notification_email`, 5 minutes
// on, one waiting row per member). A form's new submission (spec 0023, AC-568)
// is written by the processing job through `notifySubmission`, which emails it
// itself, with its answers, or leaves it for the member's daily digest.
import { sql, type SQL } from 'drizzle-orm';
import type { NotificationKind } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { uuidList } from '../engine/ids.ts';
import type { WriteContext } from '../engine/write.ts';

/**
 * The kinds a member's switches email after a notification (a form's submission, a join request and a scheduling
 * change each have their own email).
 */
type SwitchedKind = Exclude<NotificationKind, 'form_submission' | 'join_request' | 'scheduling_changed'>;

/** The settings column that says whether a kind is emailed. */
// A join request has its own email (`requestToJoin`'s notice), so it never queues this one.
const EMAIL_COLUMN: Readonly<Record<SwitchedKind, string>> = {
  mention: 'email_mentions',
  reply: 'email_replies',
  task_assigned: 'email_assignments',
};

/** The actor's columns as a notification stores them. */
function actorValues(context: WriteContext) {
  const actor = context.scope.actor;
  return {
    type: actor.type,
    id: actor.id,
    memberId: actor.type === 'member' ? actor.id : null,
  };
}

/** The acting member's id, when a member acts: never notified of their own action. */
function actingMember(context: WriteContext): string | undefined {
  const actor = context.scope.actor;
  return actor.type === 'member' && actor.id !== null ? actor.id : undefined;
}

/**
 * Queues the email task for each of `memberIds` whose settings email `kind`
 * (no settings row: the defaults, mentions and assignments on, replies off).
 * A mention queues nothing for a member who turned the `mentions` topic off
 * from an email's preferences link: the email would hold nothing for them.
 */
async function queueEmail(context: WriteContext, memberIds: readonly string[], kind: SwitchedKind): Promise<void> {
  if (memberIds.length === 0) return;
  const column = sql.raw(`s.${EMAIL_COLUMN[kind]}`);
  const fallback = kind === 'reply' ? sql`false` : sql`true`;
  const topicOff =
    kind === 'mention'
      ? sql` and not exists (
          select 1 from email_preferences p
          where p.workspace_id = m.workspace_id and p.member_id = m.id and p.topic = 'mentions'
            and not p.subscribed
        )`
      : sql``;
  await context.tx.execute(sql`
    select crm_enqueue_notification_email(m.id)
    from members m left join notification_settings s on s.workspace_id = m.workspace_id and s.member_id = m.id
    where m.id = any(${uuidList(memberIds)}) and coalesce(${column}, ${fallback})${topicOff}
    order by m.id
  `);
}

/** What a comment notifies: the members it mentions, and the thread's earlier writers for a reply. */
export interface CommentNotice {
  readonly commentId: string;
  readonly threadId: string;
  readonly recordId: string;
  /** Members the comment mentions (and, on an edit, only those newly mentioned). */
  readonly mentioned: readonly string[];
  /** For a reply: members who wrote a live comment in the thread before it. */
  readonly participants?: readonly string[];
}

/**
 * Notifies for one comment (AC-1163, AC-1164): `mention` to each mentioned
 * member, `reply` to the thread's earlier writers not mentioned, never the
 * actor, only active members, at most one per member per comment. Answers
 * the members notified.
 */
export async function notifyComment(context: WriteContext, notice: CommentNotice): Promise<readonly string[]> {
  const me = actingMember(context);
  const mentioned = [...new Set(notice.mentioned)].filter((id) => id !== me);
  const replied = [...new Set(notice.participants ?? [])].filter((id) => id !== me && !mentioned.includes(id));
  if (mentioned.length === 0 && replied.length === 0) return [];
  const actor = actorValues(context);
  const { workspaceId } = context.scope;
  const kinds = [...mentioned.map(() => 'mention'), ...replied.map(() => 'reply')];
  const inserted = await context.tx.execute<{ member_id: string; kind: NotificationKind }>(sql`
    insert into notifications (workspace_id, member_id, kind, actor_type, actor_id, actor_member_id, record_id,
      thread_id, comment_id)
    select ${workspaceId}::uuid, x.member_id, x.kind::notification_kind, ${actor.type}, ${actor.id}::uuid,
      ${actor.memberId}::uuid, ${notice.recordId}::uuid, ${notice.threadId}::uuid, ${notice.commentId}::uuid
    from unnest(${uuidList([...mentioned, ...replied])}, ${`{${kinds.join(',')}}`}::text[]) as x(member_id, kind)
    join members m on m.id = x.member_id and m.status = 'active'
    on conflict (workspace_id, member_id, comment_id) where comment_id is not null do nothing
    returning member_id::text as member_id, kind
  `);
  const made = inserted.rows;
  if (made.length === 0) return [];
  const recipients = made.map((row) => row.member_id);
  context.record({ notifications: recipients });
  await queueEmail(
    context,
    made.filter((row) => row.kind === 'mention').map((row) => row.member_id),
    'mention',
  );
  await queueEmail(
    context,
    made.filter((row) => row.kind === 'reply').map((row) => row.member_id),
    'reply',
  );
  return recipients;
}

/**
 * Mentions in a note (spec 0038 with spec 0019, AC-1163's rule for notes):
 * `mention` to each member newly mentioned by a save, never the writer, only
 * active members, one per member per note; a member whose mention a save
 * removed loses their notification for it. Their inboxes hear of it, and the
 * email task is queued for those who get mention emails.
 */
export async function notifyNoteMentions(
  context: WriteContext,
  input: {
    readonly noteId: string;
    readonly recordId: string;
    readonly before: readonly string[];
    readonly after: readonly string[];
  },
): Promise<void> {
  const me = actingMember(context);
  const before = new Set(input.before);
  const after = new Set(input.after);
  const added = [...after].filter((id) => !before.has(id) && id !== me);
  const removed = [...before].filter((id) => !after.has(id));
  const changed: string[] = [];
  if (removed.length > 0) {
    const gone = await context.tx.execute<{ member_id: string }>(sql`
      delete from notifications where note_id = ${input.noteId}::uuid and member_id = any(${uuidList(removed)})
      returning member_id::text as member_id
    `);
    changed.push(...gone.rows.map((row) => row.member_id));
  }
  if (added.length > 0) {
    const actor = actorValues(context);
    const made = await context.tx.execute<{ member_id: string }>(sql`
      insert into notifications (workspace_id, member_id, kind, actor_type, actor_id, actor_member_id, record_id,
        note_id)
      select ${context.scope.workspaceId}::uuid, m.id, 'mention', ${actor.type}, ${actor.id}::uuid,
        ${actor.memberId}::uuid, ${input.recordId}::uuid, ${input.noteId}::uuid
      from members m where m.id = any(${uuidList(added)}) and m.status = 'active'
      on conflict (workspace_id, member_id, note_id) where note_id is not null do nothing
      returning member_id::text as member_id
    `);
    const recipients = made.rows.map((row) => row.member_id);
    changed.push(...recipients);
    await queueEmail(context, recipients, 'mention');
  }
  if (changed.length > 0) context.record({ notifications: changed });
}

/**
 * Takes back a comment's notifications: every one when the comment is
 * deleted (AC-1156), or the `mention` ones of `memberIds` when an edit
 * removed their mention (AC-1163). Their inboxes hear of it.
 */
export async function withdrawComment(
  context: WriteContext,
  commentId: string,
  memberIds?: readonly string[],
): Promise<void> {
  if (memberIds !== undefined && memberIds.length === 0) return;
  const which =
    memberIds === undefined ? sql`` : sql` and kind = 'mention' and member_id = any(${uuidList(memberIds)})`;
  const removed = await context.tx.execute<{ member_id: string }>(sql`
    delete from notifications where comment_id = ${commentId}::uuid${which}
    returning member_id::text as member_id
  `);
  if (removed.rows.length > 0) context.record({ notifications: removed.rows.map((row) => row.member_id) });
}

/**
 * A task's assignee changed (AC-1165): the earlier assignee's unread
 * notification for it goes; the new assignee, unless they made the change,
 * is notified (again, when they had been before: the old one comes back to
 * the top as unread).
 */
export async function notifyTaskAssigned(
  context: WriteContext,
  input: { readonly taskId: string; readonly assignee: string | null; readonly previous: string | null },
): Promise<void> {
  const { taskId, assignee, previous } = input;
  if (assignee === previous) return;
  const changed: string[] = [];
  if (previous !== null) {
    const removed = await context.tx.execute<{ member_id: string }>(sql`
      delete from notifications
      where task_id = ${taskId}::uuid and member_id = ${previous}::uuid and read_at is null and done_at is null
      returning member_id::text as member_id
    `);
    changed.push(...removed.rows.map((row) => row.member_id));
  }
  if (assignee !== null && assignee !== actingMember(context)) {
    const actor = actorValues(context);
    const made = await context.tx.execute<{ member_id: string }>(sql`
      insert into notifications (workspace_id, member_id, kind, actor_type, actor_id, actor_member_id, task_id)
      select ${context.scope.workspaceId}::uuid, m.id, 'task_assigned', ${actor.type}, ${actor.id}::uuid,
        ${actor.memberId}::uuid, ${taskId}::uuid
      from members m where m.id = ${assignee}::uuid and m.status = 'active'
      on conflict (workspace_id, member_id, task_id) where task_id is not null do update
        set created_at = now(), read_at = null, done_at = null, emailed_at = null,
          actor_type = excluded.actor_type, actor_id = excluded.actor_id, actor_member_id = excluded.actor_member_id
      returning member_id::text as member_id
    `);
    const recipients = made.rows.map((row) => row.member_id);
    changed.push(...recipients);
    await queueEmail(context, recipients, 'task_assigned');
  }
  if (changed.length > 0) context.record({ notifications: changed });
}

/**
 * A form's new submission in one member's inbox (spec 0023, AC-568, AC-1047), in the processing job's transaction,
 * once per member and submission. The caller has already checked the member may open it, and the inbox checks
 * again on every read. A member who takes the daily digest (and hasn't turned these emails off) gets it there, so
 * the caller sends no email of its own; anyone else gets the caller's email, so the row is marked emailed now and
 * no notifications email repeats it. Answers undefined when the member already had it, so nothing is sent twice.
 */
export async function notifySubmission(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly memberId: string; readonly submissionId: string },
): Promise<{ readonly digestOnly: boolean } | undefined> {
  const made = await tx.execute<{ digest_only: boolean }>(sql`
    with choice as (
      select coalesce((select s.digest from notification_settings s where s.member_id = ${input.memberId}::uuid), false)
        and not exists (
          select 1 from email_preferences p
          where p.member_id = ${input.memberId}::uuid and p.topic = 'form_submissions' and not p.subscribed
        ) as digest
    )
    insert into notifications (workspace_id, member_id, kind, actor_type, submission_id, emailed_at)
    select ${input.workspaceId}::uuid, ${input.memberId}::uuid, 'form_submission', 'system', ${input.submissionId}::uuid,
      case when choice.digest then null else now() end
    from choice
    on conflict (workspace_id, member_id, submission_id) where submission_id is not null do nothing
    returning emailed_at is null as digest_only
  `);
  const [row] = made.rows;
  return row === undefined ? undefined : { digestOnly: row.digest_only };
}

/**
 * Takes away the notifications of the submissions `which` names (a condition on `n`), before they are deleted, so
 * the members whose inbox showed one hear of it through the write's `notifications` outbox row, rather than keep a
 * row that opens to nothing until they reload.
 */
export async function withdrawSubmissionNotices(context: WriteContext, which: SQL): Promise<void> {
  const gone = await context.tx.execute<{ member_id: string }>(sql`
    delete from notifications n where n.submission_id is not null and ${which}
    returning n.member_id::text as member_id
  `);
  const members = [...new Set(gone.rows.map((row) => row.member_id))];
  if (members.length > 0) context.record({ notifications: members });
}

/**
 * Someone changed a member's scheduling (spec 0037, AC-1264): one `scheduling_changed` notification in the member's
 * inbox naming only the actor, written by the scheduling notice in the transaction that queued its email, once per
 * email (the caller calls it only for an email it newly queued). An active member only, never the actor themself. A
 * member who takes the daily digest gets it there (not yet emailed); anyone else had the email already, so the row is
 * marked emailed now and no notifications email repeats it. Answers whether a row was written, so the caller names
 * the member in its `notifications` outbox row and their open inbox shows it.
 */
export async function notifySchedulingChanged(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly memberId: string; readonly actorMemberId: string },
): Promise<boolean> {
  if (input.memberId === input.actorMemberId) return false;
  const made = await tx.execute<{ id: string }>(sql`
    insert into notifications (workspace_id, member_id, kind, actor_type, actor_id, actor_member_id, emailed_at)
    select ${input.workspaceId}::uuid, m.id, 'scheduling_changed', 'member', ${input.actorMemberId}::uuid,
      ${input.actorMemberId}::uuid,
      case when coalesce((select s.digest from notification_settings s where s.member_id = m.id), false)
        then null else now() end
    from members m
    where m.workspace_id = ${input.workspaceId}::uuid and m.id = ${input.memberId}::uuid and m.status = 'active'
    returning id::text as id
  `);
  return made.rows.length > 0;
}
