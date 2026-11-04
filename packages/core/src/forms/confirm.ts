// The visitor's confirmation (spec 0063, AC-6318): their own copy of what
// they sent, when the form turns it on.
//
// It goes beside the team's notice, at the end of processing, so it is sent
// once per accepted submission and never for a spam or held one: those never
// reach `processSubmission` at all, which only ever runs on a `received` row.
// The copy shows the answers the visitor actually saw — the questions on
// their path, with hidden ones left out (they were never shown one) and a
// signature shown as "Signed" rather than a file — and replies go to the
// form's owner, not to a mailbox nobody reads.
//
// Like the team's notice, nothing here can decide whether a submission is
// filed: the whole thing runs under a savepoint and anything that goes wrong
// only leaves the email out.
import { sql } from 'drizzle-orm';
import { EmailAddress, EmailTimeZone, type EmailRow, type FormConfirmationEmail } from '@crm/contracts/emails';
import { pathOf, recall, scoreOf, sendsConfirmation, type FormDocument } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import type { WriteContext } from '../engine/write.ts';
import { queueFormConfirmation } from '../emails/queue.ts';
import { answerWords } from './notify.ts';
import { visitorOf } from './public.ts';
import { logicFormOf, loadForm, loadVersions } from './shared.ts';

/** The most answers one confirmation lists (the email's own limit). */
const MAX_ANSWERS = 60;

/** What a signature is shown as, rather than a file nobody can open from an email (AC-6318). */
export const SIGNED_WORD = 'Signed';

/** What the confirmation reads of its submission and form. */
interface ConfirmRow extends Record<string, unknown> {
  readonly form_id: string;
  readonly version_id: string;
  readonly state: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly received_at: string;
  readonly owner_member_id: string | null;
  readonly workspace_zone: string;
}

/**
 * The answers the visitor saw, as the email's rows (AC-6318): in the form's
 * own order, only the questions their answers put on the path, hidden
 * questions left out whatever they hold, and a signature shown as "Signed".
 * Labels are read through `recall` first, so a label that quotes an earlier
 * answer reads in the email as it did on the page, as plain text.
 */
export function confirmationRows(
  document: FormDocument,
  answers: Readonly<Record<string, unknown>>,
): readonly EmailRow[] {
  const logic = logicFormOf(document);
  const onPath = pathOf(logic, answers).keys;
  const score = scoreOf(logic, answers);
  return document.questions
    .flatMap((question) => {
      // A hidden question was never shown, so its value is never shown back: AC-6318's "hidden answers left out".
      if (question.answerType === 'hidden') return [];
      if (!onPath.has(question.key)) return [];
      const given = answers[question.key];
      if (given === undefined) return [];
      const label = recall(question.label, { answers, score }).trim().slice(0, 200);
      const value =
        question.answerType === 'signature' ? SIGNED_WORD : answerWords(given, question.answerType).slice(0, 4_000);
      return label === '' || value === '' ? [] : [{ label, value }];
    })
    .slice(0, MAX_ANSWERS);
}

/**
 * Queues the visitor's confirmation for a submission processing just ended,
 * in its transaction. Sends nothing when the form has it off, when the
 * submission is not an accepted one, or when the visitor gave no email
 * address to send it to. `queueFormConfirmation` is keyed by the submission,
 * so a job that runs twice still sends one email.
 */
export async function tellVisitor(context: WriteContext, submissionId: string): Promise<void> {
  const { tx, scope } = context;
  try {
    await tx.transaction((inner) => confirmOne(inner, scope.workspaceId, submissionId));
  } catch {
    // Left out, never thrown: the submission commits as filing left it.
  }
}

/** The confirmation itself, inside `tellVisitor`'s savepoint. */
async function confirmOne(tx: WorkspaceTx, workspaceId: string, submissionId: string): Promise<void> {
  const found = await tx.execute<ConfirmRow>(sql`
    select s.form_id::text, s.version_id::text, s.state::text, s.answers,
      to_char(s.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as received_at,
      f.owner_member_id::text as owner_member_id, w.time_zone as workspace_zone
    from form_submissions s
    join forms f on f.workspace_id = s.workspace_id and f.id = s.form_id
    join workspaces w on w.id = s.workspace_id
    where s.workspace_id = ${workspaceId} and s.id = ${submissionId}
  `);
  const row = found.rows[0];
  // Spam and held submissions never get one (AC-6318); a failed filing still means the visitor's message arrived.
  if (row === undefined || (row.state !== 'processed' && row.state !== 'failed')) return;
  const form = await loadForm(tx, row.form_id);
  const version = (await loadVersions(tx, [row.version_id])).get(row.version_id);
  if (form === undefined || version === undefined) return;
  const { document } = version;
  if (!sendsConfirmation(document)) return;
  const answers = row.answers;
  const { email } = visitorOf(document, answers);
  const address = email === undefined ? undefined : EmailAddress.safeParse(email);
  // No email question, or nothing typed into it: there is nowhere to send a copy, and that is not a failure.
  if (address === undefined || !address.success) return;
  const timeZone = EmailTimeZone.safeParse(row.workspace_zone);
  const score = scoreOf(logicFormOf(document), answers);
  const subject = document.confirmation?.subject;
  const line = document.confirmation?.line;
  const headline = document.headline.trim();
  const params: FormConfirmationEmail = {
    formName: form.name.slice(0, 200),
    ...(headline === '' ? {} : { headline: recall(headline, { answers, score }).replace(/\s+/g, ' ').slice(0, 200) }),
    // The form's own words, with any recall read as plain text (never HTML), exactly as the ending shows them.
    ...(subject === undefined || subject === '' ? {} : { subject: recall(subject, { answers, score }).slice(0, 200) }),
    ...(line === undefined || line === '' ? {} : { message: recall(line, { answers, score }).slice(0, 2_000) }),
    answers: [...confirmationRows(document, answers)],
    submittedAt: row.received_at,
    ...(timeZone.success ? { timeZone: timeZone.data } : {}),
  };
  await queueFormConfirmation(tx, {
    submissionId,
    address: address.data,
    // Replies reach the form's owner (AC-6318), not a mailbox nobody reads.
    ...(row.owner_member_id === null ? {} : { replyToMemberId: row.owner_member_id }),
    params,
  });
}
