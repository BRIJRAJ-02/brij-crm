// Spec 0023 (0023-experience.md), against a real Postgres as the app role:
// building and publishing a form, the settings that apply at once, the
// public read and submit through the address's scope, the bot checks,
// idempotency, and processing a submission into a record as the form
// (match, fill or always, choices by label, refused values skipped, one
// person for two racing submissions), its timeline entry, and the
// submissions screen's reads and actions.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, FormQuestion, SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import type { AccessRules } from '../access/policy.ts';
import { createAttribute, editAttribute } from '../attributes/attributes.ts';
import { getActivity } from '../engine/activity.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord, getRecords } from '../engine/records.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { rescope, testScope } from '../testing.ts';
import {
  createForm,
  deleteForm,
  duplicateForm,
  formAttributes,
  getForm,
  isSlugAvailable,
  listForms,
  publishForm,
  saveFormDraft,
  setFormStatus,
  updateFormSettings,
} from './forms.ts';
import { processSubmission } from './process.ts';
import { getPublicForm, postingRules, submitForm, type CaptchaVerdict } from './public.ts';
import {
  deleteSubmission,
  getSubmission,
  listSubmissions,
  markSubmissionSpam,
  releaseSubmission,
  retrySubmission,
} from './submissions.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-forms-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Forms',
    slug: `forms-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const attribute = (slug: string): string => {
    const id = ids[slug];
    if (id === undefined) throw new Error(`No attribute ${slug}.`);
    return id;
  };
  const people = created.objects.people ?? '';
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  return { scope, system, ownerId: created.memberId, people, attribute, query };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('It was let through.');
}

const question = (
  changes: Partial<FormQuestion> & Pick<FormQuestion, 'id' | 'key' | 'label' | 'answerType'>,
): FormQuestion => ({
  required: false,
  update: 'fill',
  ...changes,
});

/** A People form asking name, email and phone, job title (fill), description (always) and a note kept on the submission, published. */
async function liveForm(w: Workspace, changes: (document: FormDocument) => FormDocument = (d) => d) {
  const created = await createForm(w.scope, { id: newId(), name: 'Contact us' });
  const document: FormDocument = changes({
    ...created.draft,
    questions: [
      ...created.draft.questions,
      question({
        id: 'title',
        key: 'title',
        label: 'Job title',
        answerType: 'short_text',
        filedOn: { objectRole: 'main', attributeId: w.attribute('people.job_title') },
      }),
      question({
        id: 'about',
        key: 'about',
        label: 'About you',
        answerType: 'long_text',
        update: 'always',
        filedOn: { objectRole: 'main', attributeId: w.attribute('people.description') },
      }),
      question({ id: 'why', key: 'why', label: 'Why are you here?', answerType: 'long_text' }),
    ],
  });
  const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision });
  return publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
}

const off: CaptchaVerdict = { kind: 'off' };

function body(answers: Record<string, unknown>, extra: Partial<SubmitBody> = {}): SubmitBody {
  return { idempotencyKey: newId(), answers, hidden: {}, fillMs: 10_000, ...extra };
}

async function submit(publicKey: string, input: SubmitBody, captcha: CaptchaVerdict = off) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  return submitForm(scope, registry, { formId, body: input, captcha });
}

/** Runs processing for a submission as the job does: in one write under the system's scope. */
async function processNow(w: Workspace, submissionId: string) {
  await runWrite(w.system, (context) => processSubmission(context, submissionId));
}

async function submissionIds(w: Workspace, formId: string) {
  return w.query<{ id: string; state: string }>(
    sql`select id::text, state from form_submissions where form_id = ${formId} order by received_at, id`,
  );
}

describe('building and publishing (AC-545, AC-546, AC-548, AC-549, AC-552, AC-649, AC-655)', () => {
  it('creates an untitled People form with Name, Email and Phone, an address and its creator as owner', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId() });
    expect(created).toMatchObject({
      name: 'Untitled form',
      status: 'draft',
      ownerMemberId: w.ownerId,
      mainObjectId: w.people,
    });
    expect(created.publicKey).toMatch(/^form-[a-z0-9]{6}$/);
    expect(created.draft.questions.map((each) => [each.key, each.answerType, each.filedOn?.attributeId])).toEqual([
      ['name', 'short_text', w.attribute('people.name')],
      ['email', 'email', w.attribute('people.email_addresses')],
      ['phone', 'phone', w.attribute('people.phone_numbers')],
    ]);
    expect(created.draft.targets.main.matchAttributeId).toBe(w.attribute('people.email_addresses'));
    const published = await publishForm(w.scope, {
      formId: created.id,
      expectedRevision: created.revision,
      name: 'Contact us',
      slug: 'contact-us',
    });
    expect(published).toMatchObject({
      status: 'live',
      liveVersionNumber: 1,
      hasUnpublished: false,
      name: 'Contact us',
      publicKey: 'contact-us',
    });
    // Editing after a publish starts version 2; the live version stays 1 until the next publish.
    const edited = await saveFormDraft(w.scope, {
      formId: created.id,
      document: { ...published.draft, headline: 'Talk to us' },
      expectedRevision: published.revision,
    });
    expect(edited).toMatchObject({ draftNumber: 2, liveVersionNumber: 1, hasUnpublished: true });
    expect(edited.live?.headline).toBe('Fill this in and we will come back to you');
    const listed = await listForms(w.scope, { archived: false });
    expect(listed.items.map((form) => [form.name, form.submissionsThisMonth, form.spamCount])).toEqual([
      ['Contact us', 0, 0],
    ]);
  });

  it('refuses a stale save, a taken address, and every change from a member without forms.manage', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId() });
    await saveFormDraft(w.scope, { formId: created.id, document: created.draft, expectedRevision: created.revision });
    expect(
      await refusalOf(
        saveFormDraft(w.scope, { formId: created.id, document: created.draft, expectedRevision: created.revision }),
      ),
    ).toMatchObject([{ code: 'FORM_CHANGED' }]);
    const other = await createForm(w.scope, { id: newId() });
    await updateFormSettings(w.scope, { formId: other.id, slug: 'taken-one' });
    expect(await isSlugAvailable(w.scope, { formId: created.id, slug: 'taken-one' })).toEqual({ available: false });
    expect(await isSlugAvailable(w.scope, { formId: other.id, slug: 'taken-one' })).toEqual({ available: true });
    expect(await refusalOf(updateFormSettings(w.scope, { formId: created.id, slug: 'taken-one' }))).toMatchObject([
      { code: 'SLUG_TAKEN', field: 'slug' },
    ]);
    const member = rescope(w.scope, { role: 'member' });
    expect(await refusalOf(createForm(member, { id: newId() }))).toMatchObject([{ code: 'FORBIDDEN' }]);
    expect((await getForm(member, { formId: created.id })).canManage).toBe(false);
    expect((await getForm(member, { formId: created.id })).signingSecret).toBeUndefined();
  });

  it('refuses a publish with the first problem, on the question at fault (AC-655)', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Contact us' });
    const unlabelled = {
      ...created.draft,
      questions: created.draft.questions.map((each) => (each.key === 'phone' ? { ...each, label: '' } : each)),
    };
    const saved = await saveFormDraft(w.scope, {
      formId: created.id,
      document: unlabelled,
      expectedRevision: created.revision,
    });
    expect(await refusalOf(publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision }))).toEqual([
      expect.objectContaining({ code: 'CONFIG_INVALID', message: 'Every question needs a label.', field: 'phone' }),
    ]);
  });

  it('refuses a publish filing onto a field the publisher can only read, naming it (AC-546)', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Contact us' });
    const phone = w.attribute('people.phone_numbers');
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'admin' },
          target: { type: 'attribute', objectId: w.people, attributeId: phone },
          level: 'read',
        },
      ],
      records: [],
    };
    const admin = rescope(w.scope, { role: 'admin', rules });
    const choices = await formAttributes(admin, { formId: created.id });
    expect(choices.objectName).toBe('Person');
    expect(choices.items.find((item) => item.attributeId === phone)?.canWrite).toBe(false);
    expect(await refusalOf(publishForm(admin, { formId: created.id, expectedRevision: created.revision }))).toEqual([
      expect.objectContaining({
        code: 'FORBIDDEN',
        message: "You can't write to Person · Phone numbers, so this form can't file answers there.",
        field: 'phone',
      }),
    ]);
  });

  it('pauses and resumes, archives and restores, duplicates and deletes a form', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    expect((await setFormStatus(w.scope, { formId: live.id, status: 'paused' })).status).toBe('paused');
    const visitor = await enterPublicForm({ db }, live.publicKey);
    expect(await getPublicForm(visitor.scope, { formId: visitor.formId })).toMatchObject({
      status: 'paused',
      questions: [],
    });
    expect(await refusalOf(submit(live.publicKey, body({ email: 'x@example.com' })))).toMatchObject([
      { code: 'FORM_CLOSED' },
    ]);
    await setFormStatus(w.scope, { formId: live.id, status: 'live' });
    const copy = await duplicateForm(w.scope, { formId: live.id, id: newId() });
    expect(copy).toMatchObject({ name: 'Contact us copy', status: 'draft' });
    expect(copy.publicKey).not.toBe(live.publicKey);
    expect(copy.draft.questions.map((each) => each.key)).toEqual(live.draft.questions.map((each) => each.key));
    await submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com' }));
    await deleteForm(w.scope, { formId: live.id });
    expect((await listForms(w.scope, { archived: false })).items.map((form) => form.id)).toEqual([copy.id]);
    expect(await w.query(sql`select 1 from form_submissions`)).toEqual([]);
    await expect(enterPublicForm({ db }, live.publicKey)).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
  });

  it('changes the address at once, so the old link names nothing (AC-552)', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const moved = await updateFormSettings(w.scope, { formId: live.id, slug: 'talk-to-us', ownerMemberId: null });
    expect(moved).toMatchObject({ publicKey: 'talk-to-us', revision: live.revision });
    expect(moved.ownerMemberId).toBeUndefined();
    await expect(enterPublicForm({ db }, live.publicKey)).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
    await expect(enterPublicForm({ db }, 'talk-to-us')).resolves.toMatchObject({ formId: live.id });
  });
});

describe('the public form and submit (AC-553 to AC-556, AC-659)', () => {
  it('renders the live version with no attribute ids, filing or owner', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const { scope, formId } = await enterPublicForm({ db }, live.publicKey);
    const rendered = await getPublicForm(scope, { formId });
    expect(rendered).toMatchObject({ status: 'live', versionNumber: 1, buttonText: 'Send', offersMeeting: false });
    const text = JSON.stringify(rendered);
    for (const id of [w.attribute('people.email_addresses'), w.attribute('people.name'), w.people, w.ownerId]) {
      expect(text).not.toContain(id);
    }
    expect(rendered.questions.map((each) => each.key)).toEqual(['name', 'email', 'phone', 'title', 'about', 'why']);
    expect(await postingRules(scope, { formId })).toMatchObject({ allowedOrigins: [], requireSignature: false });
  });

  it('stores a valid submission once per attempt with its job queued', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const attempt = body({ name: 'Ada Lovelace', email: 'ada@example.com', smuggled: 'dropped' });
    expect(await submit(live.publicKey, attempt)).toEqual({
      next: { kind: 'message', text: '', offersMeeting: false },
      verdict: 'passed',
      replayed: false,
    });
    expect(await submit(live.publicKey, attempt)).toMatchObject({ replayed: true });
    expect(await w.query(sql`select answers, state from form_submissions`)).toEqual([
      { state: 'received', answers: { name: 'Ada Lovelace', email: 'ada@example.com' } },
    ]);
    expect(await w.query(sql`select kind from jobs where kind = 'forms.process'`)).toHaveLength(1);
  });

  it('refuses answers that fail, naming each question by key, and stores nothing', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const refusals = await refusalOf(submit(live.publicKey, body({ email: 'not an email' })));
    expect(refusals.map((refusal) => refusal.field).sort()).toEqual(['email', 'name']);
    expect(await submissionIds(w, live.id)).toEqual([]);
  });

  it('keeps a filled honeypot, a fill under 2 seconds and a low reCAPTCHA score as spam, with no job', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const answers = { name: 'Ada Lovelace', email: 'ada@example.com' };
    await submit(live.publicKey, body(answers, { company_url: 'https://spam.example' }));
    await submit(live.publicKey, body(answers, { fillMs: 1_500 }));
    const outcome = await submit(live.publicKey, body(answers), { kind: 'score', score: 0.1 });
    expect(outcome.next).toMatchObject({ kind: 'message' });
    expect(
      await w.query<{ state: string; signals: string[] }>(
        sql`select state, spam->'signals' as signals from form_submissions order by received_at`,
      ),
    ).toEqual([
      { state: 'spam', signals: ['honeypot'] },
      { state: 'spam', signals: ['too_fast'] },
      { state: 'spam', signals: ['captcha_low_score'] },
    ]);
    expect(await w.query(sql`select 1 from jobs where kind = 'forms.process'`)).toEqual([]);
  });
});

describe('processing a submission (AC-557, AC-558, AC-561, AC-562, AC-564, AC-565, AC-567)', () => {
  it('creates the person as the form, with the owner, and records it on the submission and the timeline', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(
      live.publicKey,
      body({
        name: 'Ada Lovelace',
        email: 'ADA@example.com',
        phone: { number: '+447700900123', country: 'GB' },
        title: 'Engineer',
        why: 'Engines',
      }),
    );
    const [submission] = await submissionIds(w, live.id);
    if (submission === undefined) throw new Error('No submission.');
    await processNow(w, submission.id);
    const view = await getSubmission(w.scope, { submissionId: submission.id });
    expect(view).toMatchObject({
      state: 'processed',
      email: 'ada@example.com',
      records: [{ role: 'main', action: 'created', record: { name: 'Ada Lovelace' } }],
      assignment: { memberId: w.ownerId, reason: 'fixed_member' },
      refused: [],
    });
    expect(view.answers.map((answer) => [answer.key, answer.attributeId !== undefined])).toEqual([
      ['name', true],
      ['email', true],
      ['phone', true],
      ['title', true],
      ['why', false],
    ]);
    const recordId = view.mainRecord?.recordId ?? '';
    const [record] = await getRecords(w.scope, { ids: [recordId] });
    expect(record?.createdBy).toEqual({ type: 'form', id: live.id });
    expect(record?.values[w.attribute('people.name')]).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(record?.values[w.attribute('people.phone_numbers')]).toEqual([{ number: '+447700900123', country: 'GB' }]);
    expect(record?.values[w.attribute('people.owner')]).toEqual({ type: 'member', id: w.ownerId });
    const activity = await getActivity(w.scope, { recordId });
    expect(activity.entries.find((entry) => entry.kind === 'submission')).toMatchObject({
      title: 'Contact us',
      action: 'created',
      actor: { type: 'form', id: live.id },
    });
    await processNow(w, submission.id);
    expect(await w.query(sql`select 1 from form_submission_records`)).toHaveLength(1);
  });

  it('matches on the email, fills only empty values, overwrites an always question', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const existing = await createRecord(w.scope, {
      objectId: w.people,
      values: {
        [w.attribute('people.name')]: { firstName: 'Ada' },
        [w.attribute('people.email_addresses')]: ['ada@example.com'],
        [w.attribute('people.job_title')]: 'Countess',
        [w.attribute('people.description')]: 'Old notes',
      },
    });
    await submit(
      live.publicKey,
      body({ name: 'Ada Lovelace', email: 'ada@example.com', title: 'Engineer', about: 'Wrote the first program' }),
    );
    const [submission] = await submissionIds(w, live.id);
    if (submission === undefined) throw new Error('No submission.');
    await processNow(w, submission.id);
    const [record] = await getRecords(w.scope, { ids: [existing.recordId] });
    expect(record?.values[w.attribute('people.job_title')]).toBe('Countess');
    expect(record?.values[w.attribute('people.description')]).toBe('Wrote the first program');
    expect((await getSubmission(w.scope, { submissionId: submission.id })).records).toMatchObject([
      { action: 'updated', record: { recordId: existing.recordId } },
    ]);
  });

  it('files a choice by its option’s label, and records a choice the attribute has no option for (AC-565)', async () => {
    const w = await workspace();
    const tier = await createAttribute(w.scope, {
      objectId: w.people,
      id: newId(),
      title: 'Tier',
      type: 'select',
      options: [{ id: newId(), label: 'Gold', hue: 'yellow' }],
    });
    const live = await liveForm(w, (document) => ({
      ...document,
      questions: [
        ...document.questions,
        question({
          id: 'tier',
          key: 'tier',
          label: 'Tier',
          answerType: 'dropdown',
          choices: ['Gold', 'Silver'],
          filedOn: { objectRole: 'main', attributeId: tier.id },
        }),
      ],
    }));
    await submit(live.publicKey, body({ name: 'Gold Person', email: 'gold@example.com', tier: 'Gold' }));
    await submit(live.publicKey, body({ name: 'Silver Person', email: 'silver@example.com', tier: 'Silver' }));
    const [gold, silver] = await submissionIds(w, live.id);
    if (gold === undefined || silver === undefined) throw new Error('Two submissions.');
    await processNow(w, gold.id);
    await processNow(w, silver.id);
    const goldView = await getSubmission(w.scope, { submissionId: gold.id });
    const [goldRecord] = await getRecords(w.scope, { ids: [goldView.mainRecord?.recordId ?? ''] });
    expect(goldRecord?.values[tier.id]).toEqual(expect.any(String));
    expect((await getSubmission(w.scope, { submissionId: silver.id })).refused).toEqual([
      { questionId: 'tier', message: 'Tier has no option called “Silver”.' },
    ]);
  });

  it('makes one person from two submissions for one new email processed at once (AC-562)', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(live.publicKey, body({ name: 'Twin', email: 'twin@example.com' }));
    await submit(live.publicKey, body({ name: 'Twin', email: 'twin@example.com' }));
    const [one, two] = await submissionIds(w, live.id);
    if (one === undefined || two === undefined) throw new Error('Two submissions expected.');
    await Promise.all([processNow(w, one.id), processNow(w, two.id)]);
    const people = await w.query(
      sql`select distinct record_id from "values" where attribute_id = ${w.attribute('people.email_addresses')} and active_until is null`,
    );
    expect(people).toHaveLength(1);
  });

  it('skips a value a rule refuses now, writes the rest, and says why (AC-565)', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(live.publicKey, body({ name: 'Ada', email: 'rule@example.com', title: 'Chief engineer' }));
    await editAttribute(w.scope, {
      attributeId: w.attribute('people.job_title'),
      rules: [{ id: newId(), kind: 'length', params: { max: 5 } }],
    });
    const [submission] = await submissionIds(w, live.id);
    if (submission === undefined) throw new Error('No submission.');
    await processNow(w, submission.id);
    const view = await getSubmission(w.scope, { submissionId: submission.id });
    expect(view.state).toBe('processed');
    expect(view.refused).toEqual([{ questionId: 'title', message: expect.any(String) as string }]);
  });

  it('fails what no answer explains, retries it, and releases and marks spam (AC-566, AC-574)', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(live.publicKey, body({ name: 'Ada', email: 'needs@example.com' }));
    const timezone = w.attribute('people.timezone');
    await editAttribute(w.scope, { attributeId: timezone, isRequired: true });
    const [submission] = await submissionIds(w, live.id);
    if (submission === undefined) throw new Error('No submission.');
    await processNow(w, submission.id);
    expect((await getSubmission(w.scope, { submissionId: submission.id })).state).toBe('failed');
    await editAttribute(w.scope, { attributeId: timezone, isRequired: false });
    expect((await retrySubmission(w.scope, registry, { submissionId: submission.id })).state).toBe('received');
    await processNow(w, submission.id);
    expect((await markSubmissionSpam(w.scope, { submissionId: submission.id })).state).toBe('spam');
    expect((await releaseSubmission(w.scope, registry, { submissionId: submission.id })).state).toBe('received');
    expect(await refusalOf(retrySubmission(w.scope, registry, { submissionId: submission.id }))).toMatchObject([
      { code: 'FORM_STATE' },
    ]);
  });
});

describe('the submissions screen’s reads (AC-572, AC-573)', () => {
  it('pages newest first, filters by state, hides an answer filed on a field the reader can’t see, and deletes', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    for (const email of ['one@example.com', 'two@example.com', 'three@example.com']) {
      await submit(live.publicKey, body({ name: 'Ada', email, title: 'Engineer' }));
    }
    await submit(live.publicKey, body({ name: 'Bot', email: 'bot@example.com' }, { company_url: 'x' }));
    const ids = await submissionIds(w, live.id);
    for (const row of ids.filter((each) => each.state === 'received')) await processNow(w, row.id);
    const first = await listSubmissions(w.scope, { formId: live.id, limit: 2 });
    expect(first.items).toHaveLength(2);
    const rest = await listSubmissions(w.scope, { formId: live.id, limit: 2, cursor: first.nextCursor ?? '' });
    expect([...first.items, ...rest.items].map((item) => item.id)).toEqual(ids.map((row) => row.id).reverse());
    expect(
      (await listSubmissions(w.scope, { formId: live.id, state: 'spam' })).items.map((item) => item.email),
    ).toEqual(['bot@example.com']);
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: w.people, attributeId: w.attribute('people.job_title') },
          level: 'hidden',
        },
      ],
      records: [],
    };
    const member = rescope(w.scope, { role: 'member', rules });
    const seen = await listSubmissions(member, { formId: live.id });
    expect(seen.items).toHaveLength(3);
    const processed = seen.items[0];
    if (processed === undefined) throw new Error('A submission expected.');
    const detail = await getSubmission(member, { submissionId: processed.id });
    expect(detail.answers.map((answer) => answer.key)).toEqual(['name', 'email']);
    await deleteSubmission(w.scope, { submissionId: processed.id });
    await expect(getSubmission(w.scope, { submissionId: processed.id })).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
    expect((await listForms(w.scope, { archived: false })).items[0]).toMatchObject({
      submissionsThisMonth: 2,
      spamCount: 1,
    });
  });
});
