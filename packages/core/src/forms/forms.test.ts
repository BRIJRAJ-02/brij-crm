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
import { createObject } from '../objects/objects.ts';
import { bookingTargetProblem, createBookingPage, updateBookingPage } from '../booking/pages.ts';
import { getActivity } from '../engine/activity.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord, getRecords } from '../engine/records.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../engine/scope.ts';
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
  rotateFormSecret,
  saveFormDraft,
  setFormStatus,
  setFormTarget,
  updateFormSettings,
} from './forms.ts';
import { processSubmission } from './process.ts';
import { getPublicForm, postingRules, submitForm, visitorOf, type BookingHandoff } from './public.ts';
import { workspacePublicKey } from './shared.ts';
import type { CaptchaVerdict } from './spam.ts';
import {
  deleteSubmission,
  getSubmission,
  listSubmissions,
  markSubmissionSpam,
  NOT_IN_REVIEW,
  releaseSubmission,
  resolveSubmission,
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
  return submitForm(scope, registry, { formId, body: input, captcha, answersKey: 'a-test-answers-key' });
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
    expect(created.draft.targets.main?.matchAttributeId).toBe(w.attribute('people.email_addresses'));
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

  it('works out the match again when its own object is asked for after an email attribute is added', async () => {
    // The owner, 27 October 2026: a form sent to an object with no unique email could never be published, because
    // the match was worked out once, when the object was chosen, and adding the attribute afterwards changed
    // nothing. The builder now adds it and asks for the same object again; that has to be when the match is found.
    const w = await workspace();
    const designers = await createObject(w.scope, {
      id: newId(),
      singularName: 'Graphic Designer',
      pluralName: 'Graphic Designers',
      icon: 'inbox',
      hue: 'blue',
    });
    const created = await createForm(w.scope, { id: newId(), name: 'Apply', mainObjectId: designers.id });
    expect(created.draft.targets.main).toEqual({ objectId: designers.id });
    expect(created.draft.questions.find((each) => each.key === 'email')?.filedOn).toBeUndefined();

    const email = await createAttribute(w.scope, {
      objectId: designers.id,
      id: newId(),
      title: 'Work email',
      type: 'email',
      isUnique: true,
    });
    const again = await setFormTarget(w.scope, {
      formId: created.id,
      mainObjectId: designers.id,
      expectedRevision: created.revision,
    });
    expect(again.draft.targets.main).toEqual({ objectId: designers.id, matchAttributeId: email.id });
    expect(again.draft.questions.find((each) => each.key === 'email')?.filedOn?.attributeId).toBe(email.id);
    expect(again.revision).toBeGreaterThan(created.revision);
    const live = await publishForm(w.scope, { formId: created.id, expectedRevision: again.revision });
    expect(live.liveVersionNumber).toBe(1);

    // Asked for once more with nothing new under it, it writes nothing: the same revision comes back.
    const unchanged = await setFormTarget(w.scope, {
      formId: created.id,
      mainObjectId: designers.id,
      expectedRevision: live.revision,
    });
    expect(unchanged.revision).toBe(live.revision);
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

  it('names nothing in a deleted workspace (spec 0031, AC-823)', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await w.query(sql`update workspaces set deleted_at = now(), purge_after = now() + interval '30 days'`);
    await expect(enterPublicForm({ db }, live.publicKey)).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND' } });
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

describe('tagging: where a submission came from (spec 0023, the embeds)', () => {
  it('stores the context the embed sent, checked field by field, and shows it on the submission', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const view = await getForm(w.scope, { formId: live.id });
    expect(view.workspaceKey).toBe(workspacePublicKey(w.scope.workspaceId));
    expect(view.workspaceKey).toMatch(/^ws_[a-f0-9]{16}$/);
    expect(view.workspaceKey).not.toContain(w.scope.workspaceId);
    await submit(
      live.publicKey,
      body(
        { name: 'Ada', email: 'ada@example.com' },
        {
          context: {
            page_url: 'https://user:secret@acme.com/pricing?plan=pro',
            page_title: 'Pricing',
            landing_url: 'javascript:alert(1)',
            referrer: 'https://news.example.com/',
            utm_campaign: 'spring',
            utm_source: 'x'.repeat(201),
            params: { plan: 'pro' },
            visitor_id: 'short',
            workspace: view.workspaceKey,
            mode: 'inline',
            version: '1',
          },
        },
      ),
    );
    const [row] = await w.query<{ context: unknown }>(sql`select context from form_submissions`);
    // Credentials leave the address, a script address and an overlong tag and a malformed visitor id are dropped,
    // and the workspace key is checked, never kept.
    expect(row?.context).toEqual({
      page_url: 'https://acme.com/pricing?plan=pro',
      page_title: 'Pricing',
      referrer: 'https://news.example.com/',
      utm_campaign: 'spring',
      params: { plan: 'pro' },
      mode: 'inline',
    });
    const [stored] = await submissionIds(w, live.id);
    const shown = await getSubmission(w.scope, { submissionId: stored?.id ?? '' });
    expect(shown.context).toMatchObject({ page_url: 'https://acme.com/pricing?plan=pro', utm_campaign: 'spring' });
  });

  it('stores no context when none came, and refuses a snippet naming another workspace as not found', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(live.publicKey, body({ name: 'Ada', email: 'ada@example.com' }));
    expect(await w.query(sql`select context from form_submissions`)).toEqual([{ context: null }]);
    const elsewhere = await workspace();
    expect(
      await refusalOf(
        submit(
          live.publicKey,
          body(
            { name: 'Ada', email: 'ada@example.com' },
            { context: { workspace: workspacePublicKey(elsewhere.scope.workspaceId) } },
          ),
        ),
      ),
    ).toMatchObject([{ code: 'NOT_FOUND' }]);
    expect(await w.query(sql`select id from form_submissions`)).toHaveLength(1);
  });

  it('rotates the signing secret for forms.manage only, the old one gone at once', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const before = await getForm(w.scope, { formId: live.id });
    const rotated = await rotateFormSecret(w.scope, { formId: live.id });
    expect(rotated.signingSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(rotated.signingSecret).not.toBe(before.signingSecret);
    const { scope } = await enterPublicForm({ db }, live.publicKey);
    expect((await postingRules(scope, { formId: live.id })).signingSecret).toBe(rotated.signingSecret);
    const member = rescope(w.scope, { role: 'member' });
    expect(await refusalOf(rotateFormSecret(member, { formId: live.id }))).toMatchObject([{ code: 'FORBIDDEN' }]);
    expect((await getForm(w.scope, { formId: live.id })).signingSecret).toBe(rotated.signingSecret);
  });
});

describe('the content checks and Needs review (AC-563, AC-584, the spam follow-up)', () => {
  it('holds a doubtful one in Needs review and makes spam of a repeated, doubtful one, with no job', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const doubtful = { name: 'Xkcdqwrt', email: 'someone@yopmail.com' };
    const first = await submit(live.publicKey, body(doubtful));
    expect(first).toMatchObject({ verdict: 'review', next: { kind: 'message' } });
    await submit(live.publicKey, body(doubtful));
    await submit(live.publicKey, body(doubtful));
    await submit(live.publicKey, body(doubtful));
    expect(
      await w.query<{ state: string; signals: string[]; score: number }>(
        sql`select state, spam->'signals' as signals, (spam->>'contentScore')::int as score
            from form_submissions order by received_at, id`,
      ),
    ).toEqual([
      { state: 'needs_review', signals: ['gibberish_name', 'disposable_email'], score: 4 },
      { state: 'spam', signals: ['gibberish_name', 'disposable_email', 'repeated'], score: 6 },
      { state: 'spam', signals: ['gibberish_name', 'disposable_email', 'repeated'], score: 6 },
      { state: 'spam', signals: ['gibberish_name', 'disposable_email', 'repeated'], score: 8 },
    ]);
    expect(await w.query(sql`select 1 from jobs where kind = 'forms.process'`)).toEqual([]);
    expect((await listSubmissions(w.scope, { formId: live.id, state: 'needs_review' })).items).toMatchObject([
      { verdict: 'review', email: 'someone@yopmail.com' },
    ]);
  });

  it('lets a member with forms.manage resolve one as not spam (processed) or spam, and refuses anyone else', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    await submit(live.publicKey, body({ name: 'Xkcdqwrt', email: 'one@mailinator.com' }));
    await submit(live.publicKey, body({ name: 'Bcdfghj', email: 'two@mailinator.com' }));
    await submit(live.publicKey, body({ name: 'Ada', email: 'ada@example.com' }));
    const [one, two, clean] = await submissionIds(w, live.id);
    if (one === undefined || two === undefined || clean === undefined) throw new Error('Three submissions expected.');
    expect([one.state, two.state, clean.state]).toEqual(['needs_review', 'needs_review', 'received']);
    // A member without forms.manage is refused, and nothing changes.
    const member = rescope(w.scope, { role: 'member' });
    expect(
      await refusalOf(resolveSubmission(member, registry, { submissionId: one.id, resolution: { kind: 'not_spam' } })),
    ).toMatchObject([{ code: 'FORBIDDEN' }]);
    expect((await submissionIds(w, live.id))[0]?.state).toBe('needs_review');
    // Not spam: back to received with its job; spam: to spam, where Release still works.
    const released = await resolveSubmission(w.scope, registry, {
      submissionId: one.id,
      resolution: { kind: 'not_spam' },
    });
    expect(released).toMatchObject({ state: 'received', verdict: 'passed' });
    expect(await w.query(sql`select 1 from jobs where kind = 'forms.process'`)).toHaveLength(2);
    await processNow(w, one.id);
    expect((await getSubmission(w.scope, { submissionId: one.id })).state).toBe('processed');
    const binned = await resolveSubmission(w.scope, registry, { submissionId: two.id, resolution: { kind: 'spam' } });
    expect(binned).toMatchObject({ state: 'spam', verdict: 'spam' });
    expect(
      await w.query<{ resolved: string; by: string }>(
        sql`select spam->>'resolved' as resolved, spam->'resolvedBy'->>'id' as by from form_submissions
            where id = ${two.id}`,
      ),
    ).toEqual([{ resolved: 'spam', by: w.ownerId }]);
    // Only one held for review resolves: not one already settled, nor a clean one.
    for (const submissionId of [one.id, two.id, clean.id]) {
      expect(
        await refusalOf(resolveSubmission(w.scope, registry, { submissionId, resolution: { kind: 'spam' } })),
      ).toEqual([{ code: 'FORM_STATE', message: NOT_IN_REVIEW }]);
    }
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

describe('book a meeting after sending (AC-1055 to AC-1057)', () => {
  /** A draft of `form` that sends visitors on to `pageId`, saved; answers its new revision. */
  async function pointAt(w: Workspace, pageId: string, seconds = 5) {
    const created = await createForm(w.scope, { id: newId(), name: 'Book after' });
    const document: FormDocument = {
      ...created.draft,
      after: { kind: 'booking', bookingPageId: pageId, countdownSeconds: seconds, message: 'Thanks, Ada.' },
    };
    const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision });
    return { formId: created.id, saved };
  }

  it('refuses a page that is not there on save, and a page paused since on publish, on `after`', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId() });
    const missing: FormDocument = {
      ...created.draft,
      after: { kind: 'booking', bookingPageId: newId(), countdownSeconds: 5, message: '' },
    };
    expect(
      await refusalOf(
        saveFormDraft(w.scope, { formId: created.id, document: missing, expectedRevision: created.revision }),
      ),
    ).toMatchObject([{ code: 'CONFIG_INVALID', field: 'after' }]);
    // Another workspace's page is as good as missing: row level security never shows it.
    const elsewhere = await workspace();
    const theirs = await createBookingPage(elsewhere.scope, { id: newId(), title: 'Theirs', timeZone: 'UTC' });
    const foreign: FormDocument = {
      ...created.draft,
      after: { kind: 'booking', bookingPageId: theirs.id, countdownSeconds: 5, message: '' },
    };
    expect(
      await refusalOf(
        saveFormDraft(w.scope, { formId: created.id, document: foreign, expectedRevision: created.revision }),
      ),
    ).toMatchObject([{ code: 'CONFIG_INVALID', field: 'after' }]);
    const page = await createBookingPage(w.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const { formId, saved } = await pointAt(w, page.id);
    await updateBookingPage(w.scope, { pageId: page.id, settings: { status: 'paused' } });
    expect(await refusalOf(publishForm(w.scope, { formId, expectedRevision: saved.revision }))).toMatchObject([
      { code: 'CONFIG_INVALID', field: 'after' },
    ]);
  });

  it('hands a visitor on with a signed token naming the submission, name and email; a paused page thanks instead', async () => {
    const w = await workspace();
    const page = await createBookingPage(w.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const { formId, saved } = await pointAt(w, page.id, 3);
    const live = await publishForm(w.scope, { formId, expectedRevision: saved.revision });
    const signed: BookingHandoff[] = [];
    const sign = (handoff: BookingHandoff) => {
      signed.push(handoff);
      return 'signed-token';
    };
    const attempt = body({ name: 'Ada Lovelace', email: 'ada@example.com' });
    const { scope, formId: publicId } = await enterPublicForm({ db }, live.publicKey);
    const first = await submitForm(scope, registry, {
      formId: publicId,
      body: attempt,
      captcha: off,
      signHandoff: sign,
    });
    expect(first.next).toEqual({
      kind: 'booking',
      url: `/b/${page.publicKey}?p=signed-token`,
      countdownSeconds: 3,
      text: 'Thanks, Ada.',
    });
    const [stored] = await submissionIds(w, formId);
    // The token names the submission and the page only: nothing personal rides in the link.
    expect(signed[0]).toEqual({ submissionId: stored?.id, bookingPageId: page.id });
    // A retry hands off the same submission.
    const again = await submitForm(scope, registry, {
      formId: publicId,
      body: attempt,
      captcha: off,
      signHandoff: sign,
    });
    expect(again.replayed).toBe(true);
    expect(signed[1]?.submissionId).toBe(stored?.id);
    // The same key with other answers, or from another address, is someone else: the thank you, and no token
    // for this visitor's name and email (the security review, 21 October 2026).
    const other = await submitForm(scope, registry, {
      formId: publicId,
      body: { ...attempt, answers: { name: 'Mallory', email: 'mallory@example.com' } },
      captcha: off,
      answersKey: 'k',
      signHandoff: sign,
    });
    expect(other).toMatchObject({ replayed: true, next: { kind: 'message', text: 'Thanks, Ada.' } });
    const elsewhere = await submitForm(scope, registry, {
      formId: publicId,
      body: attempt,
      captcha: off,
      ipHash: 'another-address',
      signHandoff: sign,
    });
    expect(elsewhere).toMatchObject({ replayed: true, next: { kind: 'message', text: 'Thanks, Ada.' } });
    expect(signed).toHaveLength(2);
    // Paused at send time: the form's own thank you, never a dead page.
    await updateBookingPage(w.scope, { pageId: page.id, settings: { status: 'paused' } });
    const later = await submitForm(scope, registry, {
      formId: publicId,
      body: body({ name: 'Grace', email: 'grace@example.com' }),
      captcha: off,
      signHandoff: sign,
    });
    expect(later.next).toEqual({ kind: 'message', text: 'Thanks, Ada.', offersMeeting: false });
  });

  it('lets only someone who may use a page choose it, and keeps a page chosen before (the access door, AC-1056)', async () => {
    const w = await workspace();
    // A member (booking.manage: their own pages only) and their page; the owner's page.
    const memberId = newId();
    await w.query(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
          values (${w.scope.workspaceId}, ${memberId}, 'Bea', ${`${memberId}@example.com`}, 'member', 'system', 'system')`,
    );
    const member = rescope(w.scope, { actor: { type: 'member', id: memberId }, role: 'member' });
    const hers = await createBookingPage(member, { id: newId(), title: 'Bea’s call', timeZone: 'UTC' });
    const owners = await createBookingPage(w.scope, { id: newId(), title: 'Intro call', timeZone: 'UTC' });
    const seen = (scope: EngineScope, pageId: string) =>
      inWorkspace(scope, (tx) => bookingTargetProblem(tx, scope, pageId, 'seen'));
    expect(await seen(member, hers.id)).toBeUndefined();
    expect(await seen(member, owners.id)).toBe('hidden');
    // An owner (booking.admin) may use anyone's.
    expect(await seen(w.scope, hers.id)).toBeUndefined();
    // A key that manages forms but holds no booking right may choose no page at all.
    const key = testScope({
      db,
      workspaceId: w.scope.workspaceId,
      actor: { type: 'api_key', id: newId() },
      scopes: ['forms.manage', 'data.write'],
    });
    expect(await seen(key, owners.id)).toBe('hidden');
    // Saving as that key keeps the page chosen before, but switching to another is refused on `after`.
    const { formId, saved } = await pointAt(w, owners.id);
    const kept = await saveFormDraft(key, {
      formId,
      document: { ...saved.draft, headline: 'Still booking' },
      expectedRevision: saved.revision,
    });
    expect(kept.draft.after).toMatchObject({ kind: 'booking', bookingPageId: owners.id });
    expect(
      await refusalOf(
        saveFormDraft(key, {
          formId,
          document: {
            ...kept.draft,
            after: { kind: 'booking', bookingPageId: hers.id, countdownSeconds: 5, message: '' },
          },
          expectedRevision: kept.revision,
        }),
      ),
    ).toMatchObject([{ code: 'CONFIG_INVALID', field: 'after' }]);
  });

  it('never takes a company’s or a team’s name for the visitor’s', () => {
    const questions = [
      question({ id: 'c', key: 'company', label: 'Company name', answerType: 'short_text' }),
      question({ id: 'n', key: 'who', label: 'Your name', answerType: 'short_text' }),
    ];
    expect(visitorOf({ questions }, { company: 'Analytical', who: 'Ada' })).toEqual({ name: 'Ada' });
    expect(visitorOf({ questions: questions.slice(0, 1) }, { company: 'Analytical' })).toEqual({});
  });

  it('reads the visitor’s name by key, else by label, and their email from the email question', () => {
    const questions = [
      question({ id: 'a', key: 'who', label: 'Your full name', answerType: 'short_text' }),
      question({ id: 'b', key: 'mail', label: 'Email', answerType: 'email' }),
    ];
    expect(visitorOf({ questions }, { who: ' Ada ', mail: 'ada@example.com' })).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(visitorOf({ questions }, {})).toEqual({});
  });
});
