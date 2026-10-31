// The team's notice of a new submission (spec 0023, AC-1047; late trap #19): before, a submission told nobody, so a
// lead sat unseen until someone happened to open the form's Submissions tab. When the processing job ends a
// submission (processed, kept, or failed to file), it queues one email each to the member the lead was given to and
// the members the form lists (its maker unless changed, 30 October 2026), as most form tools tell a form's owner and a lead's owner. Each email holds only
// what that member may see: the submission as `getSubmission` would show them, so an answer filed on a field hidden
// from them is absent, and a member who can't open the submission gets nothing. A member turns these off with the
// email's preferences link (the `form_submissions` topic). Spam never reaches here: the job leaves it alone. Each
// member told also gets it in their inbox, and one who takes the daily digest (spec 0038) gets it there in place of
// the email.
import { sql } from 'drizzle-orm';
import { EmailAddress, EmailTimeZone, type EmailRow, type FormSubmissionEmail } from '@crm/contracts/emails';
import { answerWords as wordsOf, type FormDocument, type SubmissionAnswer } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { memberScopeIn, type RuleSource } from '../access/door.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { WriteContext } from '../engine/write.ts';
import type { EngineScope } from '../engine/scope.ts';
import { queueFormSubmissionNotice } from '../emails/queue.ts';
import { notifySubmission } from '../notifications/notify.ts';
import { visitorOf } from './public.ts';
import { viewIn } from './submissions.ts';
import { loadForm, loadVersions } from './shared.ts';

/** The most answers one notice lists (the email's own limit). */
const MAX_ANSWERS = 60;

/** An answer as words (`answerWords` in contracts): the email notice reads every shape as the panel does. */
export function answerWords(value: unknown): string {
  return wordsOf(value);
}

/** The answers as an email's rows: labelled, each cut to what a row holds, the empty ones left out. */
function answerRows(answers: readonly SubmissionAnswer[]): EmailRow[] {
  return answers
    .flatMap((answer) => {
      const label = answer.label.trim().slice(0, 200);
      const value = answerWords(answer.value).slice(0, 4000);
      return label === '' || value === '' ? [] : [{ label, value }];
    })
    .slice(0, MAX_ANSWERS);
}

/** What a notice reads of its submission, its form and its workspace. */
interface NoticeRow extends Record<string, unknown> {
  readonly form_id: string;
  readonly version_id: string;
  readonly received_at: string;
  readonly state: string;
  readonly lead_owner: string | null;
  /** The members the form lists (`forms.notify_member_ids`). */
  readonly listed: readonly string[];
  readonly slug: string;
  readonly workspace_zone: string;
}

/**
 * Queues the notice of a submission the processing job just ended, in its transaction, to the member its lead went
 * to and the members the form lists: once each (the key is the submission and the member), cut to what each may see. Without
 * `rules` (a registry built with none) it tells nobody, rather than read members with none: fail closed. Each member
 * is told under a savepoint of their own, and anything that goes wrong only leaves that notice out: a notice never
 * decides whether the submission is filed (security review).
 */
export async function tellTeam(
  context: WriteContext,
  rules: RuleSource | undefined,
  submissionId: string,
): Promise<void> {
  if (rules === undefined) return;
  const { tx, scope } = context;
  try {
    const told = await tx.transaction((inner) => tellEach(inner, scope, rules, submissionId));
    // Their open inboxes hear of it through one `notifications` outbox row.
    if (told.length > 0) context.record({ notifications: told });
  } catch {
    // Left out, never thrown: the submission commits as filing left it.
  }
}

/** The notices themselves, inside `tellTeam`'s savepoint. */
async function tellEach(
  tx: WorkspaceTx,
  scope: EngineScope,
  rules: RuleSource,
  submissionId: string,
): Promise<readonly string[]> {
  const found = await tx.execute<NoticeRow>(sql`
    select s.form_id::text, s.version_id::text, s.state::text,
      to_char(s.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as received_at,
      s.assignment->>'memberId' as lead_owner, f.notify_member_ids::text[] as listed,
      w.slug, w.time_zone as workspace_zone
    from form_submissions s
    join forms f on f.workspace_id = s.workspace_id and f.id = s.form_id
    join workspaces w on w.id = s.workspace_id
    where s.workspace_id = ${scope.workspaceId} and s.id = ${submissionId} and s.state in ('processed', 'failed')
  `);
  const row = found.rows[0];
  if (row === undefined) return [];
  const form = await loadForm(tx, row.form_id);
  const version = (await loadVersions(tx, [row.version_id])).get(row.version_id);
  if (form === undefined || version === undefined) return [];
  // A listed member who has left gets nothing: `memberScopeIn` answers only an active member.
  const told = [...new Set([row.lead_owner, ...row.listed].filter((id): id is string => id !== null))];
  const changed: string[] = [];
  for (const memberId of told) {
    try {
      const inbox = await tx.transaction((one) =>
        tellOne(one, { scope, rules, submissionId, row, form, document: version.document }, memberId),
      );
      if (inbox) changed.push(memberId);
    } catch {
      // This member's notice is left out; the others still go.
    }
  }
  return changed;
}

/** What every member's notice of one submission shares. */
interface Notice {
  readonly scope: EngineScope;
  readonly rules: RuleSource;
  readonly submissionId: string;
  readonly row: NoticeRow;
  readonly form: { readonly id: string; readonly name: string };
  readonly document: FormDocument;
}

/**
 * One member's notice, under its own savepoint: the inbox row, then the email with the answers they may see, unless
 * their daily digest carries it instead. Answers whether their inbox changed.
 */
async function tellOne(tx: WorkspaceTx, notice: Notice, memberId: string): Promise<boolean> {
  const { scope, rules, submissionId, row, form, document } = notice;
  const reader = await memberScopeIn(tx, scope, rules, memberId);
  if (reader === undefined) return false;
  const view = await viewIn(tx, reader, submissionId).catch((error: unknown) => {
    // A submission this member can't open isn't theirs to hear about (hidden means absent).
    if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') return undefined;
    throw error;
  });
  if (view === undefined) return false;
  const inbox = await notifySubmission(tx, { workspaceId: scope.workspaceId, memberId, submissionId });
  // Told already (a second processing, or a job that gave up after one did): nothing more.
  if (inbox === undefined) return false;
  if (inbox.digestOnly) return true;
  const seen = Object.fromEntries(view.answers.map((answer) => [answer.key, answer.value]));
  const visitor = visitorOf(document, seen);
  const zone = await tx.execute<{ time_zone: string | null }>(
    sql`select time_zone from members where workspace_id = ${scope.workspaceId} and id = ${memberId}`,
  );
  const timeZone = EmailTimeZone.safeParse(zone.rows[0]?.time_zone ?? row.workspace_zone);
  const email = visitor.email === undefined ? undefined : EmailAddress.safeParse(visitor.email);
  const params: FormSubmissionEmail = {
    formName: form.name.slice(0, 200),
    submitter: {
      ...(visitor.name === undefined ? {} : { name: visitor.name }),
      ...(email?.success === true ? { email: email.data } : {}),
    },
    answers: answerRows(view.answers),
    submittedAt: row.received_at,
    ...(timeZone.success ? { timeZone: timeZone.data } : {}),
    submissionPath: `/w/${encodeURIComponent(row.slug)}/captures/forms/${form.id}?tab=submissions&submission=${submissionId}`,
    reason: memberId === row.lead_owner ? 'lead' : 'listed',
    filed: row.state === 'processed',
  };
  const queued = await queueFormSubmissionNotice(tx, { submissionId, memberId, params });
  if (queued.outcome === 'refused') {
    // Its own email couldn't be queued: the notifications email carries it instead (a line and its link).
    await tx.execute(sql`
      update notifications set emailed_at = null
      where member_id = ${memberId}::uuid and submission_id = ${submissionId}::uuid
    `);
    await tx.execute(sql`select crm_enqueue_notification_email(${memberId}::uuid)`);
  }
  return true;
}
