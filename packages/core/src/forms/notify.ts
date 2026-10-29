// The team's notice of a new submission (spec 0023, AC-1047; late trap #19): before, a submission told nobody, so a
// lead sat unseen until someone happened to open the form's Submissions tab. When the processing job ends a
// submission (processed, kept, or failed to file), it queues one email each to the member the lead was given to and
// the member who made the form, as most form tools tell a form's owner and a lead's owner. Each email holds only
// what that member may see: the submission as `getSubmission` would show them, so an answer filed on a field hidden
// from them is absent, and a member who can't open the submission gets nothing. A member turns these off with the
// email's preferences link (the `form_submissions` topic). Spam never reaches here: the job leaves it alone.
// Choosing who is told per form, and the daily digest, are spec 0023 milestone 3's.
import { sql } from 'drizzle-orm';
import { EmailAddress, EmailTimeZone, type EmailRow, type FormSubmissionEmail } from '@crm/contracts/emails';
import type { FormDocument, SubmissionAnswer } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { FileValue } from '@crm/contracts/values';
import { memberScopeIn, type RuleSource } from '../access/door.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { WriteContext } from '../engine/write.ts';
import type { EngineScope } from '../engine/scope.ts';
import { queueFormSubmissionNotice } from '../emails/queue.ts';
import { visitorOf } from './public.ts';
import { viewIn } from './submissions.ts';
import { loadForm, loadVersions } from './shared.ts';

/** The most answers one notice lists (the email's own limit). */
const MAX_ANSWERS = 60;

/** An answer as words: text, Yes or No, a phone's number, a file's name; empty when it has none. */
export function answerWords(value: unknown): string {
  const file = FileValue.safeParse(value);
  if (file.success) return file.data.name;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join(', ');
  if (typeof value === 'object' && value !== null && typeof (value as { number?: unknown }).number === 'string') {
    return (value as { number: string }).number;
  }
  return '';
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
  readonly maker: string | null;
  readonly slug: string;
  readonly workspace_zone: string;
}

/**
 * Queues the notice of a submission the processing job just ended, in its transaction, to the member its lead went
 * to and the form's maker: once each (the key is the submission and the member), cut to what each may see. Without
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
    await tx.transaction((inner) => tellEach(inner, scope, rules, submissionId));
  } catch {
    // Left out, never thrown: the submission commits as filing left it.
  }
}

/** The notices themselves, inside `tellTeam`'s savepoint. */
async function tellEach(tx: WorkspaceTx, scope: EngineScope, rules: RuleSource, submissionId: string): Promise<void> {
  const found = await tx.execute<NoticeRow>(sql`
    select s.form_id::text, s.version_id::text, s.state::text,
      to_char(s.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as received_at,
      s.assignment->>'memberId' as lead_owner, f.created_by_member_id::text as maker,
      w.slug, w.time_zone as workspace_zone
    from form_submissions s
    join forms f on f.workspace_id = s.workspace_id and f.id = s.form_id
    join workspaces w on w.id = s.workspace_id
    where s.workspace_id = ${scope.workspaceId} and s.id = ${submissionId} and s.state in ('processed', 'failed')
  `);
  const row = found.rows[0];
  if (row === undefined) return;
  const form = await loadForm(tx, row.form_id);
  const version = (await loadVersions(tx, [row.version_id])).get(row.version_id);
  if (form === undefined || version === undefined) return;
  const told = [...new Set([row.lead_owner, row.maker].filter((id): id is string => id !== null))];
  for (const memberId of told) {
    try {
      await tx.transaction((one) =>
        tellOne(one, { scope, rules, submissionId, row, form, document: version.document }, memberId),
      );
    } catch {
      // This member's notice is left out; the others still go.
    }
  }
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

/** One member's notice, under its own savepoint. */
async function tellOne(tx: WorkspaceTx, notice: Notice, memberId: string): Promise<void> {
  const { scope, rules, submissionId, row, form, document } = notice;
  const reader = await memberScopeIn(tx, scope, rules, memberId);
  if (reader === undefined) return;
  const view = await viewIn(tx, reader, submissionId).catch((error: unknown) => {
    // A submission this member can't open isn't theirs to hear about (hidden means absent).
    if (isRefusal(error) && error.refusal.code === 'NOT_FOUND') return undefined;
    throw error;
  });
  if (view === undefined) return;
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
    reason: memberId === row.lead_owner ? 'lead' : 'maker',
    filed: row.state === 'processed',
  };
  await queueFormSubmissionNotice(tx, { submissionId, memberId, params });
}
