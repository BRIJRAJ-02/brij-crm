// A Consent question (spec 0023, AC-1053, AC-578, AC-575), against a real Postgres as the app role: a required one
// blocks the submit until ticked, a site's own form included; publishing gives its words a version that moves only
// when they change, and refuses one that recalls an answer or sits on a form that adds no person; filing a
// submission onto a person writes one consent record per consent ticked, with the exact words and version, from
// answers checked again (a released spam submission included), never for a box left empty; the app may add a record
// and never rewrite one; and erasing the person takes their consents with them.
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
import { recordConsents, stampConsentVersions } from './consent.ts';
import { createForm, getForm, publishForm, saveFormDraft, setFormTarget } from './forms.ts';
import { processSubmission } from './process.ts';
import { submitForm } from './public.ts';
import { getSubmission, releaseSubmission } from './submissions.ts';
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

function body(answers: Record<string, unknown>, fillMs = 10_000): SubmitBody {
  return { idempotencyKey: newId(), answers, hidden: {}, fillMs };
}

async function submit(publicKey: string, input: SubmitBody, fromSite = false) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  return submitForm(scope, registry, {
    formId,
    body: input,
    captcha: off,
    answersKey: 'a-test-answers-key',
    ...(fromSite ? { fromSite } : {}),
  });
}

/** Processes a form's submissions, oldest first, as the job does. */
async function processAll(w: Awaited<ReturnType<typeof workspace>>, formId: string) {
  const rows = await w.query<{ id: string }>(
    sql`select id::text from form_submissions where form_id = ${formId} order by received_at, id`,
  );
  for (const row of rows) await runWrite(w.system, (context) => processSubmission(context, row.id));
  return rows.map((row) => row.id);
}

/** Every consent record in the workspace, oldest first. */
const consentRows = (w: Awaited<ReturnType<typeof workspace>>) =>
  w.query<{ record_id: string; question_id: string; granted: boolean }>(
    sql`select record_id::text, question_id, granted from consent_records order by at, id`,
  );

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('It was let through.');
}

/** A People form asking name, email and one consent (and `more`), published; and a publish of new words. */
async function liveForm(w: Awaited<ReturnType<typeof workspace>>, words: string, more: readonly FormQuestion[] = []) {
  const created = await createForm(w.scope, { id: newId(), name: 'Newsletter' });
  const document: FormDocument = {
    ...created.draft,
    questions: [...created.draft.questions, consent(words), ...more],
  };
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
    // A site's own form that leaves it out (an unticked box posts nothing) is refused too, never taken as not asked.
    expect(
      await refusalOf(submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com' }), true)),
    ).toMatchObject([{ field: 'marketing' }]);
    await submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com', marketing: 'yes' }), true);
    await processAll(w, live.id);
    expect(await consentRows(w)).toMatchObject([{ question_id: 'marketing', granted: true }]);
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

  it('writes nothing for an optional consent left empty, and one row however often it is filed', async () => {
    const w = await workspace();
    const partners: FormQuestion = {
      ...consent('Tell me about partners.'),
      id: 'partners',
      key: 'partners',
      required: false,
    };
    const { live } = await liveForm(w, 'Send me the monthly note.', [partners]);
    await submit(
      live.publicKey,
      body({ name: 'Ada Lovelace', email: 'ada@example.com', marketing: true, partners: false }),
    );
    const [submissionId] = await processAll(w, live.id);
    // Not ticking is not a withdrawal: a stranger typing someone's email must never take back their consent.
    const rows = await consentRows(w);
    expect(rows).toMatchObject([{ question_id: 'marketing', granted: true }]);
    // Filed again (Add to the CRM after processing): the same answer is never a second record.
    const again = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      recordConsents(tx, {
        workspaceId: w.scope.workspaceId,
        recordId: rows[0]?.record_id ?? '',
        submissionId: submissionId ?? '',
        ticked: [consent('Send me the monthly note.')],
      }),
    );
    expect(again).toBe(0);
    expect(await consentRows(w)).toHaveLength(1);
  });

  it('reads a released spam submission again: a hidden consent and a site’s yes, and a missing one stops it', async () => {
    const w = await workspace();
    const wants: FormQuestion = {
      id: 'wants',
      key: 'wants',
      label: 'Hear from partners?',
      answerType: 'choice',
      choices: ['Yes', 'No'],
      required: false,
      update: 'fill',
    };
    const partners: FormQuestion = {
      ...consent('Tell me about partners.'),
      id: 'partners',
      key: 'partners',
      required: false,
      showWhen: { join: 'all', rules: [{ key: 'wants', op: 'is', value: 'Yes' }] },
    };
    const { live } = await liveForm(w, 'Send me the monthly note.', [wants, partners]);
    // Too fast to be a person: held as spam, stored as sent, never checked.
    await submit(
      live.publicKey,
      body({ name: 'Ada Lovelace', email: 'ada@example.com', marketing: 'yes', wants: 'No', partners: 'yes' }, 100),
    );
    await submit(live.publicKey, body({ name: 'Grace Hopper', email: 'grace@example.com' }, 100));
    const held = await w.query<{ id: string; state: string }>(
      sql`select id::text, state from form_submissions where form_id = ${live.id} order by received_at, id`,
    );
    expect(held.map((row) => row.state)).toEqual(['spam', 'spam']);
    for (const row of held) await releaseSubmission(w.scope, registry, { submissionId: row.id });
    const [ada, grace] = await processAll(w, live.id);
    // The site's `yes` grants; the partners consent its Show when hid was never asked, so it writes nothing.
    expect(await consentRows(w)).toMatchObject([{ question_id: 'marketing', granted: true }]);
    expect((await getSubmission(w.scope, { submissionId: ada ?? '' })).state).toBe('processed');
    // A required consent never ticked stops the filing, with why, and nobody is added.
    const failed = await getSubmission(w.scope, { submissionId: grace ?? '' });
    expect(failed.state).toBe('failed');
    expect(failed.failure).toContain('Send me the monthly note.');
  });

  it('refuses at publish a consent that recalls an answer, or on a form that adds no person', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Newsletter' });
    const recalls: FormDocument = {
      ...created.draft,
      questions: [...created.draft.questions, consent('I, {{name}}, agree.')],
    };
    const saved = await saveFormDraft(w.scope, {
      formId: created.id,
      document: recalls,
      expectedRevision: created.revision,
    });
    expect(
      await refusalOf(publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision })),
    ).toMatchObject([{ code: 'CONFIG_INVALID', field: 'marketing' }]);
    // Kept with its submissions only: nobody is added, so there is no person to keep a consent on.
    const unfiled = await setFormTarget(w.scope, {
      formId: created.id,
      mainObjectId: null,
      expectedRevision: saved.revision,
    });
    const keeps: FormDocument = {
      ...unfiled.draft,
      questions: unfiled.draft.questions.map((each) => (each.id === 'marketing' ? consent('I agree.') : each)),
    };
    const again = await saveFormDraft(w.scope, {
      formId: created.id,
      document: keeps,
      expectedRevision: unfiled.revision,
    });
    const [refused] = await refusalOf(publishForm(w.scope, { formId: created.id, expectedRevision: again.revision }));
    expect(refused).toMatchObject({ code: 'CONFIG_INVALID', field: 'marketing' });
    expect(refused?.message).toContain('People');
  });

  it('lets the app add a record and never rewrite one: no change to the answer, the words or the time', async () => {
    const w = await workspace();
    const { live } = await liveForm(w, 'Send me the monthly note.');
    await submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com', marketing: true }));
    await processAll(w, live.id);
    for (const change of [
      sql`update consent_records set granted = false`,
      sql`update consent_records set wording = 'Something else.'`,
      sql`update consent_records set at = now() - interval '1 year'`,
    ]) {
      await expect(db.withWorkspace(w.scope.workspaceId, (tx) => tx.execute(change))).rejects.toMatchObject({
        cause: { code: '42501' },
      });
    }
    // Nor back date one on the way in: `at` is always the database's own time.
    const [row] = await consentRows(w);
    await expect(
      db.withWorkspace(w.scope.workspaceId, (tx) =>
        tx.execute(sql`
          insert into consent_records (workspace_id, record_id, purpose, granted, wording, wording_version, source_type, at)
          values (${w.scope.workspaceId}, ${row?.record_id ?? ''}, 'marketing_email', true, 'x', 1, 'member', now() - interval '1 year')
        `),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});

describe('stampConsentVersions', () => {
  const draft = (label: string, extra: Partial<FormQuestion> = {}) =>
    ({ questions: [{ ...consent(label), ...extra }] }) as unknown as FormDocument;

  const versionOf = (document: FormDocument) => document.questions[0]?.options?.wordingVersion;

  it('leaves a document with no consent as it is', () => {
    const plain = { questions: [] } as unknown as FormDocument;
    expect(stampConsentVersions(plain, [])).toBe(plain);
  });

  it('ignores whatever version the draft itself carries', () => {
    const stamped = stampConsentVersions(draft('A', { options: { wordingVersion: 9 } }), [
      draft('A', { options: { wordingVersion: 3 } }),
    ]);
    expect(versionOf(stamped)).toBe(3);
  });

  it('counts from the highest version any published version held, never only the live one', () => {
    // Published A (1), then B (2), then the form went back to A's words: never 1 again, and never B's 2.
    const history = [draft('A', { options: { wordingVersion: 1 } }), draft('B', { options: { wordingVersion: 2 } })];
    expect(versionOf(stampConsentVersions(draft('A'), history))).toBe(3);
    expect(versionOf(stampConsentVersions(draft('B'), history))).toBe(2);
    expect(versionOf(stampConsentVersions(draft('C'), []))).toBe(1);
  });
});
