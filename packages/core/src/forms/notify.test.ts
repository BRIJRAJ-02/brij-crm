// The team's notice of a new submission (spec 0023 AC-1047, late trap #19), against a real Postgres as the app
// role: processing a submission queues one email to the lead's owner and one to each member the form lists, each holding only
// the answers that member may see, once however often it is processed.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm, type RuleSource } from '../access/door.ts';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { newId } from '../engine/ids.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { listNotifications, unemailedNotifications } from '../notifications/inbox.ts';
import { testScope } from '../testing.ts';
import { createForm, getForm, NOTIFY_MEMBER_UNKNOWN, publishForm, saveFormDraft, updateFormSettings } from './forms.ts';
import { answerWords } from './notify.ts';
import { formsProcess, processSubmission } from './process.ts';
import { submitForm } from './public.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-form-notice-tests' });
});
afterAll(async () => {
  await db.close();
});

const rulesByWorkspace = new Map<string, AccessRules>();
const rules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>(sql`select current_setting('app.workspace_id', true) as id`);
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? NO_RULES;
};

let count = 0;
/** A workspace whose owner Ada made a published People form that hands its leads to Bea, a member. */
async function world() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Notices',
    slug: `notices-${String(count)}-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const { workspaceId } = created;
  const ada = testScope({ db, workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId, actor: SYSTEM_ACTOR });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  const [title] = await query<{ id: string }>(
    sql`select a.id::text from attributes a join objects o on o.id = a.object_id
        where o.api_slug = 'people' and a.api_slug = 'job_title'`,
  );
  const bea = newId();
  await query(sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
    values (${workspaceId}, ${bea}, 'Bea', ${`bea-${bea.slice(-6)}@example.com`}, 'member', 'system', 'system')`);
  const made = await createForm(ada, { id: newId(), name: 'Contact us' });
  const document: FormDocument = {
    ...made.draft,
    questions: [
      ...made.draft.questions,
      {
        id: 'title',
        key: 'title',
        label: 'Job title',
        answerType: 'short_text',
        required: false,
        update: 'fill',
        filedOn: { objectRole: 'main', attributeId: title?.id ?? '' },
      },
      { id: 'why', key: 'why', label: 'Why are you here?', answerType: 'long_text', required: false, update: 'fill' },
    ],
  };
  const saved = await saveFormDraft(ada, { formId: made.id, document, expectedRevision: made.revision });
  const live = await publishForm(ada, { formId: made.id, expectedRevision: saved.revision });
  await updateFormSettings(ada, { formId: live.id, ownerMemberId: bea });
  return { workspaceId, ada: created.memberId, bea, system, query, form: live, titleId: title?.id ?? '' };
}

/** Sends the form and answers the new submission's id. */
async function submit(publicKey: string, answers: Record<string, unknown>): Promise<string> {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  const body: SubmitBody = { idempotencyKey: newId(), answers, hidden: {}, fillMs: 10_000 };
  await submitForm(scope, registry, { formId, body, captcha: { kind: 'off' }, answersKey: 'a-test-answers-key' });
  const stored = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string }>(
      sql`select id::text from form_submissions where form_id = ${formId} and idempotency_key = ${body.idempotencyKey}`,
    ),
  );
  return stored.rows[0]?.id ?? '';
}

describe('the team’s notice of a new submission (AC-1047, late trap #19)', () => {
  it('emails the lead’s owner and the form’s maker once each, each only the answers they may see', async () => {
    const w = await world();
    // Job title is hidden from members, so Bea's email leaves it out while Ada's, the owner's, keeps it.
    rulesByWorkspace.set(w.workspaceId, {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: w.form.mainObjectId ?? '', attributeId: w.titleId },
          level: 'hidden',
        },
      ],
      records: [],
    });
    const id = await submit(w.form.publicKey, {
      name: 'Asha Rao',
      email: 'asha@northwind.example',
      title: 'Head of sales',
      why: 'Round robin for three reps.',
    });
    const process = () => runWrite(w.system, (context) => processSubmission(context, id, new Date(), undefined, rules));
    await process();
    await process();
    const sent = await w.query<{ member: string; params: { answers: { label: string }[] } & Record<string, unknown> }>(
      sql`select to_member_id::text as member, params from emails where kind = 'form_submission' order by to_member_id = ${w.ada} desc`,
    );
    expect(sent.map((row) => row.member)).toEqual([w.ada, w.bea]);
    const [toAda, toBea] = sent;
    expect(toAda?.params).toMatchObject({
      formName: 'Contact us',
      submitter: { name: 'Asha Rao', email: 'asha@northwind.example' },
      reason: 'listed',
      filed: true,
      submissionPath: expect.stringMatching(
        new RegExp(`^/w/[^/]+/captures/forms/${w.form.id}\\?tab=submissions&submission=${id}$`),
      ) as unknown,
    });
    expect(toAda?.params.answers.map((answer) => answer.label)).toContain('Job title');
    expect(toBea?.params).toMatchObject({ reason: 'lead', filed: true });
    expect(toBea?.params.answers.map((answer) => answer.label)).not.toContain('Job title');
    expect(toBea?.params.answers.map((answer) => answer.label)).toContain('Why are you here?');
  });

  it('tells nobody who can’t open the submission, nor a lead owner who has left', async () => {
    const w = await world();
    // People is closed to members, so Bea can't open the submission: her notice is left out, Ada's still goes.
    rulesByWorkspace.set(w.workspaceId, {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'object', objectId: w.form.mainObjectId ?? '' },
          level: 'none',
        },
      ],
      records: [],
    });
    const closed = await submit(w.form.publicKey, { name: 'Asha Rao', email: 'asha@northwind.example' });
    await runWrite(w.system, (context) => processSubmission(context, closed, new Date(), undefined, rules));
    rulesByWorkspace.delete(w.workspaceId);
    // Bea leaves: the next lead still goes to her by the form's setting, but she isn't told.
    await w.query(sql`update members set status = 'removed' where id = ${w.bea}`);
    const left = await submit(w.form.publicKey, { name: 'Ben Ode', email: 'ben@northwind.example' });
    await runWrite(w.system, (context) => processSubmission(context, left, new Date(), undefined, rules));
    const sent = await w.query<{ member: string; submission: string }>(
      sql`select to_member_id::text as member, split_part(key, ':', 2) as submission from emails
          where kind = 'form_submission' order by created_at`,
    );
    expect(sent).toEqual([
      { member: w.ada, submission: closed },
      { member: w.ada, submission: left },
    ]);
  });

  it('leaves out the sender’s email when it is filed on a field hidden from the reader', async () => {
    const w = await world();
    const [emails] = await w.query<{ id: string }>(
      sql`select a.id::text from attributes a join objects o on o.id = a.object_id
          where o.api_slug = 'people' and a.api_slug = 'email_addresses'`,
    );
    rulesByWorkspace.set(w.workspaceId, {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: w.form.mainObjectId ?? '', attributeId: emails?.id ?? '' },
          level: 'hidden',
        },
      ],
      records: [],
    });
    const id = await submit(w.form.publicKey, { name: 'Asha Rao', email: 'asha@northwind.example' });
    await runWrite(w.system, (context) => processSubmission(context, id, new Date(), undefined, rules));
    const [toBea] = await w.query<{ params: { submitter: unknown; answers: { value: string }[] } }>(
      sql`select params from emails where kind = 'form_submission' and to_member_id = ${w.bea}`,
    );
    expect(toBea?.params.submitter).toEqual({ name: 'Asha Rao' });
    expect(JSON.stringify(toBea?.params)).not.toContain('asha@northwind.example');
  });

  it('tells each member once when a job that gave up ends a submission another try already processed', async () => {
    const w = await world();
    const id = await submit(w.form.publicKey, { name: 'Asha Rao', email: 'asha@northwind.example' });
    await runWrite(w.system, (context) => processSubmission(context, id, new Date(), undefined, rules));
    const kind = formsProcess(undefined, rules);
    await runWrite(w.system, (context) =>
      (kind.onFailed ?? (() => Promise.resolve()))(context, {
        id: newId(),
        params: { submissionId: id },
        checkpoint: null,
        startedBy: { type: 'system' },
        error: { code: 'JOB_FAILED', message: 'Stopped.' },
      }),
    );
    const sent = await w.query<{ n: number }>(
      sql`select count(*)::int as n from emails where kind = 'form_submission' group by to_member_id`,
    );
    expect(sent).toEqual([{ n: 1 }, { n: 1 }]);
  });

  it('tells the people the form lists, as changed, and refuses a list naming someone who isn’t a member', async () => {
    const w = await world();
    const ada = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'member', id: w.ada } });
    // A new form lists its maker.
    expect((await getForm(ada, { formId: w.form.id })).notifyMemberIds).toEqual([w.ada]);
    // Ada takes herself off and lists nobody: only Bea, the lead's owner, hears of the next one.
    const changed = await updateFormSettings(ada, { formId: w.form.id, notifyMemberIds: [] });
    expect(changed.notifyMemberIds).toEqual([]);
    const first = await submit(w.form.publicKey, { name: 'Asha Rao', email: 'asha@northwind.example' });
    await runWrite(w.system, (context) => processSubmission(context, first, new Date(), undefined, rules));
    // Bea off the owner seat and on the list: she is told as listed, once though named twice.
    await updateFormSettings(ada, { formId: w.form.id, ownerMemberId: null, notifyMemberIds: [w.bea, w.bea] });
    const second = await submit(w.form.publicKey, { name: 'Ben Ode', email: 'ben@northwind.example' });
    await runWrite(w.system, (context) => processSubmission(context, second, new Date(), undefined, rules));
    const sent = await w.query<{ member: string; submission: string; reason: string }>(
      sql`select to_member_id::text as member, split_part(key, ':', 2) as submission, params->>'reason' as reason
          from emails where kind = 'form_submission' order by created_at`,
    );
    expect(sent).toEqual([
      { member: w.bea, submission: first, reason: 'lead' },
      { member: w.bea, submission: second, reason: 'listed' },
    ]);
    // Someone who left, or never was a member, can't be listed; the list stays as it was.
    await w.query(sql`update members set status = 'removed' where id = ${w.bea}`);
    await expect(updateFormSettings(ada, { formId: w.form.id, notifyMemberIds: [w.ada, w.bea] })).rejects.toMatchObject(
      { refusal: { code: 'CONFIG_INVALID', message: NOTIFY_MEMBER_UNKNOWN, field: 'notifyMemberIds' } },
    );
    await expect(updateFormSettings(ada, { formId: w.form.id, notifyMemberIds: [newId()] })).rejects.toMatchObject({
      refusal: { code: 'CONFIG_INVALID' },
    });
    // Bea, listed before she left, drops out of the list the form shows.
    expect((await getForm(ada, { formId: w.form.id })).notifyMemberIds).toEqual([]);
    // Changing the list is audited, as it decides who reads visitors' answers.
    const audited = await w.query<{ before: unknown; after: unknown }>(
      sql`select before, after from audit_events where action = 'form.notify_changed' order by at, id`,
    );
    expect(audited).toEqual([
      { before: { notifyMemberIds: [w.ada] }, after: { notifyMemberIds: [] } },
      { before: { notifyMemberIds: [] }, after: { notifyMemberIds: [w.bea] } },
    ]);
  });

  it('tells a listed member who can’t open the submission nothing', async () => {
    const w = await world();
    const ada = testScope({ db, workspaceId: w.workspaceId, actor: { type: 'member', id: w.ada } });
    // Bea is listed, not the lead's owner, and People is closed to members.
    await updateFormSettings(ada, { formId: w.form.id, ownerMemberId: null, notifyMemberIds: [w.ada, w.bea] });
    rulesByWorkspace.set(w.workspaceId, {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'object', objectId: w.form.mainObjectId ?? '' },
          level: 'none',
        },
      ],
      records: [],
    });
    const id = await submit(w.form.publicKey, { name: 'Asha Rao', email: 'asha@northwind.example' });
    await runWrite(w.system, (context) => processSubmission(context, id, new Date(), undefined, rules));
    const sent = await w.query<{ member: string }>(
      sql`select to_member_id::text as member from emails where kind = 'form_submission'`,
    );
    expect(sent).toEqual([{ member: w.ada }]);
  });

  it('puts it in each told member’s inbox, and in the daily digest in place of the email for one who takes it', async () => {
    const w = await world();
    // Bea, the lead's owner, takes the daily digest; Ada, listed, gets an email each.
    await w.query(sql`insert into notification_settings (workspace_id, member_id, digest, time_zone)
      values (${w.workspaceId}, ${w.bea}, true, 'Europe/London')`);
    const id = await submit(w.form.publicKey, { name: 'Asha Rao', email: 'asha@northwind.example' });
    await runWrite(w.system, (context) => processSubmission(context, id, new Date(), undefined, rules));
    await runWrite(w.system, (context) => processSubmission(context, id, new Date(), undefined, rules));
    const emails = await w.query<{ member: string }>(
      sql`select to_member_id::text as member from emails where kind = 'form_submission'`,
    );
    expect(emails).toEqual([{ member: w.ada }]);
    const rows = await w.query<{ member: string; emailed: boolean }>(
      sql`select member_id::text as member, emailed_at is not null as emailed from notifications
          where submission_id = ${id} order by member_id = ${w.ada} desc`,
    );
    expect(rows).toEqual([
      { member: w.ada, emailed: true },
      { member: w.bea, emailed: false },
    ]);
    const asMember = (memberId: string, role: 'owner' | 'member') =>
      testScope({ db, workspaceId: w.workspaceId, actor: { type: 'member', id: memberId }, role });
    const [inAdas] = (await listNotifications(asMember(w.ada, 'owner'), { status: 'inbox' })).items;
    expect(inAdas).toMatchObject({
      kind: 'form_submission',
      submissionId: id,
      formId: w.form.id,
      formName: 'Contact us',
      record: { name: 'Asha Rao' },
      excerpt: '',
    });
    // Ada's was emailed already; Bea's waits for her digest, and only the digest holds it.
    expect((await unemailedNotifications(asMember(w.ada, 'owner'), { digest: true })).items).toEqual([]);
    expect((await unemailedNotifications(asMember(w.bea, 'member'))).items).toEqual([]);
    const digest = await unemailedNotifications(asMember(w.bea, 'member'), { digest: true });
    expect(digest.items.map((item) => item.submissionId)).toEqual([id]);
    // People closed to members: Bea's inbox no longer shows it (hidden means absent), nor her digest.
    const closed: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'object', objectId: w.form.mainObjectId ?? '' },
          level: 'none',
        },
      ],
      records: [],
    };
    const shut = testScope({
      db,
      workspaceId: w.workspaceId,
      actor: { type: 'member', id: w.bea },
      role: 'member',
      rules: closed,
    });
    expect((await listNotifications(shut, { status: 'inbox' })).items).toEqual([]);
    expect((await unemailedNotifications(shut, { digest: true })).items).toEqual([]);
  });

  it('tells nobody from a registry built without rules (fail closed)', async () => {
    const w = await world();
    const id = await submit(w.form.publicKey, { name: 'Asha Rao', email: 'asha@northwind.example' });
    await runWrite(w.system, (context) => processSubmission(context, id));
    expect(await w.query(sql`select 1 from emails where kind = 'form_submission'`)).toEqual([]);
  });

  it('reads each kind of answer as words', () => {
    expect(answerWords(true)).toBe('Yes');
    expect(answerWords(false)).toBe('No');
    expect(answerWords(' hi ')).toBe('hi');
    expect(answerWords(['a', 'b'])).toBe('a, b');
    expect(answerWords({ number: '+44 20 7946 0000' })).toBe('+44 20 7946 0000');
    expect(answerWords(undefined)).toBe('');
  });
});
