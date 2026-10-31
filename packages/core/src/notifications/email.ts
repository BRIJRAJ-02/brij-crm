// The notifications email's words (spec 0038, AC-1176, AC-1177), for the
// worker's `crm_notification_email` task: entered as the member (so one
// removed since gets nothing, and a demoted one sees as they now may), the
// notifications they may see now that are unread, not done, not yet emailed
// and of a kind they get email for, each as a sentence, the record's name, an
// excerpt with mentions named, and the app path that opens it. No I/O beyond
// the database; the worker draws and sends, then calls `markEmailed`.
import { bodySegments } from '@crm/contracts/mentions';
import type { NotificationEmailItem, NotificationsEmail } from '@crm/contracts/emails';
import type { NotificationView } from '@crm/contracts';
import { sql } from 'drizzle-orm';
import { enterAsActor, type ActorDoorDeps } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import { uuidList } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { claimDigest, unemailedNotifications } from './inbox.ts';

/** The name a mention or an actor no longer a member reads as. */
const FORMER_MEMBER = 'Former member';

/** An email ready to draw, or why there is none. */
export type PreparedNotificationEmail =
  | {
      readonly scope: EngineScope;
      readonly to: { readonly email: string; readonly name: string };
      readonly workspaceName: string;
      readonly params: NotificationsEmail;
      /** The notifications it holds, claimed with `markEmailed` before it goes. */
      readonly ids: readonly string[];
      /** More are due past these: the task queues the next email (`queueNextEmail`). */
      readonly hasMore: boolean;
      readonly skipped?: undefined;
    }
  | { readonly skipped: 'removed' | 'nothing' };

/** The sentence an email gives a notification, as the inbox says it. */
function sentenceOf(view: NotificationView, actor: string): string {
  if (view.kind === 'form_submission') return `New submission to ${view.formName ?? 'a form'}`;
  if (view.kind === 'mention' && view.noteId !== undefined) return `${actor} mentioned you in a note`;
  if (view.kind === 'mention') return `${actor} mentioned you`;
  if (view.kind === 'reply') return `${actor} replied in a thread`;
  if (view.kind === 'task_due') return 'A task is due today';
  return `${actor} assigned you a task`;
}

/** The text with each mention token as "@Name". */
function named(text: string, nameOf: (memberId: string) => string): string {
  return bodySegments(text)
    .map((segment) => (segment.kind === 'mention' ? `@${nameOf(segment.memberId)}` : segment.text))
    .join('');
}

/**
 * The notifications email for one member of one workspace, read as that
 * member now (AC-1177): `removed` for a member no longer active (never
 * emailed), `nothing` when no notification is due. `digest` makes it the
 * daily digest (AC-1178): every kind, once a day.
 */
export async function prepareNotificationEmail(
  deps: ActorDoorDeps,
  input: { readonly workspaceId: string; readonly memberId: string; readonly digest?: boolean },
): Promise<PreparedNotificationEmail> {
  let scope: EngineScope;
  try {
    scope = await enterAsActor(deps, {
      workspaceId: input.workspaceId,
      actor: { type: 'member', id: input.memberId },
    });
  } catch (error) {
    if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') return { skipped: 'removed' };
    throw error;
  }
  // The daily digest (AC-1178): one a day, the day claimed before anything is read or sent.
  if (input.digest === true && !(await claimDigest(scope))) return { skipped: 'nothing' };
  const batch = await unemailedNotifications(scope, { digest: input.digest === true });
  if (batch.items.length === 0) return { skipped: 'nothing' };
  const memberIds = new Set<string>([input.memberId]);
  for (const view of batch.items) {
    if (view.actor.type === 'member' && view.actor.id !== null) memberIds.add(view.actor.id);
    for (const segment of bodySegments(view.excerpt)) if (segment.kind === 'mention') memberIds.add(segment.memberId);
  }
  const objectIds = [
    ...new Set(batch.items.flatMap((view) => (view.record === undefined ? [] : [view.record.objectId]))),
  ];
  const facts = await inWorkspace(scope, async (tx) => {
    const members = await tx.execute<{ id: string; name: string; email: string }>(sql`
      select id::text as id, name, email from members where id = any(${uuidList([...memberIds])})
    `);
    const objects =
      objectIds.length === 0
        ? { rows: [] }
        : await tx.execute<{ id: string; api_slug: string }>(sql`
            select id::text as id, api_slug from objects where id = any(${uuidList(objectIds)})
          `);
    const workspace = await tx.execute<{ name: string; slug: string }>(sql`
      select name, slug from workspaces where id = ${input.workspaceId}::uuid
    `);
    return { members: members.rows, objects: objects.rows, workspace: workspace.rows[0] };
  });
  const me = facts.members.find((member) => member.id === input.memberId);
  if (me === undefined || facts.workspace === undefined) return { skipped: 'removed' };
  const names = new Map(facts.members.map((member) => [member.id, member.name]));
  const nameOf = (memberId: string) => names.get(memberId) ?? FORMER_MEMBER;
  const slugs = new Map(facts.objects.map((object) => [object.id, object.api_slug]));
  const base = `/w/${facts.workspace.slug}`;
  const sent: string[] = [];
  const items = batch.items.flatMap((view): NotificationEmailItem[] => {
    const actor = view.actor.type === 'member' && view.actor.id !== null ? nameOf(view.actor.id) : 'Someone';
    let path: string;
    if (view.taskId !== undefined) path = `${base}/inbox?task=${view.taskId}`;
    else if (view.submissionId !== undefined && view.formId !== undefined) {
      path = `${base}/captures/forms/${view.formId}?tab=submissions&submission=${view.submissionId}`;
    } else {
      const objectSlug = view.record === undefined ? undefined : slugs.get(view.record.objectId);
      if (view.record === undefined || objectSlug === undefined) return [];
      const page = `${base}/objects/${objectSlug}/${view.record.recordId}`;
      if (view.noteId !== undefined) path = `${page}/notes?note=${view.noteId}`;
      else if (view.threadId !== undefined) path = `${page}/comments?thread=${view.threadId}`;
      else return [];
    }
    const excerpt = named(view.excerpt, nameOf).slice(0, 200);
    sent.push(view.id);
    return [
      {
        sentence: sentenceOf(view, actor).slice(0, 200),
        ...(view.record === undefined || view.record.name.trim() === ''
          ? {}
          : { recordName: view.record.name.slice(0, 200) }),
        excerpt,
        path,
      },
    ];
  });
  if (items.length === 0) return { skipped: 'nothing' };
  return {
    scope,
    to: { email: me.email, name: me.name },
    workspaceName: facts.workspace.name,
    params: {
      items,
      more: batch.more,
      inboxPath: `${base}/inbox`,
      settingsPath: `${base}/settings/account/notifications`,
      ...(input.digest === true ? { digest: true } : {}),
    },
    ids: sent,
    hasMore: batch.more > 0,
  };
}
