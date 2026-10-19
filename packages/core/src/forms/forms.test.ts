// Spec 0023, milestone 1, against a real Postgres as the app role: building
// and publishing a form, the public read and submit through the key's scope,
// the bot checks, idempotency, and processing a submission into a record as
// the form (match, fill or always, refused values skipped, one person for two
// racing submissions), its timeline entry, and the submissions screen's reads.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import type { AccessRules } from '../access/policy.ts';
import { editAttribute } from '../attributes/attributes.ts';
import { getActivity } from '../engine/activity.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord, getRecords } from '../engine/records.ts';
import { SYSTEM_ACTOR, type EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { compilePattern } from '../validation/pattern.ts';
import { rescope, testScope } from '../testing.ts';
import {
  createForm,
  formAttributes,
  getForm,
  listForms,
  publishForm,
  rotateFormKey,
  saveFormDraft,
  setFormStatus,
} from './forms.ts';
import { processSubmission } from './process.ts';
import { getPublicForm, submitForm, type CaptchaVerdict } from './public.ts';
import { deleteSubmission, getSubmission, listSubmissions, retrySubmission } from './submissions.ts';

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

/** A People form asking name, email (the match), job title (fill) and description (always), published. */
async function liveForm(w: Workspace, changes: (document: FormDocument) => FormDocument = (d) => d) {
  const created = await createForm(w.scope, { id: newId(), name: 'Contact us', mainObjectId: w.people });
  const base = created.draft;
  const [step] = base.steps;
  if (step === undefined) throw new Error('A form has a step.');
  const document: FormDocument = changes({
    ...base,
    steps: [
      {
        ...step,
        blocks: [
          ...step.blocks,
          {
            kind: 'question',
            id: 'title',
            label: 'Job title',
            required: false,
            target: { role: 'main', attributeId: w.attribute('people.job_title') },
            update: 'fill',
          },
          {
            kind: 'question',
            id: 'about',
            label: 'About you',
            required: false,
            target: { role: 'main', attributeId: w.attribute('people.description') },
            update: 'always',
          },
          {
            kind: 'question',
            id: 'why',
            label: 'Why are you here?',
            required: false,
            target: { formOnly: true, type: 'long_text' },
            update: 'fill',
          },
        ],
      },
    ],
    owner: { kind: 'member', memberId: w.ownerId },
  });
  const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision });
  return publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
}

const passed: CaptchaVerdict = { kind: 'score', score: 0.9 };

function body(answers: Record<string, unknown>, extra: Partial<SubmitBody> = {}): SubmitBody {
  return { idempotencyKey: newId(), versionNumber: 1, answers, hidden: {}, fillMs: 10_000, ...extra };
}

async function submit(publicKey: string, input: SubmitBody, captcha: CaptchaVerdict = passed) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  return submitForm(scope, registry, { formId, body: input, captcha, pattern: compilePattern });
}

/** Runs processing for a submission as the job does: in one write under the system's scope. */
async function processNow(w: Workspace, submissionId: string) {
  await runWrite(w.system, (context) => processSubmission(context, submissionId));
}

async function submissionIds(w: Workspace, formId: string) {
  return (
    await w.query<{ id: string; state: string }>(
      sql`select id::text, state from form_submissions where form_id = ${formId} order by received_at, id`,
    )
  ).map((row) => row);
}

const ada = { firstName: 'Ada', lastName: 'Lovelace' };

describe('building and publishing (AC-545, AC-546, AC-548, AC-549, AC-552)', () => {
  it('creates a People form with name and email asked, lists it, and publishes it as version 1', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Contact us', mainObjectId: w.people });
    expect(created.status).toBe('draft');
    expect(created.draft.steps[0]?.blocks.map((block) => block.id)).toEqual(['name', 'email']);
    expect(created.draft.targets.main.matchAttributeId).toBe(w.attribute('people.email_addresses'));
    expect(created.publicKey).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const published = await publishForm(w.scope, { formId: created.id, expectedRevision: created.revision });
    expect(published).toMatchObject({ status: 'live', liveVersionNumber: 1, hasUnpublished: false });
    const listed = await listForms(w.scope, { archived: false });
    expect(listed.items.map((form) => form.id)).toEqual([created.id]);
    // Editing after a publish starts version 2, and the live version stays 1 until the next publish.
    const edited = await saveFormDraft(w.scope, {
      formId: created.id,
      document: { ...published.draft, style: { ...published.draft.style, title: 'Talk to us' } },
      expectedRevision: published.revision,
    });
    expect(edited).toMatchObject({ draftNumber: 2, liveVersionNumber: 1, hasUnpublished: true });
    expect(edited.live?.style.title).toBe('Contact us');
  });

  it('refuses a stale save, and every change from a member without forms.manage', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Contact us', mainObjectId: w.people });
    await saveFormDraft(w.scope, { formId: created.id, document: created.draft, expectedRevision: created.revision });
    expect(
      await refusalOf(
        saveFormDraft(w.scope, { formId: created.id, document: created.draft, expectedRevision: created.revision }),
      ),
    ).toMatchObject([{ code: 'FORM_CHANGED' }]);
    const member = rescope(w.scope, { role: 'member' });
    expect(await refusalOf(createForm(member, { id: newId(), name: 'Mine', mainObjectId: w.people }))).toMatchObject([
      { code: 'FORBIDDEN' },
    ]);
    // A member reads the form all the same.
    expect((await getForm(member, { formId: created.id })).canManage).toBe(false);
  });

  it('refuses a publish mapping a field the publisher can only read, naming it (AC-546)', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Contact us', mainObjectId: w.people });
    const email = w.attribute('people.email_addresses');
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'admin' },
          target: { type: 'attribute', objectId: w.people, attributeId: email },
          level: 'read',
        },
      ],
      records: [],
    };
    const admin = rescope(w.scope, { role: 'admin', rules });
    const choices = await formAttributes(admin, { formId: created.id });
    expect(choices.items.find((item) => item.attributeId === email)?.canWrite).toBe(false);
    expect(await refusalOf(publishForm(admin, { formId: created.id, expectedRevision: created.revision }))).toEqual([
      expect.objectContaining({ code: 'FORBIDDEN', attributeId: email }),
    ]);
  });

  it('refuses a publish whose match field no required question asks', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Contact us', mainObjectId: w.people });
    const [step] = created.draft.steps;
    if (step === undefined) throw new Error('A form has a step.');
    const saved = await saveFormDraft(w.scope, {
      formId: created.id,
      document: { ...created.draft, steps: [{ ...step, blocks: step.blocks.filter((block) => block.id !== 'email') }] },
      expectedRevision: created.revision,
    });
    expect(await refusalOf(publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision }))).toEqual([
      expect.objectContaining({ code: 'CONFIG_INVALID', attributeId: w.attribute('people.email_addresses') }),
    ]);
  });

  it('pauses, archives and restores a form, and refuses a move that does not fit', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const paused = await setFormStatus(w.scope, { formId: live.id, status: 'paused' });
    expect(paused.status).toBe('paused');
    const publicForm = await enterPublicForm({ db }, live.publicKey);
    expect(await getPublicForm(publicForm.scope, { formId: publicForm.formId })).toMatchObject({
      status: 'paused',
      steps: [],
    });
    expect(await refusalOf(submit(live.publicKey, body({ email: 'x@example.com' })))).toMatchObject([
      { code: 'FORM_CLOSED' },
    ]);
    const archived = await setFormStatus(w.scope, { formId: live.id, status: 'archived' });
    expect((await listForms(w.scope, { archived: false })).items).toEqual([]);
    expect((await listForms(w.scope, { archived: true })).items.map((form) => form.id)).toEqual([archived.id]);
    await expect(getPublicForm(publicForm.scope, { formId: publicForm.formId })).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
    expect((await setFormStatus(w.scope, { formId: live.id, status: 'paused' })).status).toBe('paused');
    const draft = await createForm(w.scope, { id: newId(), name: 'Never live', mainObjectId: w.people });
    expect(await refusalOf(setFormStatus(w.scope, { formId: draft.id, status: 'live' }))).toMatchObject([
      { code: 'FORM_STATE' },
    ]);
  });

  it('rotates the public key, so the old one names nothing (AC-552)', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const rotated = await rotateFormKey(w.scope, { formId: live.id });
    expect(rotated.publicKey).not.toBe(live.publicKey);
    await expect(enterPublicForm({ db }, live.publicKey)).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
    await expect(enterPublicForm({ db }, rotated.publicKey)).resolves.toMatchObject({ formId: live.id });
  });
});

describe('the public form and submit (AC-553 to AC-556, AC-583 to AC-586)', () => {
  it('renders the live version with no attribute ids, mappings or owner', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const { scope, formId } = await enterPublicForm({ db }, live.publicKey);
    const rendered = await getPublicForm(scope, { formId, recaptchaSiteKey: 'site-key' });
    expect(rendered).toMatchObject({
      status: 'live',
      versionNumber: 1,
      title: 'Contact us',
      recaptchaSiteKey: 'site-key',
    });
    const text = JSON.stringify(rendered);
    for (const id of [w.attribute('people.email_addresses'), w.attribute('people.name'), w.people, w.ownerId]) {
      expect(text).not.toContain(id);
    }
    expect(rendered.steps[0]?.blocks.map((block) => block.id)).toEqual(['name', 'email', 'title', 'about', 'why']);
  });

  it('stores a valid submission once per attempt with its job queued, and a second attempt as its own', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const attempt = body({ name: ada, email: 'ada@example.com', smuggled: 'dropped' });
    const first = await submit(live.publicKey, attempt);
    expect(first).toEqual({
      next: { kind: 'message', text: 'Thanks, we got your message.' },
      verdict: 'passed',
      replayed: false,
    });
    expect(await submit(live.publicKey, attempt)).toMatchObject({ replayed: true });
    const stored = await w.query<{ answers: Record<string, unknown>; state: string }>(
      sql`select answers, state from form_submissions`,
    );
    expect(stored).toEqual([
      { state: 'received', answers: { name: { ...ada, fullName: 'Ada Lovelace' }, email: 'ada@example.com' } },
    ]);
    const queued = await w.query<{ kind: string }>(sql`select kind from jobs where kind = 'forms.process'`);
    expect(queued).toHaveLength(1);
    await submit(live.publicKey, body({ name: ada, email: 'ada@example.com' }));
    expect(await submissionIds(w, live.id)).toHaveLength(2);
  });

  it('refuses answers that fail, naming each question, and stores nothing', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const refusals = await refusalOf(submit(live.publicKey, body({ email: 'not an email' })));
    expect(refusals.map((refusal) => refusal.field).sort()).toEqual(['email', 'name']);
    expect(await submissionIds(w, live.id)).toEqual([]);
    // Two versions behind: the page must reload.
    expect(await refusalOf(submit(live.publicKey, body({ email: 'a@b.co' }, { versionNumber: 7 })))).toMatchObject([
      { code: 'FORM_CHANGED' },
    ]);
  });

  it('keeps a filled honeypot, a fast fill, a missing token and a low score as spam, with no job', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const answers = { name: ada, email: 'ada@example.com' };
    await submit(live.publicKey, body(answers, { honeypot: 'buy now' }));
    await submit(live.publicKey, body(answers, { fillMs: 300 }));
    await submit(live.publicKey, body(answers), { kind: 'missing' });
    const outcome = await submit(live.publicKey, body(answers), { kind: 'score', score: 0.1 });
    // The visitor sees the same thank you.
    expect(outcome.next).toEqual({ kind: 'message', text: 'Thanks, we got your message.' });
    const stored = await w.query<{ state: string; signals: string[] }>(
      sql`select state, spam->'signals' as signals from form_submissions order by received_at`,
    );
    expect(stored).toEqual([
      { state: 'spam', signals: ['honeypot'] },
      { state: 'spam', signals: ['too_fast'] },
      { state: 'spam', signals: ['captcha_missing'] },
      { state: 'spam', signals: ['captcha_low_score'] },
    ]);
    expect(await w.query(sql`select 1 from jobs where kind = 'forms.process'`)).toEqual([]);
    // Google not answering: stored, marked unchecked, and processed (AC-583's outage rule).
    expect((await submit(live.publicKey, body(answers), { kind: 'unavailable' })).verdict).toBe('unchecked');
    expect(await w.query(sql`select 1 from jobs where kind = 'forms.process'`)).toHaveLength(1);
  });
});

describe('processing a submission (AC-557, AC-558, AC-561, AC-562, AC-564, AC-565, AC-567)', () => {
  it('creates the person as the form, with the owner, and records it on the submission and the timeline', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(
      live.publicKey,
      body({ name: ada, email: 'ADA@example.com', title: 'Engineer', why: 'Curious about engines' }),
    );
    const [submission] = await submissionIds(w, live.id);
    if (submission === undefined) throw new Error('No submission.');
    await processNow(w, submission.id);
    const view = await getSubmission(w.scope, { submissionId: submission.id });
    expect(view).toMatchObject({
      state: 'processed',
      records: [{ role: 'main', action: 'created', record: { name: 'Ada Lovelace' } }],
      assignment: { memberId: w.ownerId, reason: 'fixed_member' },
      refused: [],
    });
    expect(view.answers.map((answer) => answer.questionId)).toEqual(['name', 'email', 'title', 'why']);
    const recordId = view.mainRecord?.recordId ?? '';
    const [record] = await getRecords(w.scope, { ids: [recordId] });
    expect(record?.createdBy).toEqual({ type: 'form', id: live.id });
    expect(record?.values[w.attribute('people.email_addresses')]).toEqual(['ada@example.com']);
    expect(record?.values[w.attribute('people.owner')]).toEqual({ type: 'member', id: w.ownerId });
    const setBy = await w.query<{ type: string }>(
      sql`select distinct set_by_type::text as type from "values" where owner_id = ${recordId}`,
    );
    expect(setBy).toEqual([{ type: 'form' }]);
    const activity = await getActivity(w.scope, { recordId });
    expect(activity.entries.find((entry) => entry.kind === 'submission')).toMatchObject({
      title: 'Contact us',
      action: 'created',
      actor: { type: 'form', id: live.id },
      itemId: submission.id,
    });
    // Run again (a job retried after its commit): nothing more is written.
    await processNow(w, submission.id);
    expect(await w.query(sql`select 1 from form_submission_records`)).toHaveLength(1);
  });

  it('matches on the email, fills only empty values, overwrites an always question, and keeps the owner', async () => {
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
      body({ name: ada, email: 'ada@example.com', title: 'Engineer', about: 'Wrote the first program' }),
    );
    const [submission] = await submissionIds(w, live.id);
    if (submission === undefined) throw new Error('No submission.');
    await processNow(w, submission.id);
    const [record] = await getRecords(w.scope, { ids: [existing.recordId] });
    expect(record?.values[w.attribute('people.job_title')]).toBe('Countess');
    expect(record?.values[w.attribute('people.description')]).toBe('Wrote the first program');
    const view = await getSubmission(w.scope, { submissionId: submission.id });
    expect(view.records).toMatchObject([{ action: 'updated', record: { recordId: existing.recordId } }]);
    expect(await w.query(sql`select 1 from records where object_id = ${w.people}`)).toHaveLength(1);
  });

  it('makes one person from two submissions for one new email processed at once (AC-562)', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(live.publicKey, body({ name: ada, email: 'twin@example.com' }));
    await submit(live.publicKey, body({ name: ada, email: 'twin@example.com' }));
    const [one, two] = await submissionIds(w, live.id);
    if (one === undefined || two === undefined) throw new Error('Two submissions expected.');
    await Promise.all([processNow(w, one.id), processNow(w, two.id)]);
    const people = await w.query(
      sql`select distinct record_id from "values" where attribute_id = ${w.attribute('people.email_addresses')} and active_until is null`,
    );
    expect(people).toHaveLength(1);
    const actions = await w.query<{ action: string }>(
      sql`select action from form_submission_records order by created_at`,
    );
    expect(actions.map((row) => row.action).sort()).toEqual(['created', 'matched']);
  });

  it('skips a value a rule refuses now, writes the rest, and says why (AC-565)', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(live.publicKey, body({ name: ada, email: 'rule@example.com', title: 'Chief engineer' }));
    // A rule made after the visitor sent it.
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
    const [record] = await getRecords(w.scope, { ids: [view.mainRecord?.recordId ?? ''] });
    expect(record?.values[w.attribute('people.job_title')]).toBeNull();
  });

  it('fails a submission whose record a refusal no answer explains can’t make, and retries it (AC-566)', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(live.publicKey, body({ name: ada, email: 'needs@example.com' }));
    // The object gains a required field the form doesn't ask.
    const phone = w.attribute('people.timezone');
    await editAttribute(w.scope, { attributeId: phone, isRequired: true });
    const [submission] = await submissionIds(w, live.id);
    if (submission === undefined) throw new Error('No submission.');
    await processNow(w, submission.id);
    const failed = await getSubmission(w.scope, { submissionId: submission.id });
    expect(failed.state).toBe('failed');
    expect(failed.failure).toMatch(/required field/);
    await editAttribute(w.scope, { attributeId: phone, isRequired: false });
    const retried = await retrySubmission(w.scope, registry, { submissionId: submission.id });
    expect(retried.state).toBe('received');
    await processNow(w, submission.id);
    expect((await getSubmission(w.scope, { submissionId: submission.id })).state).toBe('processed');
    expect(await refusalOf(retrySubmission(w.scope, registry, { submissionId: submission.id }))).toMatchObject([
      { code: 'FORM_STATE' },
    ]);
  });
});

describe('the submissions screen’s reads (AC-572, AC-573)', () => {
  it('pages newest first, filters by state, hides an answer whose field the reader can’t see, and deletes', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    for (const email of ['one@example.com', 'two@example.com', 'three@example.com']) {
      await submit(live.publicKey, body({ name: ada, email, title: 'Engineer' }));
    }
    await submit(live.publicKey, body({ name: ada, email: 'bot@example.com' }, { honeypot: 'x' }));
    const ids = await submissionIds(w, live.id);
    for (const row of ids.filter((each) => each.state === 'received')) await processNow(w, row.id);
    const first = await listSubmissions(w.scope, { formId: live.id, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    const rest = await listSubmissions(w.scope, { formId: live.id, limit: 2, cursor: first.nextCursor ?? '' });
    expect([...first.items, ...rest.items].map((item) => item.id)).toEqual(ids.map((row) => row.id).reverse());
    const spam = await listSubmissions(w.scope, { formId: live.id, state: 'spam' });
    expect(spam.items.map((item) => item.verdict)).toEqual(['spam']);
    // A member whose role hides Job title sees the submission without that answer; spam (no record) not at all.
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
    expect(detail.answers.map((answer) => answer.questionId)).toEqual(['name', 'email']);
    await deleteSubmission(w.scope, { submissionId: processed.id });
    await expect(getSubmission(w.scope, { submissionId: processed.id })).rejects.toMatchObject({
      refusal: { code: 'NOT_FOUND' },
    });
    // Its person stays.
    expect(await w.query(sql`select 1 from records where object_id = ${w.people}`)).toHaveLength(3);
  });
});

describe('the public key reaches only its own workspace', () => {
  it('reads nothing but the form the key names, and the scope it makes reaches no records', async () => {
    const a = await workspace();
    const b = await workspace();
    const formA = await liveForm(a);
    await createRecord(b.scope, {
      objectId: b.people,
      values: { [b.attribute('people.name')]: { firstName: 'Bea' } },
    });
    const entered: { scope: EngineScope; formId: string } = await enterPublicForm({ db }, formA.publicKey);
    expect(entered.scope.workspaceId).toBe(a.scope.workspaceId);
    expect(await getRecords(entered.scope, { ids: [newId()] })).toEqual([]);
    await expect(enterPublicForm({ db }, 'short')).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
  });
});
