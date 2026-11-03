// Consent (spec 0023, AC-1053, AC-578): a Consent question is a tick box showing its exact words. Publishing gives
// each one the version of its words (`stampConsentVersions`), and filing a submission onto a person writes one
// consent record per Consent question it answered (`recordConsents`): the answer, the words and their version as
// the visitor was shown them, with the submission as its source. Records are only ever inserted.
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { checkAnswers, pathOf, type ConsentPurpose, type FormDocument, type FormQuestion } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { logicFormOf } from './shared.ts';

const { formVersions } = schema;

/** A Consent question's purpose: its own, else marketing email. */
export function purposeOf(question: FormQuestion): ConsentPurpose {
  return question.options?.purpose ?? 'marketing_email';
}

/**
 * The draft as it goes live, each Consent question carrying the version of its words, worked out from every version
 * the form ever published (`published`), not only the live one: unpublishing, editing and publishing again must
 * never start a question back at 1 and give two different wordings the same number. A question no published version
 * held is 1; one whose words match its highest numbered published wording keeps that number; any other is one more
 * than the highest. The draft's own number is never trusted.
 */
export function stampConsentVersions(draft: FormDocument, published: readonly FormDocument[]): FormDocument {
  if (!draft.questions.some((question) => question.answerType === 'consent')) return draft;
  const highest = new Map<string, { readonly version: number; readonly label: string }>();
  for (const document of published) {
    for (const question of document.questions) {
      if (question.answerType !== 'consent') continue;
      const version = question.options?.wordingVersion ?? 1;
      const held = highest.get(question.id);
      if (held === undefined || version > held.version) highest.set(question.id, { version, label: question.label });
    }
  }
  return {
    ...draft,
    questions: draft.questions.map((question) => {
      if (question.answerType !== 'consent') return question;
      const held = highest.get(question.id);
      const wordingVersion =
        held === undefined ? 1 : held.label.trim() === question.label.trim() ? held.version : held.version + 1;
      return { ...question, options: { ...question.options, wordingVersion } };
    }),
  };
}

/** Every version of `formId` that ever went live, for `stampConsentVersions`. */
export async function publishedDocuments(tx: WorkspaceTx, formId: string): Promise<FormDocument[]> {
  const rows = await tx
    .select({ document: formVersions.document })
    .from(formVersions)
    .where(and(eq(formVersions.formId, formId), isNotNull(formVersions.publishedAt)));
  return rows.map((row) => row.document as FormDocument);
}

/** What a submission's consent answers come to: the questions ticked, or the required one it never ticked. */
export type ConsentAnswers =
  | { readonly kind: 'given'; readonly ticked: readonly FormQuestion[] }
  | { readonly kind: 'missing'; readonly question: FormQuestion };

/** A raw tick as every path sends one: the page's `true`, a site's own form's `yes` or `true`. */
const isTick = (value: unknown): boolean => value === true || value === 'yes' || value === 'true';

/**
 * The consents a submission gave, read again from the version it answered and never trusted as stored: a submission
 * a bot check held (and a member released) was stored unchecked, so its answers may carry a key its Show when hid,
 * a site's `yes`, or no tick at all for a required consent. The answers are checked as a submit checks them
 * (`checkAnswers`); where they no longer check as a whole (an answer another question's rules have since refused),
 * the walk alone (`pathOf`) says which questions were asked. Only a question on the path counts, only a tick grants,
 * and a required consent with no tick is `missing`.
 */
export function consentAnswersOf(document: FormDocument, answers: Readonly<Record<string, unknown>>): ConsentAnswers {
  const consents = document.questions.filter((question) => question.answerType === 'consent');
  if (consents.length === 0) return { kind: 'given', ticked: [] };
  const form = { language: document.language, ...logicFormOf(document) };
  const checked = checkAnswers(form, answers);
  const asked = checked.ok ? undefined : pathOf(form, answers).keys;
  const ticked: FormQuestion[] = [];
  for (const question of consents) {
    // Never on the path: never asked, so never given, and never required of this visitor.
    if (asked !== undefined && !asked.has(question.key)) continue;
    if (checked.ok && !Object.hasOwn(checked.answers, question.key)) continue;
    const tick = checked.ok ? checked.answers[question.key] === true : isTick(answers[question.key]);
    if (tick) ticked.push(question);
    else if (question.required) return { kind: 'missing', question };
  }
  return { kind: 'given', ticked };
}

/** Why a submission can't be filed: a required consent it never gave (AC-1053). */
export const consentMissing = (label: string): string =>
  `This submission never ticked “${label.trim()}”, which the form requires, so it wasn’t added.`;

/**
 * Writes a consent record on `recordId` (the person a submission was filed onto) for each consent the visitor
 * ticked, with the words and version they were shown. Not ticking an optional consent writes nothing: leaving a box
 * empty is not a withdrawal, and a stranger typing someone's email must never withdraw their consent. One row per
 * submission and question, so filing the same submission again (processing, then Add to the CRM) adds nothing.
 * Answers how many it wrote.
 */
export async function recordConsents(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly recordId: string;
    readonly submissionId: string;
    readonly ticked: readonly FormQuestion[];
  },
): Promise<number> {
  const rows = input.ticked
    .filter((question) => question.label.trim() !== '')
    .map(
      (question) =>
        sql`(${input.workspaceId}::uuid, ${input.recordId}::uuid, ${purposeOf(question)}, true, ${question.label.trim()},
          ${question.options?.wordingVersion ?? 1}, 'submission', ${input.submissionId}::uuid, ${question.id})`,
    );
  if (rows.length === 0) return 0;
  // Only the columns the app may insert (migration 0165): `id` and `at` are the database's own, never named here.
  const written = await tx.execute(sql`
    insert into consent_records
      (workspace_id, record_id, purpose, granted, wording, wording_version, source_type, source_id, question_id)
    values ${sql.join(rows, sql`, `)}
    on conflict do nothing
  `);
  return written.rowCount ?? 0;
}

/** Whether `objectId` is the workspace's People object: only a person holds consents (AC-578). */
export async function isPeopleObject(tx: WorkspaceTx, objectId: string): Promise<boolean> {
  const found = await tx.execute<{ is_people: boolean }>(
    sql`select exists (select 1 from objects where id = ${objectId}::uuid and standard_key = 'people') as is_people`,
  );
  return found.rows[0]?.is_people === true;
}
