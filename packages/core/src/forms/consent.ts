// Consent (spec 0023, AC-1053, AC-578): a Consent question is a tick box showing its exact words. Publishing gives
// each one the version of its words (`stampConsentVersions`), and filing a submission onto a person writes one
// consent record per Consent question it answered (`recordConsents`): the answer, the words and their version as
// the visitor was shown them, with the submission as its source. Records are only ever inserted.
import { sql } from 'drizzle-orm';
import type { ConsentPurpose, FormDocument, FormQuestion } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';

const { consentRecords } = schema;

/** A Consent question's purpose: its own, else marketing email. */
export function purposeOf(question: FormQuestion): ConsentPurpose {
  return question.options?.purpose ?? 'marketing_email';
}

/**
 * The draft as it goes live, each Consent question carrying the version of its words: 1 when it is new, the live
 * version's own when its words are the same, and one more when they changed. So a consent record always names the
 * exact words a person agreed to, however often the form is published, and only changed words make a new version.
 */
export function stampConsentVersions(draft: FormDocument, live: FormDocument | undefined): FormDocument {
  if (!draft.questions.some((question) => question.answerType === 'consent')) return draft;
  const before = new Map((live?.questions ?? []).map((question) => [question.id, question]));
  return {
    ...draft,
    questions: draft.questions.map((question) => {
      if (question.answerType !== 'consent') return question;
      const was = before.get(question.id);
      const kept = was?.answerType === 'consent' ? (was.options?.wordingVersion ?? 1) : undefined;
      const wordingVersion = kept === undefined ? 1 : was?.label.trim() === question.label.trim() ? kept : kept + 1;
      return { ...question, options: { ...question.options, wordingVersion } };
    }),
  };
}

/**
 * Writes a consent record on `recordId` (the person a submission was filed onto) for each Consent question in the
 * version the visitor answered: granted when they ticked it, refused when they left it, in the order of the form.
 * A question its Show when hid was never answered, so it is not in `answers` and writes nothing. Answers how many.
 */
export async function recordConsents(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly recordId: string;
    readonly submissionId: string;
    readonly document: FormDocument;
    readonly answers: Readonly<Record<string, unknown>>;
  },
): Promise<number> {
  const rows = input.document.questions
    .filter((question) => question.answerType === 'consent' && Object.hasOwn(input.answers, question.key))
    .map((question) => ({
      workspaceId: input.workspaceId,
      recordId: input.recordId,
      purpose: purposeOf(question),
      granted: input.answers[question.key] === true,
      wording: question.label.trim(),
      wordingVersion: question.options?.wordingVersion ?? 1,
      sourceType: 'submission',
      sourceId: input.submissionId,
    }))
    .filter((row) => row.wording !== '');
  if (rows.length === 0) return 0;
  await tx.insert(consentRecords).values(rows);
  return rows.length;
}

/** Whether `objectId` is the workspace's People object: only a person holds consents (AC-578). */
export async function isPeopleObject(tx: WorkspaceTx, objectId: string): Promise<boolean> {
  const found = await tx.execute<{ is_people: boolean }>(
    sql`select exists (select 1 from objects where id = ${objectId}::uuid and standard_key = 'people') as is_people`,
  );
  return found.rows[0]?.is_people === true;
}
