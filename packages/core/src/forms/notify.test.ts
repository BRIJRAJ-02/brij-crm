// The team's notice of a new submission (spec 0023 AC-1047, late trap #19), against a real Postgres as the app
// role: processing a submission queues one email to the lead's owner and one to the form's maker, each holding only
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
import { testScope } from '../testing.ts';
import { createForm, publishForm, saveFormDraft, updateFormSettings } from './forms.ts';
import { answerWords } from './notify.ts';
import { processSubmission } from './process.ts';
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
      submissionPath: expect.stringMatching(
        new RegExp(`^/w/[^/]+/captures/forms/${w.form.id}\\?tab=submissions&submission=${id}$`),
      ) as unknown,
    });
    expect(toAda?.params.answers.map((answer) => answer.label)).toContain('Job title');
    expect(toBea?.params.answers.map((answer) => answer.label)).not.toContain('Job title');
    expect(toBea?.params.answers.map((answer) => answer.label)).toContain('Why are you here?');
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
