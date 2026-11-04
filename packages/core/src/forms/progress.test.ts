// Spec 0063 slices 6 and 7, against a real Postgres as the app role: save and
// resume (AC-6319), the visitor's confirmation (AC-6318), analytics
// (AC-6320, AC-6321) and the privacy and tenancy lines both of them draw
// (AC-6329, AC-6330).
//
// The cases the spec names concretely are each here: Finish later on step 2
// then resume the next day; the link empty after a submit; ten views, six
// starts, three completions and three left on question four; and a cross
// workspace read of either table returning nothing.
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, FormQuestion, SubmitBody } from '@crm/contracts';
import { savesProgress, sendsConfirmation } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { rescope, testScope } from '../testing.ts';
import { createForm, publishForm, saveFormDraft, setFormTarget } from './forms.ts';
import { processSubmission } from './process.ts';
import { getPublicForm, submitForm } from './public.ts';
import { confirmationRows, SIGNED_WORD } from './confirm.ts';
import {
  dropPartial,
  partialTokenHash,
  resumePartial,
  savePartial,
  resumeLinkTarget,
  sendResumeLink,
} from './partials.ts';
import { completeFormVisit, countFormEvent, formAnalytics } from './visits.ts';
import { originOf } from '../insights/visits.ts';
import type { CaptchaVerdict } from './spam.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-forms-progress-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Forms',
    slug: `progress-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  return {
    scope,
    system,
    workspaceId: created.workspaceId,
    ownerId: created.memberId,
    people: created.objects.people ?? '',
    query,
  };
}
type Workspace = Awaited<ReturnType<typeof workspace>>;

const question = (
  changes: Partial<FormQuestion> & Pick<FormQuestion, 'id' | 'key' | 'label' | 'answerType'>,
): FormQuestion => ({ required: false, update: 'fill', ...changes });

const off: CaptchaVerdict = { kind: 'off' };

function body(answers: Record<string, unknown>, extra: Partial<SubmitBody> = {}): SubmitBody {
  return { idempotencyKey: newId(), answers, hidden: {}, fillMs: 10_000, ...extra };
}

/**
 * A four question Steps form in three steps, published: name, email, budget
 * and a note. Steps forms save progress by default, so this is the shape both
 * slices are exercised against.
 */
async function stepsForm(w: Workspace, changes: (document: FormDocument) => FormDocument = (d) => d) {
  const created = await createForm(w.scope, { id: newId(), name: 'Lead qualification' });
  const document: FormDocument = changes({
    ...created.draft,
    layout: 'steps',
    questions: [
      ...created.draft.questions.filter((each) => each.key === 'name' || each.key === 'email'),
      question({ id: 'budget', key: 'budget', label: 'Your budget', answerType: 'short_text' }),
      question({ id: 'why', key: 'why', label: 'Why are you here?', answerType: 'long_text' }),
    ],
    steps: [
      { id: 's2', title: 'About the work', startsAt: 'budget' },
      { id: 's3', title: 'Anything else', startsAt: 'why' },
    ],
  });
  const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision });
  return publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
}

/** The public scope of a form's address, as the endpoints enter it. */
const publicScope = (publicKey: string) => enterPublicForm({ db }, publicKey);

async function submit(publicKey: string, input: SubmitBody, extra: Record<string, unknown> = {}) {
  const { scope, formId } = await publicScope(publicKey);
  return submitForm(scope, registry, { formId, body: input, captcha: off, answersKey: 'a-test-key', ...extra });
}

/** Runs processing for a submission as the job does: in one write under the system's scope. */
async function processNow(w: Workspace, submissionId: string) {
  await runWrite(w.system, (context) => processSubmission(context, submissionId));
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

/** A daily visitor hash, as the api mints one: 32 lowercase hex digits and nothing else. */
const visitorHash = (seed: string) => createHash('sha256').update(seed).digest('hex').slice(0, 32);

describe('save and resume (AC-6319)', () => {
  it('saves a visitor on step 2, then gives their answers and step back the next day', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const saved = await savePartial(scope, {
      formId,
      answers: { name: 'Asha Rao', email: 'asha@example.com', budget: 'About $5k' },
      stepId: 's2',
    });
    expect(saved.resumeToken).toMatch(/^[\w-]{43}$/);
    // Thirty days out, not an hour and not a year.
    const days = (Date.parse(saved.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);

    // A day later, a fresh scope: the same link opens the same answers and the same step.
    const again = await publicScope(form.publicKey);
    const resumed = await resumePartial(again.scope, { formId, resumeToken: saved.resumeToken });
    expect(resumed.answers).toEqual({ name: 'Asha Rao', email: 'asha@example.com', budget: 'About $5k' });
    expect(resumed.stepId).toBe('s2');
  });

  it('keeps one partial per token, moving it on rather than piling rows up', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const first = await savePartial(scope, { formId, answers: { name: 'Asha Rao' }, stepId: 's2' });
    const second = await savePartial(scope, {
      formId,
      answers: { name: 'Asha Rao', budget: 'About $5k' },
      stepId: 's3',
      resumeToken: first.resumeToken,
    });
    expect(second.resumeToken).toBe(first.resumeToken);
    const rows = await w.query<{ n: number }>(sql`select count(*)::int as n from form_partials`);
    expect(rows[0]?.n).toBe(1);
    const resumed = await resumePartial(scope, { formId, resumeToken: first.resumeToken });
    expect(resumed.answers).toMatchObject({ budget: 'About $5k' });
    expect(resumed.stepId).toBe('s3');
  });

  it('shows the form empty after a submit: the partial is deleted and the link opens nothing', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const saved = await savePartial(scope, { formId, answers: { name: 'Asha Rao' }, stepId: 's2' });
    await submit(form.publicKey, body({ name: 'Asha Rao', email: 'asha@example.com' }), {
      resumeToken: saved.resumeToken,
    });
    const left = await w.query<{ n: number }>(sql`select count(*)::int as n from form_partials`);
    expect(left[0]?.n).toBe(0);
    expect(await refusalOf(resumePartial(scope, { formId, resumeToken: saved.resumeToken }))).toMatchObject([
      { code: 'NOT_FOUND' },
    ]);
  });

  it('never files a partial, never counts it as a submission and never shows it in Submissions', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    await savePartial(scope, { formId, answers: { name: 'Asha Rao', email: 'asha@example.com' }, stepId: 's2' });
    // No submission row at all, so nothing to process, notify, route or show.
    const submissions = await w.query<{ n: number }>(sql`select count(*)::int as n from form_submissions`);
    expect(submissions[0]?.n).toBe(0);
    // And no record: a partial reaches the CRM nowhere.
    const people = await w.query<{ n: number }>(sql`select count(*)::int as n from records`);
    expect(people[0]?.n).toBe(0);
    const emails = await w.query<{ n: number }>(sql`select count(*)::int as n from emails`);
    expect(emails[0]?.n).toBe(0);
  });

  // "Email me the link" (AC-6319). Nothing drove this service until now, and behind that silence it threw a
  // ZodError on every call while the email it queued could never render — two independent faults, both
  // invisible because no test referenced it. These cases are the coverage, not the fix: they call it for real
  // and read the row it queues, so a param that the email's own schema refuses fails here.
  it('queues one resume email to the address the form already holds, keyed by the day', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const saved = await savePartial(scope, {
      formId,
      answers: { name: 'Asha Rao', email: 'asha@example.com' },
      stepId: 's2',
    });

    expect(await sendResumeLink(scope, { formId, resumeToken: saved.resumeToken })).toEqual({ sent: true });

    const rows = await w.query<{ to_address: string; kind: string; key: string; params: unknown }>(
      sql`select to_address, kind, key, params from emails`,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.to_address).toBe('asha@example.com');
    // The key takes ids, counts and times and no free text, so the day goes in as digits: one link a day.
    expect(row?.key).toMatch(/\d{8}/u);
    // A path, never a whole address: every email link is joined to the app's own origin, and a full URL in a
    // param is refused by the guard at render. This is the fault that made the feature unusable.
    const params = row?.params as { readonly resumePath?: unknown };
    expect(params.resumePath).toBe(`/f/${form.publicKey}?resume=${saved.resumeToken}`);
    expect(String(params.resumePath)).not.toContain('://');
  });

  it('sends nothing, and says why, when the form holds no email answer to send it to', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const saved = await savePartial(scope, { formId, answers: { name: 'Asha Rao' }, stepId: 's2' });

    expect(await sendResumeLink(scope, { formId, resumeToken: saved.resumeToken })).toEqual({
      sent: false,
      reason: 'no-email',
    });
    const emails = await w.query<{ n: number }>(sql`select count(*)::int as n from emails`);
    expect(emails[0]?.n).toBe(0);
  });

  it('stores only the hash of a token, so the row opens nothing on its own (AC-6330)', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const saved = await savePartial(scope, { formId, answers: { name: 'Asha Rao' }, stepId: 's2' });
    const rows = await w.query<{ token_hash: string }>(sql`select token_hash from form_partials`);
    const stored = rows[0]?.token_hash ?? '';
    // 64 hex digits, and the token itself appears nowhere in the row.
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(saved.resumeToken);
    expect(stored).toBe(partialTokenHash(saved.resumeToken));
  });

  it('refuses an unknown, malformed or another form’s token in the same words either way', async () => {
    const w = await workspace();
    const mine = await stepsForm(w);
    const theirs = await stepsForm(w);
    const { scope, formId } = await publicScope(mine.publicKey);
    const other = await publicScope(theirs.publicKey);
    const saved = await savePartial(other.scope, { formId: other.formId, answers: { name: 'Bo' }, stepId: 's2' });
    // Another form's live token, an unknown one and a malformed one: one answer, so probing learns nothing.
    for (const token of [saved.resumeToken, 'a'.repeat(43), 'not-a-token']) {
      expect(await refusalOf(resumePartial(scope, { formId, resumeToken: token })), token).toMatchObject([
        { code: 'NOT_FOUND', message: expect.stringContaining('expired') as unknown },
      ]);
    }
  });

  it('treats an expired partial as gone before the cleanup has reached it', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const saved = await savePartial(scope, { formId, answers: { name: 'Asha Rao' }, stepId: 's2' });
    await w.query(sql`update form_partials set expires_at = now() - interval '1 minute'`);
    expect(await refusalOf(resumePartial(scope, { formId, resumeToken: saved.resumeToken }))).toMatchObject([
      { code: 'NOT_FOUND' },
    ]);
  });

  it('keeps the answers whose questions a newer version still has, and drops the rest', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const saved = await savePartial(scope, {
      formId,
      answers: { name: 'Asha Rao', budget: 'About $5k' },
      stepId: 's2',
    });
    // The budget question goes, and the form is published again.
    const current = await publishForm(w.scope, {
      formId,
      expectedRevision: (
        await saveFormDraft(w.scope, {
          formId,
          document: {
            ...form.draft,
            questions: form.draft.questions.filter((each) => each.key !== 'budget'),
            // The step that started at it goes too: publish refuses a step starting at a question that is gone.
            steps: form.draft.steps.filter((step) => step.startsAt !== 'budget'),
          },
          expectedRevision: form.revision,
        })
      ).revision,
    });
    expect(current.live?.questions.some((each) => each.key === 'budget')).toBe(false);
    const resumed = await resumePartial(scope, { formId, resumeToken: saved.resumeToken });
    expect(resumed.answers).toEqual({ name: 'Asha Rao' });
  });

  it('checks a saved answer exactly as a submit does, keeping only what fits', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    await savePartial(scope, {
      formId,
      // A bad email, a key that is no question of this form, and one good answer.
      answers: { name: 'Asha Rao', email: 'not-an-email', nonsense: 'dropped' },
      stepId: 's2',
    });
    const rows = await w.query<{ answers: Record<string, unknown> }>(sql`select answers from form_partials`);
    expect(rows[0]?.answers).toEqual({ name: 'Asha Rao' });
  });

  it('says no when a form does not save progress, rather than storing one quietly', async () => {
    const w = await workspace();
    // Classic with four questions: under the threshold, so it saves nothing.
    const created = await createForm(w.scope, { id: newId(), name: 'Short form' });
    const saved = await saveFormDraft(w.scope, {
      formId: created.id,
      document: { ...created.draft, layout: 'classic' },
      expectedRevision: created.revision,
    });
    const form = await publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
    expect(savesProgress({ ...created.draft, layout: 'classic' })).toBe(false);
    const { scope, formId } = await publicScope(form.publicKey);
    expect(await refusalOf(savePartial(scope, { formId, answers: { name: 'Asha Rao' } }))).toMatchObject([
      { code: 'FORBIDDEN' },
    ]);
  });

  it('names the saved email for a resume link, and the link carries only the token (AC-6330)', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const saved = await savePartial(scope, {
      formId,
      answers: { name: 'Asha Rao', email: 'asha@example.com' },
      stepId: 's2',
    });
    const target = await resumeLinkTarget(scope, { formId, resumeToken: saved.resumeToken });
    expect(target.email).toBe('asha@example.com');
    expect(target.publicKey).toBe(form.publicKey);
    // Nothing of the fill rides anywhere but the token: the target names no answer and no step.
    expect(JSON.stringify(target)).not.toContain('Asha Rao');
    expect(JSON.stringify(target)).not.toContain('About $5k');
  });

  it('has no address to send to when the visitor has typed none', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const saved = await savePartial(scope, { formId, answers: { name: 'Asha Rao' }, stepId: 's2' });
    const target = await resumeLinkTarget(scope, { formId, resumeToken: saved.resumeToken });
    expect(target.email).toBeUndefined();
  });

  it('deletes nothing and throws nothing for an unknown token on submit', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    await savePartial(scope, { formId, answers: { name: 'Asha Rao' }, stepId: 's2' });
    await db.withWorkspace(w.workspaceId, (tx) => dropPartial(tx, formId, 'b'.repeat(43)));
    await db.withWorkspace(w.workspaceId, (tx) => dropPartial(tx, formId, 'not-a-token'));
    const left = await w.query<{ n: number }>(sql`select count(*)::int as n from form_partials`);
    expect(left[0]?.n).toBe(1);
  });
});

describe('the visitor’s confirmation (AC-6318)', () => {
  /**
   * A form that keeps its submissions only and mails the visitor a copy, with
   * the questions AC-6318 names. It files nothing on purpose: filing onto
   * People would force the email question to be required (it is how a
   * submission finds its Person), and one case here sends a submission with
   * no email at all.
   */
  async function confirmingForm(w: Workspace) {
    const created = await createForm(w.scope, { id: newId(), name: 'Contact us' });
    // Keeping its submissions only is a setting on the form, not just the document: the two must agree.
    const untargeted = await setFormTarget(w.scope, {
      formId: created.id,
      mainObjectId: null,
      expectedRevision: created.revision,
    });
    const document: FormDocument = {
      ...created.draft,
      targets: {},
      confirmation: { on: true, subject: 'We got your message, {{name}}', line: 'Thanks for writing in.' },
      questions: [
        question({ id: 'name', key: 'name', label: 'Your name', answerType: 'short_text' }),
        question({ id: 'email', key: 'email', label: 'Work email', answerType: 'email' }),
        question({
          id: 'secret',
          key: 'secret',
          label: 'Campaign',
          answerType: 'hidden',
          options: { default: 'spring' },
        }),
        question({ id: 'sign', key: 'sign', label: 'Your signature', answerType: 'signature' }),
      ],
    };
    const saved = await saveFormDraft(w.scope, {
      formId: created.id,
      document,
      expectedRevision: untargeted.revision,
    });
    return { form: await publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision }), document };
  }

  it('sends one copy to the visitor’s address, replying to the form’s owner', async () => {
    const w = await workspace();
    const { form } = await confirmingForm(w);
    const stored = await submit(form.publicKey, body({ name: 'Asha Rao', email: 'asha@example.com' }));
    expect(stored.verdict).toBe('passed');
    const ids = await w.query<{ id: string }>(sql`select id::text from form_submissions`);
    await processNow(w, ids[0]?.id ?? '');
    const mail = await w.query<{ kind: string; to_address: string; reply_to_member_id: string | null }>(
      sql`select kind, to_address, reply_to_member_id::text from emails where kind = 'form_confirmation'`,
    );
    expect(mail).toHaveLength(1);
    expect(mail[0]?.to_address).toBe('asha@example.com');
    expect(mail[0]?.reply_to_member_id).toBe(w.ownerId);
  });

  it('sends nothing when the form has it off', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Quiet form' });
    const saved = await saveFormDraft(w.scope, {
      formId: created.id,
      document: created.draft,
      expectedRevision: created.revision,
    });
    const form = await publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
    expect(sendsConfirmation({ confirmation: undefined })).toBe(false);
    await submit(form.publicKey, body({ name: 'Asha Rao', email: 'asha@example.com' }));
    const ids = await w.query<{ id: string }>(sql`select id::text from form_submissions`);
    await processNow(w, ids[0]?.id ?? '');
    const mail = await w.query<{ n: number }>(
      sql`select count(*)::int as n from emails where kind = 'form_confirmation'`,
    );
    expect(mail[0]?.n).toBe(0);
  });

  it('sends nothing for a spam submission', async () => {
    const w = await workspace();
    const { form } = await confirmingForm(w);
    // The honeypot: stored as spam, which never reaches processing at all.
    await submit(form.publicKey, body({ name: 'Bot', email: 'bot@example.com' }, { company_url: 'http://spam' }));
    const rows = await w.query<{ id: string; state: string }>(sql`select id::text, state from form_submissions`);
    expect(rows[0]?.state).toBe('spam');
    await processNow(w, rows[0]?.id ?? '');
    const mail = await w.query<{ n: number }>(
      sql`select count(*)::int as n from emails where kind = 'form_confirmation'`,
    );
    expect(mail[0]?.n).toBe(0);
  });

  it('sends nothing for a held submission, and one once it is released', async () => {
    const w = await workspace();
    const { form } = await confirmingForm(w);
    const stored = await submit(form.publicKey, body({ name: 'Asha Rao', email: 'asha@example.com' }));
    expect(stored.verdict).toBe('passed');
    const ids = await w.query<{ id: string }>(sql`select id::text from form_submissions`);
    const id = ids[0]?.id ?? '';
    // Held: `needs_review`, which processing leaves alone, so no copy goes.
    await w.query(sql`update form_submissions set state = 'needs_review' where id = ${id}`);
    await processNow(w, id);
    const held = await w.query<{ n: number }>(
      sql`select count(*)::int as n from emails where kind = 'form_confirmation'`,
    );
    expect(held[0]?.n).toBe(0);
    // Released back to received and processed: now the visitor gets their copy.
    await w.query(sql`update form_submissions set state = 'received' where id = ${id}`);
    await processNow(w, id);
    const sent = await w.query<{ n: number }>(
      sql`select count(*)::int as n from emails where kind = 'form_confirmation'`,
    );
    expect(sent[0]?.n).toBe(1);
  });

  it('sends one email however many times processing runs', async () => {
    const w = await workspace();
    const { form } = await confirmingForm(w);
    await submit(form.publicKey, body({ name: 'Asha Rao', email: 'asha@example.com' }));
    const ids = await w.query<{ id: string }>(sql`select id::text from form_submissions`);
    const id = ids[0]?.id ?? '';
    await processNow(w, id);
    await w.query(sql`update form_submissions set state = 'received', processed_at = null where id = ${id}`);
    await processNow(w, id);
    const mail = await w.query<{ n: number }>(
      sql`select count(*)::int as n from emails where kind = 'form_confirmation'`,
    );
    expect(mail[0]?.n).toBe(1);
  });

  it('leaves hidden answers out, shows a signature as Signed, and reads a recall as plain text', async () => {
    const w = await workspace();
    const { document } = await confirmingForm(w);
    const rows = confirmationRows(document, {
      name: 'Asha <b>Rao</b>',
      email: 'asha@example.com',
      secret: 'spring',
      sign: { id: newId(), name: 'sign.png', size: 400, contentType: 'image/png' },
    });
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));
    // The hidden Campaign question is absent whatever it holds: the visitor never saw it.
    expect(Object.keys(byLabel)).not.toContain('Campaign');
    expect(byLabel['Your signature']).toBe(SIGNED_WORD);
    // An answer with angle brackets keeps them as characters: text in, text out, never markup.
    expect(byLabel['Your name']).toBe('Asha <b>Rao</b>');
    // A consent reads as Agreed; one left unticked isn't in their copy at all (forms fix b9).
    const withConsent = {
      ...document,
      questions: [
        ...document.questions,
        {
          id: 'news',
          key: 'news',
          label: 'Send me news',
          answerType: 'consent' as const,
          required: false,
          update: 'fill' as const,
        },
      ],
    };
    const ticked = confirmationRows(withConsent, { name: 'Asha', news: true });
    expect(ticked.find((row) => row.label === 'Send me news')?.value).toBe('Agreed');
    const unticked = confirmationRows(withConsent, { name: 'Asha', news: false });
    expect(unticked.some((row) => row.label === 'Send me news')).toBe(false);
  });

  it('sends nothing when the visitor gave no email address', async () => {
    const w = await workspace();
    const { form } = await confirmingForm(w);
    await submit(form.publicKey, body({ name: 'Asha Rao' }));
    const ids = await w.query<{ id: string }>(sql`select id::text from form_submissions`);
    await processNow(w, ids[0]?.id ?? '');
    const mail = await w.query<{ n: number }>(
      sql`select count(*)::int as n from emails where kind = 'form_confirmation'`,
    );
    expect(mail[0]?.n).toBe(0);
  });
});

describe('analytics (AC-6320, AC-6321)', () => {
  /** Counts one event for a visitor, as the beacon's route does. */
  async function event(
    publicKey: string,
    visitor: string,
    kind: 'view' | 'start' | 'reach',
    extra: { readonly questionId?: string; readonly source?: { utmSource?: string; referrer?: string } } = {},
  ) {
    const { scope, formId } = await publicScope(publicKey);
    // The route's own translation (spec 0067): a UTM word as the landing's source, the referrer beside it.
    const { source, ...rest } = extra;
    const origin =
      source === undefined
        ? undefined
        : originOf({
            ...(source.utmSource === undefined ? {} : { landing: { utm_source: source.utmSource } }),
            ...(source.referrer === undefined ? {} : { referrer: source.referrer }),
          });
    await countFormEvent(scope, { formId, visitor, kind, ...rest, ...(origin === undefined ? {} : { origin }) });
  }

  it('counts ten views, six starts, three completions and three left on question four', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const visitors = Array.from({ length: 10 }, (_, at) => visitorHash(`v${String(at)}`));
    for (const visitor of visitors) await event(form.publicKey, visitor, 'view');
    // Six of them started; three of those reached the fourth question and stopped there.
    for (const visitor of visitors.slice(0, 6)) await event(form.publicKey, visitor, 'start');
    for (const visitor of visitors.slice(0, 3)) await event(form.publicKey, visitor, 'reach', { questionId: 'why' });
    // Three others finished, which is a completion whatever question they were last seen on.
    for (const visitor of visitors.slice(3, 6)) {
      await db.withWorkspace(w.workspaceId, (tx) =>
        completeFormVisit(tx, { workspaceId: w.workspaceId, formId: form.id, visitor }),
      );
    }
    const read = await formAnalytics(w.scope, { formId: form.id, range: 7 });
    expect(read.totals).toMatchObject({ views: 10, starts: 6, completions: 3 });
    // 3 of 6 starts finished: the tab's completion rate is 50%.
    expect(read.totals.completions / read.totals.starts).toBe(0.5);
    const why = read.byQuestion.find((row) => row.questionId === 'why');
    expect(why).toMatchObject({ leftHere: 3 });
    // The drop off bar sits on the fourth question, and the earlier ones lost nobody.
    expect(read.byQuestion.map((row) => row.leftHere)).toEqual([0, 0, 0, 3]);
    expect(read.byQuestion.at(-1)?.questionId).toBe('why');
  });

  it('counts a visitor once a day however many times they look', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const visitor = visitorHash('one');
    for (let at = 0; at < 5; at += 1) await event(form.publicKey, visitor, 'view');
    const read = await formAnalytics(w.scope, { formId: form.id, range: 7 });
    expect(read.totals.views).toBe(1);
  });

  it('never moves the furthest question backwards when a visitor goes Back', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const visitor = visitorHash('back');
    await event(form.publicKey, visitor, 'view');
    await event(form.publicKey, visitor, 'reach', { questionId: 'why' });
    await event(form.publicKey, visitor, 'reach', { questionId: 'budget' });
    const rows = await w.query<{ furthest_detail: string }>(sql`select furthest_detail from page_visits`);
    // Reaching an earlier question again leaves the furthest one where it was.
    expect(rows[0]?.furthest_detail).toBe('why');
  });

  it('measures the median from the first answer only, so a later start never moves the clock', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const visitor = visitorHash('median');
    await event(form.publicKey, visitor, 'view');
    await event(form.publicKey, visitor, 'start');
    const first = await w.query<{ started_at: string }>(sql`select started_at::text from page_visits`);
    await event(form.publicKey, visitor, 'start');
    const again = await w.query<{ started_at: string }>(sql`select started_at::text from page_visits`);
    expect(again[0]?.started_at).toBe(first[0]?.started_at);
  });

  it('stores no cookie, no address and no visitor id beyond the daily hash (AC-6320)', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const visitor = visitorHash('privacy');
    await event(form.publicKey, visitor, 'view', { source: { referrer: 'https://news.example.com/a/long/path?q=1' } });
    const rows = await w.query<Record<string, unknown>>(sql`select * from page_visits`);
    const row = rows[0] ?? {};
    // The visitor is 32 hex digits, which is the daily hash, and the column refuses anything else.
    expect(String(row.visitor)).toMatch(/^[0-9a-f]{32}$/);
    // Only the referring host survives: no path, no query, and never a whole address (spec 0067: Other's host).
    expect(row.source).toBe('other');
    expect(row.referrer_host).toBe('news.example.com');
    const asText = JSON.stringify(rows);
    expect(asText).not.toContain('/a/long/path');
    expect(asText).not.toContain('q=1');
    // And no column holds an address or anything cookie shaped.
    expect(Object.keys(row).sort()).toEqual([
      'campaign',
      'day',
      'duration_ms',
      'finished_at',
      'first_at',
      'furthest_detail',
      'furthest_step',
      'landing',
      'last_at',
      'medium',
      'outcome_id',
      'page_id',
      'page_kind',
      'referrer_host',
      'source',
      'started_at',
      'step_rank',
      'visitor',
      'workspace_id',
    ]);
  });

  it('refuses a visitor that is not a daily hash, so an address can never be stored as one', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    for (const bad of ['203.0.113.9', 'asha@example.com', 'ABCDEF0123456789abcdef0123456789']) {
      await expect(countFormEvent(scope, { formId, visitor: bad, kind: 'view' }), bad).rejects.toThrow(TypeError);
    }
  });

  it('groups by source, keeping a UTM word over a referrer and Direct for neither', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    await event(form.publicKey, visitorHash('u1'), 'view', { source: { utmSource: 'Newsletter' } });
    await event(form.publicKey, visitorHash('u2'), 'view', {
      source: { utmSource: 'newsletter', referrer: 'https://x.example.com' },
    });
    await event(form.publicKey, visitorHash('r1'), 'view', { source: { referrer: 'https://www.news.example.com/x' } });
    await event(form.publicKey, visitorHash('d1'), 'view', {});
    const read = await formAnalytics(w.scope, { formId: form.id, range: 7 });
    expect(read.bySource).toEqual([
      { source: 'newsletter', views: 2, completions: 0 },
      { source: 'direct', views: 1, completions: 0 },
      { source: 'news.example.com', views: 1, completions: 0 },
    ]);
  });

  it('gives the range before it for the change line, and a day series inside it', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    await event(form.publicKey, visitorHash('now'), 'view');
    // One view 10 days back: inside the 30 day range's previous window, outside the 7 day range entirely.
    // The version is read back rather than guessed, so the row's own foreign key holds.
    await w.query(
      sql`insert into page_visits (workspace_id, page_kind, page_id, day, visitor, source)
          values (${w.workspaceId}, 'form', ${form.id}, (now() at time zone 'UTC')::date - 10, ${visitorHash('old')}, 'direct')`,
    );
    const week = await formAnalytics(w.scope, { formId: form.id, range: 7 });
    expect(week.totals.views).toBe(1);
    expect(week.previous.views).toBe(1);
    expect(week.byDay).toHaveLength(1);
    const month = await formAnalytics(w.scope, { formId: form.id, range: 30 });
    expect(month.totals.views).toBe(2);
    expect(month.previous.views).toBe(0);
    expect(month.byDay).toHaveLength(2);
  });

  it('counts a completion only for an accepted submit, never for spam', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const clean = visitorHash('clean');
    const bot = visitorHash('bot');
    await event(form.publicKey, clean, 'view');
    await event(form.publicKey, bot, 'view');
    await submit(form.publicKey, body({ name: 'Asha Rao', email: 'asha@example.com' }), { visitor: clean });
    await submit(form.publicKey, body({ name: 'Bot', email: 'bot@example.com' }, { company_url: 'http://spam' }), {
      visitor: bot,
    });
    const read = await formAnalytics(w.scope, { formId: form.id, range: 7 });
    expect(read.totals.completions).toBe(1);
    const rows = await w.query<{ visitor: string }>(sql`select visitor from page_visits where finished_at is not null`);
    expect(rows.map((row) => row.visitor)).toEqual([clean]);
  });

  it('answers nothing to a member the form’s object is hidden from, rather than zeroes', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    await event(form.publicKey, visitorHash('seen'), 'view');
    // People hidden from this admin: the form is absent to them, so its numbers are too. Hidden means absent,
    // never a locked report that still admits the form exists and how it is doing.
    const blind = rescope(w.scope, {
      role: 'admin',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'admin' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    expect(await refusalOf(formAnalytics(blind, { formId: form.id, range: 7 }))).toMatchObject([{ code: 'NOT_FOUND' }]);
    // And the owner, who may see it, still gets the figure: the refusal above is access, not an empty table.
    expect((await formAnalytics(w.scope, { formId: form.id, range: 7 })).totals.views).toBe(1);
  });

  it('answers nothing for a form in another workspace (AC-6329)', async () => {
    const mine = await workspace();
    const theirs = await workspace();
    const form = await stepsForm(theirs);
    await event(form.publicKey, visitorHash('theirs'), 'view');
    // The form is simply not there, as hidden always is here: not a locked report.
    expect(await refusalOf(formAnalytics(mine.scope, { formId: form.id, range: 7 }))).toMatchObject([
      { code: 'NOT_FOUND' },
    ]);
  });

  it('is empty, not broken, for a form nobody has visited', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const read = await formAnalytics(w.scope, { formId: form.id, range: 30 });
    expect(read.totals).toEqual({ views: 0, starts: 0, completions: 0, submissions: 0 });
    expect(read.byDay).toEqual([]);
    expect(read.bySource).toEqual([]);
    // Every question still has a row, all zero, so the tab draws the form's shape rather than nothing.
    expect(read.byQuestion).toHaveLength(4);
    expect(read.byQuestion.every((row) => row.reached === 0 && row.leftHere === 0)).toBe(true);
    expect(read.countingSince).toBeUndefined();
  });

  /** The steps form with a choice question after the note, so the Answers section has bars to count. */
  const withPlan = (document: FormDocument): FormDocument => ({
    ...document,
    questions: [
      ...document.questions,
      question({ id: 'plan', key: 'plan', label: 'Which plan?', answerType: 'choice', choices: ['Basic', 'Pro'] }),
    ],
  });

  it('counts stored submissions with no visit counted, and reads each question’s answers (lane 3c)', async () => {
    const w = await workspace();
    const form = await stepsForm(w, withPlan);
    for (const [at, plan] of ['Pro', 'Basic', 'Pro'].entries()) {
      await submit(
        form.publicKey,
        body({ name: `Visitor ${String(at)}`, email: `v${String(at)}@example.com`, why: `Reason ${String(at)}`, plan }),
      );
    }
    const read = await formAnalytics(w.scope, { formId: form.id, range: 30 });
    // Three submissions the Submissions tab lists, though no visit was ever counted: never "0 finished".
    expect(read.totals).toMatchObject({ views: 0, completions: 0, submissions: 3 });
    const plan = read.answers.find((answer) => answer.questionId === 'plan');
    expect(plan).toMatchObject({ responses: 3 });
    expect(plan?.choices).toEqual([
      { value: 'Pro', count: 2 },
      { value: 'Basic', count: 1 },
    ]);
    const why = read.answers.find((answer) => answer.questionId === 'why');
    expect(why?.responses).toBe(3);
    expect(why?.latest).toEqual(['Reason 2', 'Reason 1', 'Reason 0']);
    // An email is a contact: its card counts the answers, so the form's numbering holds, and never lists one.
    const emailQuestion = read.answers.find((answer) => answer.questionId === 'email');
    expect(emailQuestion).toEqual({ questionId: 'email', responses: 3 });
    expect(JSON.stringify(read)).not.toContain('@example.com');
  });

  it('leaves out a question saved on a field hidden from the reader, and submissions they can’t see', async () => {
    const w = await workspace();
    const form = await stepsForm(w, withPlan);
    await submit(form.publicKey, body({ name: 'Grace Hopper', email: 'grace@example.com', why: 'Hi', plan: 'Pro' }));
    const nameField = form.live?.questions.find((each) => each.key === 'name')?.filedOn?.attributeId;
    expect(nameField).toBeDefined();
    // An admin whose rules hide the field the name is saved on (AC-573): no card for it, and the name never shows.
    const nameHidden = rescope(w.scope, {
      role: 'admin',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'admin' },
            target: { type: 'attribute', objectId: w.people, attributeId: nameField ?? '' },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    const hidden = await formAnalytics(nameHidden, { formId: form.id, range: 30 });
    expect(hidden.answers.some((answer) => answer.questionId === 'name')).toBe(false);
    expect(JSON.stringify(hidden)).not.toContain('Grace Hopper');
    expect(hidden.answers.find((answer) => answer.questionId === 'plan')?.responses).toBe(1);
    // A member who may not manage forms sees none of a submission with no record yet, as Submissions hides it.
    const member = rescope(w.scope, { role: 'member' });
    const theirs = await formAnalytics(member, { formId: form.id, range: 30 });
    expect(theirs.totals.submissions).toBe(0);
    expect(theirs.answers.every((answer) => answer.responses === 0)).toBe(true);
    expect(JSON.stringify(theirs)).not.toContain('Hi');
  });
});

describe('the public read with a resume token', () => {
  it('carries the saved answers and step, and says the form saves progress', async () => {
    const w = await workspace();
    const form = await stepsForm(w);
    const { scope, formId } = await publicScope(form.publicKey);
    const read = await getPublicForm(scope, { formId });
    expect(read.savesProgress).toBe(true);
    const saved = await savePartial(scope, { formId, answers: { name: 'Asha Rao' }, stepId: 's2' });
    const resumed = await resumePartial(scope, { formId, resumeToken: saved.resumeToken });
    expect(resumed).toMatchObject({ answers: { name: 'Asha Rao' }, stepId: 's2' });
  });

  it('does not offer Finish later on a short Classic form', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Short' });
    const saved = await saveFormDraft(w.scope, {
      formId: created.id,
      document: { ...created.draft, layout: 'classic' },
      expectedRevision: created.revision,
    });
    const form = await publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
    const { scope, formId } = await publicScope(form.publicKey);
    expect((await getPublicForm(scope, { formId })).savesProgress).toBeUndefined();
  });
});
