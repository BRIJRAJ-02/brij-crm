// A Consent question (spec 0023, AC-1053, AC-578, AC-575), against a real Postgres as the app role: a required one
// blocks the submit until ticked; publishing gives its words a version that moves only when they change; filing a
// submission onto a person writes one consent record per consent answered, with the exact words and version; and
// erasing the person takes their consents with them.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, FormQuestion, SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { PURGE_DEPENDENTS } from '../engine/purge-dependents.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { testScope } from '../testing.ts';
import { stampConsentVersions } from './consent.ts';
import { createForm, getForm, publishForm, saveFormDraft } from './forms.ts';
import { processSubmission } from './process.ts';
import { submitForm } from './public.ts';
import type { CaptchaVerdict } from './spam.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-consent-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Consent',
    slug: `consent-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  return { scope, system, query };
}

const consent = (label: string): FormQuestion => ({
  id: 'marketing',
  key: 'marketing',
  label,
  answerType: 'consent',
  required: true,
  update: 'fill',
  options: { purpose: 'marketing_email' },
});

const off: CaptchaVerdict = { kind: 'off' };

function body(answers: Record<string, unknown>): SubmitBody {
  return { idempotencyKey: newId(), answers, hidden: {}, fillMs: 10_000 };
}

async function submit(publicKey: string, input: SubmitBody) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  return submitForm(scope, registry, { formId, body: input, captcha: off, answersKey: 'a-test-answers-key' });
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('It was let through.');
}

/** A People form asking name, email and one consent, published; answers the form and a publish of new words. */
async function liveForm(w: Awaited<ReturnType<typeof workspace>>, words: string) {
  const created = await createForm(w.scope, { id: newId(), name: 'Newsletter' });
  const document: FormDocument = { ...created.draft, questions: [...created.draft.questions, consent(words)] };
  const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision });
  const live = await publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
  const republish = async (next: string) => {
    const now = await getForm(w.scope, { formId: created.id });
    const draft: FormDocument = {
      ...now.draft,
      questions: now.draft.questions.map((each) => (each.id === 'marketing' ? { ...each, label: next } : each)),
    };
    const again = await saveFormDraft(w.scope, { formId: created.id, document: draft, expectedRevision: now.revision });
    return publishForm(w.scope, { formId: created.id, expectedRevision: again.revision });
  };
  return { live, republish };
}

/** The live version's consent question, as stored. */
async function liveConsent(w: Awaited<ReturnType<typeof workspace>>, formId: string) {
  const [row] = await w.query<{ document: FormDocument }>(
    sql`select v.document from form_versions v join forms f on f.live_version_id = v.id where f.id = ${formId}`,
  );
  return row?.document.questions.find((each) => each.id === 'marketing');
}

describe('a Consent question (AC-1053)', () => {
  it('blocks the submit until a required one is ticked', async () => {
    const w = await workspace();
    const { live } = await liveForm(w, 'Send me the monthly note.');
    expect(
      await refusalOf(submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com' }))),
    ).toMatchObject([{ field: 'marketing' }]);
    expect(
      await refusalOf(
        submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com', marketing: false })),
      ),
    ).toMatchObject([{ field: 'marketing' }]);
  });

  it('versions its words on publish: 1 at first, the same for the same words, one more when they change', async () => {
    const w = await workspace();
    const { live, republish } = await liveForm(w, 'Send me the monthly note.');
    expect((await liveConsent(w, live.id))?.options?.wordingVersion).toBe(1);
    await republish('Send me the monthly note.');
    expect((await liveConsent(w, live.id))?.options?.wordingVersion).toBe(1);
    await republish('Send me the monthly note and the odd offer.');
    expect((await liveConsent(w, live.id))?.options?.wordingVersion).toBe(2);
  });

  it('keeps a consent record on the person with the exact words, their version and the submission', async () => {
    const w = await workspace();
    const { live, republish } = await liveForm(w, 'Send me the monthly note.');
    await republish('Send me the monthly note. Unsubscribe any time.');
    await submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com', marketing: true }));
    const [sent] = await w.query<{ id: string }>(sql`select id::text from form_submissions where form_id = ${live.id}`);
    const submissionId = sent?.id ?? '';
    await runWrite(w.system, (context) => processSubmission(context, submissionId));
    const rows = await w.query<{
      record_id: string;
      purpose: string;
      granted: boolean;
      wording: string;
      wording_version: number;
      source_type: string;
      source_id: string;
      main_record_id: string;
    }>(sql`
      select c.record_id::text, c.purpose, c.granted, c.wording, c.wording_version, c.source_type,
        c.source_id::text, s.main_record_id::text
      from consent_records c join form_submissions s on s.id = c.source_id
    `);
    expect(rows).toEqual([
      expect.objectContaining({
        purpose: 'marketing_email',
        granted: true,
        wording: 'Send me the monthly note. Unsubscribe any time.',
        wording_version: 2,
        source_type: 'submission',
        source_id: submissionId,
      }),
    ]);
    expect(rows[0]?.record_id).toBe(rows[0]?.main_record_id);
    // Erasing the person erases their consents (AC-575).
    const dependent = PURGE_DEPENDENTS.find((each) => each.name === 'consent_records');
    expect(dependent).toBeDefined();
    const removed = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      dependent === undefined ? Promise.resolve(0) : dependent.remove(tx, [rows[0]?.record_id ?? '']),
    );
    expect(removed).toBe(1);
  });
});

describe('stampConsentVersions', () => {
  const draft = (label: string, extra: Partial<FormQuestion> = {}) =>
    ({ questions: [{ ...consent(label), ...extra }] }) as unknown as FormDocument;

  it('leaves a document with no consent as it is', () => {
    const plain = { questions: [] } as unknown as FormDocument;
    expect(stampConsentVersions(plain, undefined)).toBe(plain);
  });

  it('ignores whatever version the draft itself carries', () => {
    const stamped = stampConsentVersions(
      draft('A', { options: { wordingVersion: 9 } }),
      draft('A', { options: { wordingVersion: 3 } }),
    );
    expect(stamped.questions[0]?.options?.wordingVersion).toBe(3);
  });
});
