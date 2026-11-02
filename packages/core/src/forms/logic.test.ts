// Spec 0063 slice 5 on the server, against a real Postgres as the app role: the submit endpoint works the path and
// the score out again from the answers it stored, so a forged submission can't buy itself a score or an ending, and
// the score it files is its own (AC-6313, AC-6314, AC-6315, AC-6316, AC-6317).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import { createAttribute } from '../attributes/attributes.ts';
import { newId } from '../engine/ids.ts';
import { getRecords } from '../engine/records.ts';
import { getSubmission } from './submissions.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { testScope } from '../testing.ts';
import { createForm, publishForm, saveFormDraft } from './forms.ts';
import { processSubmission } from './process.ts';
import { getPublicForm, submitForm } from './public.ts';
import type { CaptchaVerdict } from './spam.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-forms-logic-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Logic',
    slug: `logic-${String(count)}-${String(Date.now())}`,
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
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  return { scope, system, people: created.objects.people ?? '', attribute };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

const off: CaptchaVerdict = { kind: 'off' };

/**
 * A live Steps form: step one asks the budget and jumps to the "Not a fit" ending when it is under $1k; step two
 * asks the team's size and a note. The budget's choices are worth 2, 3 and 5 points, filed onto a Lead score.
 */
async function logicForm(w: Workspace) {
  const scoreId = await createAttribute(w.scope, {
    id: newId(),
    objectId: w.people,
    title: 'Lead score',
    type: 'number',
  });
  const created = await createForm(w.scope, { id: newId(), name: 'Qualify' });
  const document: FormDocument = {
    ...created.draft,
    layout: 'steps',
    questions: [
      ...created.draft.questions,
      {
        id: 'budget',
        key: 'budget',
        label: 'Budget',
        answerType: 'choice',
        choices: ['Under $1k', '$5k', '$10k'],
        required: true,
        update: 'fill',
        points: [2, 3, 5],
      },
      { id: 'team', key: 'team', label: 'Team size', answerType: 'number', required: true, update: 'fill' },
      {
        id: 'note',
        key: 'note',
        label: 'Anything else, {{budget}}?',
        answerType: 'long_text',
        required: false,
        update: 'fill',
      },
    ],
    steps: [
      {
        id: 's2',
        startsAt: 'budget',
        jumps: [
          {
            when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Under $1k' }] },
            to: { ending: 'no_fit' },
          },
        ],
      },
      { id: 's3', startsAt: 'team' },
    ],
    endings: [{ id: 'no_fit', heading: 'Thanks {{name}}, we are not a fit', line: 'You scored {{score}}.' }],
    scoreFiledOn: { objectRole: 'main', attributeId: scoreId.id },
  };
  const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision });
  const live = await publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
  return { ...live, scoreId: scoreId.id };
}

const body = (answers: Record<string, unknown>): SubmitBody => ({
  idempotencyKey: newId(),
  answers,
  hidden: {},
  fillMs: 10_000,
});

async function submit(publicKey: string, input: SubmitBody) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  return submitForm(scope, registry, { formId, body: input, captcha: off });
}

async function answersOf(w: Workspace, formId: string) {
  const rows = await db.withWorkspace(w.scope.workspaceId, (tx) =>
    tx.execute<{ answers: Record<string, unknown> }>(
      sql`select answers from form_submissions where form_id = ${formId} order by received_at, id`,
    ),
  );
  return rows.rows.map((row) => row.answers);
}

/** The score filed onto the record one submission made: it is processed as the job does, then the record is read. */
async function filedScore(w: Workspace, formId: string, scoreId: string): Promise<unknown> {
  const [row] = await db
    .withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id::text from form_submissions where form_id = ${formId}`),
    )
    .then((result) => result.rows);
  if (row === undefined) throw new Error('No submission was stored.');
  await runWrite(w.system, (context) => processSubmission(context, row.id));
  const view = await getSubmission(w.scope, { submissionId: row.id });
  const [record] = await getRecords(w.scope, { ids: [view.mainRecord?.recordId ?? ''] });
  return record?.values[scoreId];
}

describe('a form’s jumps, endings and score at submit (spec 0063, AC-6313 to AC-6317)', () => {
  it('sends the page the steps with their jumps, the endings, and points only where the page reads the score', async () => {
    const w = await workspace();
    const live = await logicForm(w);
    const { scope, formId } = await enterPublicForm({ db }, live.publicKey);
    const rendered = await getPublicForm(scope, { formId });
    expect(rendered.layout).toBe('steps');
    expect(rendered.steps?.map((step) => step.keys)).toEqual([
      ['name', 'email', 'phone'],
      ['budget'],
      ['team', 'note'],
    ]);
    expect(rendered.steps?.[1]?.jumps?.[0]?.to).toEqual({ ending: 'no_fit' });
    expect(rendered.endings).toEqual([
      { id: 'no_fit', heading: 'Thanks {{name}}, we are not a fit', line: 'You scored {{score}}.' },
    ]);
    // The form's own words read the score, so the page is told what its answers are worth.
    expect(rendered.questions.find((question) => question.key === 'budget')?.points).toEqual([2, 3, 5]);
    // No attribute id, no filing and no score filing ever reach a visitor.
    const text = JSON.stringify(rendered);
    expect(text).not.toContain(live.scoreId);
    expect(text).not.toContain('scoreFiledOn');
  });

  it('drops a forged submission’s answers to the questions a jump skipped, and lands it on the jump’s ending', async () => {
    const w = await workspace();
    const live = await logicForm(w);
    const outcome = await submit(
      live.publicKey,
      body({ name: 'Ada', email: 'ada@acme.com', budget: 'Under $1k', team: '40', note: 'forged' }),
    );
    expect(outcome.next).toMatchObject({
      kind: 'message',
      ending: 'no_fit',
      heading: 'Thanks Ada, we are not a fit',
      text: 'You scored 2.',
    });
    const [stored] = await answersOf(w, live.id);
    expect(Object.keys(stored ?? {}).sort()).toEqual(['budget', 'email', 'name']);
  });

  it('asks the rest, and gives the form’s own thank you, when no jump matches', async () => {
    const w = await workspace();
    const live = await logicForm(w);
    const outcome = await submit(
      live.publicKey,
      body({ name: 'Ada', email: 'ada@acme.com', budget: '$10k', team: '40', note: 'Soon' }),
    );
    expect(outcome.next.kind).toBe('message');
    expect(outcome.next).not.toHaveProperty('ending');
    const [stored] = await answersOf(w, live.id);
    expect(Object.keys(stored ?? {}).sort()).toEqual(['budget', 'email', 'name', 'note', 'team']);
  });

  it('files the score it works out itself, and ignores a score the page sends', async () => {
    const w = await workspace();
    const live = await logicForm(w);
    const outcome = await submit(
      live.publicKey,
      body({ name: 'Ada', email: 'ada@acme.com', budget: '$10k', team: '40', score: 99 }),
    );
    expect(outcome.verdict).not.toBe('spam');
    const [stored] = await answersOf(w, live.id);
    // A key that is no question of the form is dropped, so a forged score never even reaches the submission.
    expect(stored).not.toHaveProperty('score');
    // A number field holds its value as text, as every number a form files does.
    expect(await filedScore(w, live.id, live.scoreId)).toBe('5');
  });

  it('files the score of the path the visitor really took, not of the answers they sent', async () => {
    const w = await workspace();
    const live = await logicForm(w);
    // "Under $1k" jumps to the ending, so the $10k answer to a skipped question can never raise the score.
    await submit(live.publicKey, body({ name: 'Ada', email: 'ada@acme.com', budget: 'Under $1k', team: '40' }));
    expect(await filedScore(w, live.id, live.scoreId)).toBe('2');
  });

  it('shows a name holding markup as the characters it is, never as markup', async () => {
    const w = await workspace();
    const live = await logicForm(w);
    const outcome = await submit(
      live.publicKey,
      body({ name: '<b>Ada</b>', email: 'ada@acme.com', budget: 'Under $1k' }),
    );
    expect(outcome.next).toMatchObject({ heading: 'Thanks <b>Ada</b>, we are not a fit' });
  });
});
