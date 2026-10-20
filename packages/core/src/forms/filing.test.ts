// Spec 0023 follow-up, against a real Postgres as the app role, through the
// job runner as the worker runs it: a submission's CRM link state, Add to CRM
// (one that failed, filed with the current mapping as the member; spam left
// out; a member without forms.manage refused), Sync old records (a preview,
// the job, and a second run that changes nothing), and the CSV export (the
// file, the formula guard, only its starter reads it).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, FormQuestion, SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import { editAttribute } from '../attributes/attributes.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { getRecords } from '../engine/records.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { getJob } from '../jobs/service.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { rescope, startJobForTest, testScope } from '../testing.ts';
import { jobTestKit } from '../../test/jobs-kit.ts';
import { exportFile, exportPart, getExport, startSubmissionsExport } from './export.ts';
import { addToCrm, previewSync, startSync } from './filing.ts';
import { createForm, publishForm, saveFormDraft } from './forms.ts';
import { processSubmission } from './process.ts';
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

/** Runs a job to its end as the worker would. */
async function runJob(w: Workspace, jobId: string) {
  const run = jobTestKit(db, ownerUrl).runnerFor(registry);
  const outcomes = await jobTestKit(db, ownerUrl).drive(run, w.workspaceId, jobId);
  return outcomes.at(-1);
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
