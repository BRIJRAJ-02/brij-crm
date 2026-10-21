// Spec 0023 follow-up, against a real Postgres as the app role, through the
// job runner as the worker runs it: a submission's CRM link state, Add to CRM
// (one that failed, filed with the current mapping as the member; spam left
// out; a member without forms.manage refused), Sync old records (a preview,
// the job, and a second run that changes nothing), the CSV export (the file,
// the formula guard, only its starter reads it), and the filing and export
// jobs under their member's own rules (spec 0009, AC-147).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { FormDocument, type FormQuestion, type SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm, NO_RULE_SOURCE, type RuleSource } from '../access/door.ts';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { editAttribute } from '../attributes/attributes.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord, getRecords } from '../engine/records.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { getJob } from '../jobs/service.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { rescope, startJobForTest, testScope } from '../testing.ts';
import { jobTestKit } from '../../test/jobs-kit.ts';
import { exportFile, exportPart, getExport, startSubmissionsExport } from './export.ts';
import { addToCrm, NOT_MAPPED, previewSync, startSync } from './filing.ts';
import { createForm, getForm, listForms, publishForm, saveFormDraft, setFormTarget } from './forms.ts';
import { HIDDEN_TARGET, processSubmission } from './process.ts';
import { submitForm } from './public.ts';
import { getSubmission, listSubmissions } from './submissions.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-filing-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Filing',
    slug: `filing-${String(count)}-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  const rows = await query<{ id: string; slug: string }>(
    sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
  );
  const ids = Object.fromEntries(rows.map((row) => [row.slug, row.id]));
  const attribute = (slug: string): string => {
    const id = ids[slug];
    if (id === undefined) throw new Error(`No attribute ${slug}.`);
    return id;
  };
  // A second member, role member (no forms.manage), who exists for the runner.
  const otherId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
          values (${created.workspaceId}, ${otherId}, 'Grace', ${`${otherId}@example.com`}, 'member', 'system', 'system')`,
    ),
  );
  const other = rescope(scope, { actor: { type: 'member', id: otherId }, role: 'member' });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  return {
    workspaceId: created.workspaceId,
    scope,
    other,
    system,
    attribute,
    query,
    people: created.objects.people ?? '',
  };
}
type Workspace = Awaited<ReturnType<typeof workspace>>;

/** Runs a job to its end as the worker would, entering its member again with `rules` (none unless given). */
async function runJob(w: Workspace, jobId: string, rules: RuleSource = NO_RULE_SOURCE) {
  const kit = jobTestKit(db, ownerUrl, { rules });
  const outcomes = await kit.drive(kit.runnerFor(registry), w.workspaceId, jobId);
  return outcomes.at(-1);
}

/** Each test workspace's rules, by workspace id, as #24 will store them: the source a ruled job's runner reads. */
const rulesByWorkspace = new Map<string, AccessRules>();
const storedRules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>(sql`select current_setting('app.workspace_id', true) as id`);
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? NO_RULES;
};

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
): FormQuestion => ({ required: false, update: 'fill', ...changes });

/** A People form (name, email, phone, and a job title filed or not), published; returns a republisher. */
async function liveForm(w: Workspace, fileTitle: boolean) {
  const created = await createForm(w.scope, { id: newId(), name: 'Contact us' });
  const withTitle = (filed: boolean): FormDocument => ({
    ...created.draft,
    questions: [
      ...created.draft.questions,
      question({
        id: 'title',
        key: 'title',
        label: 'Job title',
        answerType: 'short_text',
        ...(filed ? { filedOn: { objectRole: 'main' as const, attributeId: w.attribute('people.job_title') } } : {}),
      }),
    ],
  });
  let revision = created.revision;
  const publish = async (filed: boolean) => {
    const saved = await saveFormDraft(w.scope, {
      formId: created.id,
      document: withTitle(filed),
      expectedRevision: revision,
    });
    const live = await publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
    revision = live.revision;
    return live;
  };
  const live = await publish(fileTitle);
  return { ...live, republish: publish };
}

function body(answers: Record<string, unknown>, extra: Partial<SubmitBody> = {}): SubmitBody {
  return { idempotencyKey: newId(), answers, hidden: {}, fillMs: 10_000, ...extra };
}

async function submit(publicKey: string, input: SubmitBody) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  return submitForm(scope, registry, { formId, body: input, captcha: { kind: 'off' }, answersKey: 'k' });
}

async function processNow(w: Workspace, submissionId: string) {
  await runWrite(w.system, (context) => processSubmission(context, submissionId));
}

async function submissionIds(w: Workspace, formId: string) {
  return w.query<{ id: string; state: string }>(
    sql`select id::text, state from form_submissions where form_id = ${formId} order by received_at, id`,
  );
}

describe('Add to CRM and the CRM link state', () => {
  it('files a failed submission with the current mapping as the member, leaves spam out, refuses a member without forms.manage', async () => {
    const w = await workspace();
    const live = await liveForm(w, true);
    await submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'needs@example.com', title: 'Engineer' }));
    await submit(live.publicKey, body({ name: 'Bot', email: 'bot@example.com' }, { company_url: 'x' }));
    const timezone = w.attribute('people.timezone');
    await editAttribute(w.scope, { attributeId: timezone, isRequired: true });
    const [failed, spam] = await submissionIds(w, live.id);
    if (failed === undefined || spam === undefined) throw new Error('Two submissions expected.');
    await processNow(w, failed.id);
    const listed = await listSubmissions(w.scope, { formId: live.id });
    expect(listed.items.map((item) => [item.state, item.crm])).toEqual([
      ['spam', { state: 'not_in_crm', canAddToCrm: false }],
      ['failed', { state: 'not_in_crm', canAddToCrm: true }],
    ]);
    await editAttribute(w.scope, { attributeId: timezone, isRequired: false });

    // A member without forms.manage: refused, nothing starts.
    expect(await refusalOf(addToCrm(w.other, registry, { formId: live.id, submissionIds: [failed.id] }))).toMatchObject(
      [{ code: 'FORBIDDEN' }],
    );

    const started = await addToCrm(w.scope, registry, { formId: live.id, submissionIds: [failed.id, spam.id] });
    expect(started).toMatchObject({ queued: 1, skipped: 1 });
    expect(await runJob(w, started.jobId ?? '')).toBe('succeeded');
    const view = await getSubmission(w.scope, { submissionId: failed.id });
    expect(view.state).toBe('processed');
    expect(view.crm).toMatchObject({ state: 'linked', record: { name: 'Ada Lovelace' } });
    const job = await getJob(w.scope, registry, started.jobId ?? '');
    expect(job).toMatchObject({ status: 'succeeded', done: 1, result: { filing: { created: 1 } } });
    // Written as the member, with history like any write.
    const writers = await w.query<{ type: string; id: string }>(
      sql`select created_by_type::text as type, created_by_id::text as id from records where id = ${
        view.crm.state === 'linked' ? view.crm.record.recordId : newId()
      }`,
    );
    expect(writers).toEqual([{ type: 'member', id: w.scope.actor.id }]);

    // Already linked now: nothing qualifies, no job.
    expect(await addToCrm(w.scope, registry, { formId: live.id, submissionIds: [failed.id] })).toEqual({
      queued: 0,
      skipped: 1,
    });
  });
});

describe('Sync old records', () => {
  it('previews, applies the new mapping in a job, and changes nothing when run again', async () => {
    const w = await workspace();
    const live = await liveForm(w, false);
    await submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com', title: 'Engineer' }));
    const [submission] = await submissionIds(w, live.id);
    if (submission === undefined) throw new Error('A submission expected.');
    await processNow(w, submission.id);
    const recordId = (await getSubmission(w.scope, { submissionId: submission.id })).mainRecord?.recordId ?? '';
    const title = w.attribute('people.job_title');
    const titleOf = async () =>
      (await getRecords(w.scope, { ids: [recordId], attributeIds: [title] }))[0]?.values[title];
    expect((await titleOf()) ?? null).toBeNull();

    // The mapping now files the job title.
    await live.republish(true);
    expect(await refusalOf(previewSync(w.other, { formId: live.id, scope: 'all' }))).toMatchObject([
      { code: 'FORBIDDEN' },
    ]);
    expect(await previewSync(w.scope, { formId: live.id, scope: 'all' })).toMatchObject({
      total: 1,
      checked: 1,
      capped: false,
      creates: 0,
      updates: 1,
      unchanged: 0,
      failures: 0,
    });
    expect(await previewSync(w.scope, { formId: live.id, scope: 'unfiled' })).toMatchObject({ total: 0 });

    expect(
      await refusalOf(startSync(w.other, registry, { formId: live.id, scope: 'all', jobId: newId() })),
    ).toMatchObject([{ code: 'FORBIDDEN' }]);
    // People hidden from a manager: the form is absent to them.
    const blind = rescope(w.scope, {
      role: 'admin',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'admin' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    expect(await refusalOf(previewSync(blind, { formId: live.id, scope: 'all' }))).toMatchObject([
      { code: 'NOT_FOUND' },
    ]);

    const jobId = newId();
    const started = await startSync(w.scope, registry, { formId: live.id, scope: 'all', jobId });
    expect(started).toEqual({ jobId, total: 1 });
    // The same id again starts nothing new.
    expect((await startSync(w.scope, registry, { formId: live.id, scope: 'all', jobId })).jobId).toBe(jobId);
    expect(await runJob(w, jobId)).toBe('succeeded');
    expect(JSON.stringify(await titleOf())).toContain('Engineer');
    expect(await getJob(w.scope, registry, jobId)).toMatchObject({ result: { filing: { updated: 1 } } });

    expect(await previewSync(w.scope, { formId: live.id, scope: 'all' })).toMatchObject({ updates: 0, unchanged: 1 });
    const again = await startSync(w.scope, registry, { formId: live.id, scope: 'all', jobId: newId() });
    expect(await runJob(w, again.jobId)).toBe('succeeded');
    expect(await getJob(w.scope, registry, again.jobId)).toMatchObject({
      result: { filing: { created: 0, updated: 0, unchanged: 1 } },
    });
    expect(
      await w.query(
        sql`select count(*)::int as n from records where id <> ${recordId} and object_id = (select object_id from records where id = ${recordId})`,
      ),
    ).toEqual([{ n: 0 }]);
  });
});

describe('a filing job whose member can’t manage forms', () => {
  it('stops at its first batch and files nothing', async () => {
    const w = await workspace();
    const live = await liveForm(w, true);
    await submit(live.publicKey, body({ name: 'Ada', email: 'ada@example.com' }));
    const [submission] = await submissionIds(w, live.id);
    if (submission === undefined) throw new Error('A submission expected.');
    await w.query(sql`update form_submissions set state = 'failed' where id = ${submission.id}`);
    // Started past addToCrm's own check, as if the member lost forms.manage after starting it.
    const { jobId } = await startJobForTest(w.other, registry, {
      kind: 'forms.file',
      params: { formId: live.id },
      items: [submission.id],
    });
    expect(await runJob(w, jobId)).toBe('failed');
    expect((await getJob(w.other, registry, jobId)).error).toMatchObject({ code: 'FORBIDDEN' });
    expect((await submissionIds(w, live.id))[0]?.state).toBe('failed');
  });
});

describe('the CSV export', () => {
  it('writes the submissions as CSV with the formula guard, for its starter only', async () => {
    const w = await workspace();
    const live = await liveForm(w, true);
    await submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com', title: 'Engineer, Senior' }));
    await submit(
      live.publicKey,
      body(
        { name: '=HYPERLINK("http://evil.example","x")', email: 'grace@example.com' },
        { hidden: { utm_source: '+news' } },
      ),
    );
    const exportId = newId();
    const started = await startSubmissionsExport(w.scope, registry, {
      id: exportId,
      formId: live.id,
      select: { kind: 'filter' },
    });
    expect(started).toMatchObject({ id: exportId, formId: live.id });
    expect(started.fileName).toMatch(/^Contact us - submissions - \d{4}-\d{2}-\d{2}\.csv$/u);
    // Not ready yet: no file.
    expect(await refusalOf(exportFile(w.scope, { exportId }))).toMatchObject([{ code: 'NOT_FOUND' }]);
    expect(await runJob(w, started.jobId)).toBe('succeeded');
    const file = await exportFile(w.scope, { exportId });
    const parts = await Promise.all(
      Array.from({ length: file.parts }, (_, part) => exportPart(w.scope, { exportId, part })),
    );
    const text = parts.join('');
    expect(
      text.startsWith('﻿Received at (UTC),Submission ID,State,Your name,Work email,Phone or WhatsApp,Job title,In CRM'),
    ).toBe(true);
    const lines = text
      .slice(1)
      .split('\r\n')
      .filter((line) => line !== '');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")",grace@example.com`);
    expect(lines[1]).toContain(",'+news,");
    expect(lines[2]).toContain('"Engineer, Senior"');
    expect((await getExport(w.scope, { exportId })).rowCount).toBe(2);

    // Anyone else: as if it didn't exist.
    expect(await refusalOf(getExport(w.other, { exportId }))).toMatchObject([{ code: 'NOT_FOUND' }]);
    expect(await refusalOf(exportFile(w.other, { exportId }))).toMatchObject([{ code: 'NOT_FOUND' }]);
    // The same id again answers the same export; another member's retry of it finds nothing.
    expect(
      (await startSubmissionsExport(w.scope, registry, { id: exportId, formId: live.id, select: { kind: 'filter' } }))
        .jobId,
    ).toBe(started.jobId);
    expect(
      await refusalOf(
        startSubmissionsExport(w.other, registry, { id: exportId, formId: live.id, select: { kind: 'filter' } }),
      ),
    ).toMatchObject([{ code: 'NOT_FOUND' }]);
    // Its starter under a narrower access than it was written with: gone for them too (hidden means absent).
    const narrower = rescope(w.scope, {
      role: 'admin',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'admin' },
            target: { type: 'attribute', objectId: w.people, attributeId: w.attribute('people.job_title') },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    expect(await refusalOf(exportFile(narrower, { exportId }))).toMatchObject([{ code: 'NOT_FOUND' }]);
    // At most five kept at once.
    for (let index = 0; index < 4; index += 1) {
      await startSubmissionsExport(w.scope, registry, { id: newId(), formId: live.id, select: { kind: 'filter' } });
    }
    expect(
      await refusalOf(
        startSubmissionsExport(w.scope, registry, { id: newId(), formId: live.id, select: { kind: 'filter' } }),
      ),
    ).toMatchObject([{ code: 'LIMIT_REACHED' }]);
  });
});

describe('A form that keeps its submissions only, connected to the CRM later (the owner, 21 October 2026)', () => {
  it('files nothing while kept, is for members who manage forms, then files the earlier ones exactly once', async () => {
    const w = await workspace();
    const peopleCount = async () =>
      (
        await w.query<{ n: number }>(
          sql`select count(*)::int as n from records where object_id = ${w.people} and deleted_at is null`,
        )
      )[0]?.n ?? 0;
    const before = await peopleCount();

    const created = await createForm(w.scope, { id: newId(), name: 'Event sign up', mainObjectId: null });
    expect(created.mainObjectId).toBeUndefined();
    expect(created.draft.targets.main).toBeUndefined();
    expect(created.draft.questions.every((each) => each.filedOn === undefined)).toBe(true);
    // On no object, so no object rule reaches it: absent to a member without forms.manage.
    expect(await refusalOf(getForm(w.other, { formId: created.id }))).toMatchObject([{ code: 'NOT_FOUND' }]);
    expect((await listForms(w.other, { archived: false })).items.map((form) => form.id)).not.toContain(created.id);
    expect((await listForms(w.scope, { archived: false })).items.map((form) => form.id)).toContain(created.id);
    // Filing an answer while it keeps submissions only is refused at the contract.
    expect(
      FormDocument.safeParse({
        ...created.draft,
        questions: created.draft.questions.map((each) =>
          each.key === 'email'
            ? { ...each, filedOn: { objectRole: 'main', attributeId: w.attribute('people.email_addresses') } }
            : each,
        ),
      }).success,
    ).toBe(false);

    // No email question filed is needed to go live.
    const live = await publishForm(w.scope, { formId: created.id, expectedRevision: created.revision });
    expect(live.liveVersionNumber).toBe(1);
    await submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com' }));
    await submit(live.publicKey, body({ name: 'Grace Hopper', email: 'grace@example.com' }));
    for (const each of await submissionIds(w, live.id)) await processNow(w, each.id);
    expect(await peopleCount()).toBe(before);
    const kept = await listSubmissions(w.scope, { formId: live.id });
    expect(kept.items.map((item) => [item.state, item.crm])).toEqual([
      ['processed', { state: 'not_in_crm', canAddToCrm: false }],
      ['processed', { state: 'not_in_crm', canAddToCrm: false }],
    ]);
    const ids = kept.items.map((item) => item.id);
    expect(await refusalOf(addToCrm(w.scope, registry, { formId: live.id, submissionIds: ids }))).toMatchObject([
      { code: 'FORM_STATE', message: NOT_MAPPED },
    ]);
    expect(await refusalOf(previewSync(w.scope, { formId: live.id, scope: 'unfiled' }))).toMatchObject([
      { code: 'FORM_STATE' },
    ]);

    // Connect later: People, refused to a member without forms.manage, then the questions filed and published.
    expect(
      await refusalOf(
        setFormTarget(w.other, { formId: live.id, mainObjectId: w.people, expectedRevision: live.revision }),
      ),
    ).toMatchObject([{ code: 'FORBIDDEN' }]);
    const pointed = await setFormTarget(w.scope, {
      formId: live.id,
      mainObjectId: w.people,
      expectedRevision: live.revision,
    });
    expect(pointed.mainObjectId).toBe(w.people);
    expect(pointed.draft.targets.main?.matchAttributeId).toBe(w.attribute('people.email_addresses'));
    // Its starting questions are filed as a new form's are, so it can go live as it is.
    expect(pointed.draft.questions.map((each) => [each.key, each.filedOn?.attributeId])).toEqual([
      ['name', w.attribute('people.name')],
      ['email', w.attribute('people.email_addresses')],
      ['phone', w.attribute('people.phone_numbers')],
    ]);
    // The draft changed; the live version still keeps submissions only until it is published.
    expect(pointed.live?.targets.main).toBeUndefined();
    const connected = await publishForm(w.scope, { formId: live.id, expectedRevision: pointed.revision });
    expect(connected.live?.targets.main?.objectId).toBe(w.people);
    expect((await listSubmissions(w.scope, { formId: live.id })).items.map((item) => item.crm)).toEqual([
      { state: 'not_in_crm', canAddToCrm: true },
      { state: 'not_in_crm', canAddToCrm: true },
    ]);

    // Sync old records: a preview, the job, then a second run that makes nothing more.
    expect(await previewSync(w.scope, { formId: live.id, scope: 'unfiled' })).toMatchObject({ total: 2, creates: 2 });
    const first = await startSync(w.scope, registry, { formId: live.id, scope: 'unfiled', jobId: newId() });
    expect(await runJob(w, first.jobId)).toBe('succeeded');
    expect(await peopleCount()).toBe(before + 2);
    const linked = await listSubmissions(w.scope, { formId: live.id });
    expect(linked.items.map((item) => (item.crm.state === 'linked' ? item.crm.record.name : item.crm.state))).toEqual([
      'Grace Hopper',
      'Ada Lovelace',
    ]);
    expect(await previewSync(w.scope, { formId: live.id, scope: 'all' })).toMatchObject({ creates: 0, unchanged: 2 });
    const second = await startSync(w.scope, registry, { formId: live.id, scope: 'all', jobId: newId() });
    expect(await runJob(w, second.jobId)).toBe('succeeded');
    expect(await peopleCount()).toBe(before + 2);

    // A new submission is filed with the version it was sent to.
    await submit(live.publicKey, body({ name: 'Alan Turing', email: 'alan@example.com' }));
    const newest = (await submissionIds(w, live.id)).at(-1);
    if (newest === undefined) throw new Error('A third submission expected.');
    await processNow(w, newest.id);
    expect((await getSubmission(w.scope, { submissionId: newest.id })).crm).toMatchObject({
      state: 'linked',
      record: { name: 'Alan Turing' },
    });

    // Turned off again: the earlier ones keep their records; a later one is kept only.
    const off = await setFormTarget(w.scope, {
      formId: live.id,
      mainObjectId: null,
      expectedRevision: connected.revision,
    });
    expect(off.draft.targets.main).toBeUndefined();
    expect(off.draft.questions.every((each) => each.filedOn === undefined)).toBe(true);
    await publishForm(w.scope, { formId: live.id, expectedRevision: off.revision });
    await submit(live.publicKey, body({ name: 'Mary Major', email: 'mary@example.com' }));
    const last = (await submissionIds(w, live.id)).at(-1);
    if (last === undefined) throw new Error('A fourth submission expected.');
    await processNow(w, last.id);
    expect(await peopleCount()).toBe(before + 3);
    const after = await listSubmissions(w.scope, { formId: live.id });
    expect(after.items.map((item) => item.crm.state)).toEqual(['not_in_crm', 'linked', 'linked', 'linked']);
    expect(after.items[0]?.crm).toEqual({ state: 'not_in_crm', canAddToCrm: false });
  });
});

describe('a member’s filing and export jobs on the worker (spec 0009, AC-147)', () => {
  it('run under the member’s own rules: a hidden field’s column is left out, a hidden record is never filed into', async () => {
    const w = await workspace();
    const live = await liveForm(w, true);
    // An admin (forms.manage) whose rules hide People's job title and every person they don't own.
    const adminId = newId();
    await w.query(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
          values (${w.workspaceId}, ${adminId}, 'Hedy', ${`${adminId}@example.com`}, 'admin', 'system', 'system')`,
    );
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'admin' },
          target: { type: 'attribute', objectId: w.people, attributeId: w.attribute('people.job_title') },
          level: 'hidden',
        },
      ],
      records: [
        {
          subject: { type: 'role', role: 'admin' },
          objectId: w.people,
          kind: 'own',
          attributeId: w.attribute('people.owner'),
        },
      ],
    };
    rulesByWorkspace.set(w.workspaceId, rules);
    const admin = rescope(w.scope, { actor: { type: 'member', id: adminId }, role: 'admin', rules });
    // Grace is in the CRM already, owned by no one, so the admin can't open her.
    const grace = (
      await createRecord(w.scope, {
        objectId: w.people,
        values: {
          [w.attribute('people.name')]: { firstName: 'Grace', lastName: 'Hopper' },
          [w.attribute('people.email_addresses')]: ['grace@example.com'],
        },
      })
    ).recordId;
    await submit(live.publicKey, body({ name: 'Ada Lovelace', email: 'ada@example.com', title: 'Engineer' }));
    await submit(live.publicKey, body({ name: 'Grace Hopper', email: 'grace@example.com', title: 'Admiral' }));
    const [ada, graces] = await submissionIds(w, live.id);
    if (ada === undefined || graces === undefined) throw new Error('Two submissions expected.');
    await w.query(sql`update form_submissions set state = 'failed' where form_id = ${live.id}`);

    // The export, written by the worker as the admin under their rules: no job title column, and no answer to it.
    const exported = await startSubmissionsExport(admin, registry, {
      id: newId(),
      formId: live.id,
      select: { kind: 'filter' },
    });
    expect(await runJob(w, exported.jobId, storedRules)).toBe('succeeded');
    const file = await exportFile(admin, { exportId: exported.id });
    const parts = await Promise.all(
      Array.from({ length: file.parts }, (_, part) => exportPart(admin, { exportId: exported.id, part })),
    );
    const text = parts.join('');
    expect(
      text.startsWith('\uFEFFReceived at (UTC),Submission ID,State,Your name,Work email,Phone or WhatsApp,In CRM'),
    ).toBe(true);
    expect(text).toContain('ada@example.com');
    expect(text).not.toContain('Engineer');
    // Given no rules, the worker would enter the admin with more than the export was started under: it refuses.
    const unruled = await startSubmissionsExport(admin, registry, {
      id: newId(),
      formId: live.id,
      select: { kind: 'filter' },
    });
    expect(await runJob(w, unruled.jobId, NO_RULE_SOURCE)).toBe('failed');
    expect((await getJob(admin, registry, unruled.jobId)).error).toMatchObject({ code: 'FORBIDDEN' });

    // Add to CRM under the same rules: Ada gets a new record; Grace belongs with the one the admin can't open, so
    // hers is refused, never filed into it nor named.
    const started = await addToCrm(admin, registry, { formId: live.id, submissionIds: [ada.id, graces.id] });
    expect(started).toMatchObject({ queued: 2, skipped: 0 });
    await runJob(w, started.jobId ?? '', storedRules);
    expect((await getSubmission(w.scope, { submissionId: ada.id })).crm).toMatchObject({
      state: 'linked',
      record: { name: 'Ada Lovelace' },
    });
    const refused = await getSubmission(w.scope, { submissionId: graces.id });
    expect(refused).toMatchObject({ state: 'failed', crm: { state: 'not_in_crm', canAddToCrm: true } });
    expect(refused.failure).toBe(HIDDEN_TARGET);
    // The same filing given no rules would have written into Grace's record: why the worker needs the member's.
    const again = await addToCrm(admin, registry, { formId: live.id, submissionIds: [graces.id] });
    await runJob(w, again.jobId ?? '', NO_RULE_SOURCE);
    expect((await getSubmission(w.scope, { submissionId: graces.id })).crm).toMatchObject({
      state: 'linked',
      record: { recordId: grace },
    });
  });
});
