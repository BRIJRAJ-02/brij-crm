// The forms QA lane (5 November 2026, "bulletproof before release"), against a real Postgres as the app role: a full
// 50 question form saves, publishes, takes a send and files it; the 51st question is refused; a 10,000 character
// answer is refused with nothing stored; Send pressed twice at once stores one submission; markup in answers is
// stored and filed as the characters it is; an email typed in capitals with spaces lands on the person already
// there; two editors saving the same revision at once keep one save and refuse the other; deleting a question a
// rule reads blocks the publish while the live form keeps taking sends; and the CSV export guards every formula
// start, in answers, choices and the questions' own words. The shapes are the server's, so these hold through the
// three forms lanes' redesigns.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type FormDocument, type FormQuestion, type SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord, getRecords } from '../engine/records.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { testScope } from '../testing.ts';
import { jobTestKit } from '../../test/jobs-kit.ts';
import { exportFile, exportPart, startSubmissionsExport } from './export.ts';
import { createForm, publishForm, saveFormDraft } from './forms.ts';
import { processSubmission } from './process.ts';
import { submitForm } from './public.ts';
import type { CaptchaVerdict } from './spam.ts';
import { getSubmission } from './submissions.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
const registry = jobKinds({ environment: 'local' });

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-forms-qa-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Forms QA',
    slug: `forms-qa-${String(count)}-${newId().slice(-12)}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
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
  return { workspaceId: created.workspaceId, scope, system, query, attribute, people: created.objects.people ?? '' };
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
): FormQuestion => ({ required: false, update: 'fill', ...changes });

/** A People form with the default name, email and phone, plus `more`, published. */
async function liveForm(w: Workspace, more: (draft: FormDocument) => FormQuestion[] = () => []) {
  const created = await createForm(w.scope, { id: newId(), name: 'Contact us' });
  const document: FormDocument = { ...created.draft, questions: [...created.draft.questions, ...more(created.draft)] };
  const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision });
  return publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
}

const off: CaptchaVerdict = { kind: 'off' };

function body(answers: Record<string, unknown>, extra: Partial<SubmitBody> = {}): SubmitBody {
  return { idempotencyKey: newId(), answers, hidden: {}, fillMs: 10_000, ...extra };
}

async function submit(publicKey: string, input: SubmitBody) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  return submitForm(scope, registry, { formId, body: input, captcha: off, answersKey: 'a-test-answers-key' });
}

async function submissions(w: Workspace, formId: string) {
  return w.query<{ id: string; state: string }>(
    sql`select id::text, state from form_submissions where form_id = ${formId} order by received_at, id`,
  );
}

async function processAll(w: Workspace, formId: string) {
  for (const row of await submissions(w, formId)) {
    if (row.state === 'received') await runWrite(w.system, (context) => processSubmission(context, row.id));
  }
}

/** The 47 questions after the default three: every text-like type in turn, so a full form mixes them. */
function fortySeven(): FormQuestion[] {
  const types = ['short_text', 'long_text', 'number', 'date', 'yes_no'] as const;
  return Array.from({ length: 47 }, (_, index) =>
    question({
      id: `q${String(index)}`,
      key: `q${String(index)}`,
      label: `Question ${String(index + 4)}`,
      answerType: types[index % types.length] ?? 'short_text',
    }),
  );
}

function answerFor(answerType: FormQuestion['answerType'], index: number): unknown {
  switch (answerType) {
    case 'number':
      return String(index * 10);
    case 'website':
      return `site${String(index)}.example.com`;
    case 'date':
      return '2026-11-05';
    case 'yes_no':
      return index % 2 === 0;
    default:
      return `Answer ${String(index)}`;
  }
}

describe('a 50 question form (forms QA)', () => {
  it('saves, publishes, takes a send of every answer and files it', async () => {
    const w = await workspace();
    const extra = fortySeven();
    const live = await liveForm(w, () => extra);
    expect(live.draft.questions).toHaveLength(50);
    const answers = {
      name: 'Ada Lovelace',
      email: 'ada.fifty@example.com',
      ...Object.fromEntries(extra.map((q, index) => [q.key, answerFor(q.answerType, index)])),
    };
    await submit(live.publicKey, body(answers));
    await processAll(w, live.id);
    const [row] = await submissions(w, live.id);
    expect(row?.state).toBe('processed');
    const view = await getSubmission(w.scope, { submissionId: row?.id ?? '' });
    // Every answered question reads back (a yes or no answered false is still an answer).
    expect(view.answers.length).toBeGreaterThanOrEqual(49);
    expect(view.records).toMatchObject([{ action: 'created' }]);
  });

  it('never stores a 51st question: the save fails and the draft stays as it was', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Too long' });
    const document: FormDocument = {
      ...created.draft,
      questions: [
        ...created.draft.questions,
        ...fortySeven(),
        question({ id: 'one_more', key: 'one_more', label: 'One more', answerType: 'short_text' }),
      ],
    };
    // The api's input schema refuses it with "A form holds at most 50 questions." before core is reached
    // (qa-bulletproof.test.ts in contracts); called directly, core must still never keep it.
    await expect(
      saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision }),
    ).rejects.toThrow(/at most 50 questions/);
    const stored = await w.query<{ n: number }>(
      sql`select jsonb_array_length(v.document -> 'questions')::int as n from forms f join form_versions v on v.workspace_id = f.workspace_id and v.id = f.draft_version_id where f.id = ${created.id}`,
    );
    expect(stored[0]?.n).toBe(3);
  });
});

// BUG (forms QA, 5 November 2026): `scoreContent` counts the answers to Website questions as links, so a form that
// asks for several (a recruiting form: website, LinkedIn, GitHub, portfolio, X) puts every honest visitor at
// `many_links` (4 points, past `reviewAt` 3) and holds them all in Needs review, unfiled and unnotified.
describe('a form asking for several web addresses (BUG: fails today)', () => {
  it('files an honest visitor who answers five Website questions, never holding them for review', async () => {
    const w = await workspace();
    const keys = ['website', 'linkedin', 'github', 'portfolio', 'x_profile'];
    const live = await liveForm(w, () =>
      keys.map((key) => question({ id: key, key, label: key, answerType: 'website' })),
    );
    await submit(
      live.publicKey,
      body({
        name: 'Ada Lovelace',
        email: 'ada.links@example.com',
        website: 'ada.example.com',
        linkedin: 'linkedin.com/in/ada',
        github: 'github.com/ada',
        portfolio: 'ada.dev',
        x_profile: 'x.com/ada',
      }),
    );
    expect((await submissions(w, live.id)).map((row) => row.state)).toEqual(['received']);
  });
});

describe('answers at and past their limits (forms QA)', () => {
  it('refuses a 10,000 character answer by its key, and stores nothing', async () => {
    const w = await workspace();
    const live = await liveForm(w, () => [
      question({ id: 'why', key: 'why', label: 'Why are you here?', answerType: 'long_text' }),
    ]);
    const refusals = await refusalOf(
      submit(live.publicKey, body({ name: 'Ada', email: 'ada@example.com', why: 'x'.repeat(10_000) })),
    );
    expect(refusals).toMatchObject([{ field: 'why', message: 'That is longer than this question takes.' }]);
    expect(await submissions(w, live.id)).toEqual([]);
  });
});

describe('Send pressed twice (forms QA)', () => {
  it('stores one submission when the same attempt arrives twice at the same moment', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const attempt = body({ name: 'Ada', email: 'ada.twice@example.com' });
    const outcomes = await Promise.allSettled([submit(live.publicKey, attempt), submit(live.publicKey, attempt)]);
    // Neither press is an error the visitor sees: one stores it, the other is answered as the same send.
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await submissions(w, live.id)).toHaveLength(1);
  });
});

describe('markup in answers (forms QA)', () => {
  it('is stored and filed on the record as the characters it is', async () => {
    const w = await workspace();
    const live = await liveForm(w, () => [
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
        filedOn: { objectRole: 'main', attributeId: w.attribute('people.description') },
      }),
    ]);
    const title = '<img src=x onerror=alert(1)>';
    const about = '<script>alert("x")</script>\n<b>bold</b> & "quotes"';
    await submit(live.publicKey, body({ name: 'Ada <b>Lovelace</b>', email: 'ada.markup@example.com', title, about }));
    await processAll(w, live.id);
    const [row] = await submissions(w, live.id);
    const view = await getSubmission(w.scope, { submissionId: row?.id ?? '' });
    expect(view.answers.find((answer) => answer.key === 'title')?.value).toBe(title);
    expect(view.answers.find((answer) => answer.key === 'about')?.value).toBe(about);
    const recordId = view.records[0]?.record.recordId ?? '';
    const [record] = await getRecords(w.scope, { ids: [recordId] });
    expect(record?.values[w.attribute('people.job_title')]).toBe(title);
    expect(record?.values[w.attribute('people.description')]).toBe(about);
  });
});

describe('the submission lands on the right record (forms QA)', () => {
  it('matches an email typed in capitals with spaces round it to the person already there', async () => {
    const w = await workspace();
    const live = await liveForm(w);
    const existing = await createRecord(w.scope, {
      objectId: w.people,
      values: {
        [w.attribute('people.name')]: { firstName: 'Grace' },
        [w.attribute('people.email_addresses')]: ['grace@example.com'],
      },
    });
    await submit(live.publicKey, body({ name: 'Grace Hopper', email: '  GRACE@Example.COM ' }));
    await processAll(w, live.id);
    const [row] = await submissions(w, live.id);
    const view = await getSubmission(w.scope, { submissionId: row?.id ?? '' });
    expect(view.records).toMatchObject([{ action: 'updated', record: { recordId: existing.recordId } }]);
    const people = await w.query<{ n: number }>(
      sql`select count(*)::int as n from records where object_id = ${w.people} and deleted_at is null`,
    );
    expect(people[0]?.n).toBe(1);
  });
});

describe('two editors on one form (forms QA)', () => {
  it('keeps one of two saves of the same revision made at once, and refuses the other as changed', async () => {
    const w = await workspace();
    const created = await createForm(w.scope, { id: newId(), name: 'Shared' });
    const edit = (label: string): FormDocument => ({
      ...created.draft,
      questions: [...created.draft.questions, question({ id: 'extra', key: 'extra', label, answerType: 'short_text' })],
    });
    const outcomes = await Promise.allSettled([
      saveFormDraft(w.scope, {
        formId: created.id,
        document: edit('From editor one'),
        expectedRevision: created.revision,
      }),
      saveFormDraft(w.scope, {
        formId: created.id,
        document: edit('From editor two'),
        expectedRevision: created.revision,
      }),
    ]);
    const kept = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(kept).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const reason: unknown = refused[0]?.status === 'rejected' ? refused[0].reason : undefined;
    expect(isRefusal(reason) && reason.refusals[0]?.code).toBe('FORM_CHANGED');
  });
});

describe('deleting a question a rule reads (forms QA)', () => {
  it('blocks the publish with a plain reason, and the live form keeps taking sends', async () => {
    const w = await workspace();
    const budget = question({
      id: 'budget',
      key: 'budget',
      label: 'Budget',
      answerType: 'choice',
      choices: ['Under $10k', 'Over $10k'],
    });
    const detail = question({
      id: 'detail',
      key: 'detail',
      label: 'Tell us about the budget',
      answerType: 'long_text',
      required: true,
      showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Over $10k' }] },
    });
    const live = await liveForm(w, () => [budget, detail]);
    // The owner deletes Budget; the draft saves (they may fix the rule next), but it can't go live as it is.
    const saved = await saveFormDraft(w.scope, {
      formId: live.id,
      document: { ...live.draft, questions: live.draft.questions.filter((q) => q.key !== 'budget') },
      expectedRevision: live.revision,
    });
    const refusals = await refusalOf(publishForm(w.scope, { formId: live.id, expectedRevision: saved.revision }));
    expect(refusals.map((refusal) => refusal.message).join(' ')).toMatch(/no longer on the form/);
    // A visitor on the live version answers as before.
    await submit(
      live.publicKey,
      body({ name: 'Ada', email: 'ada.rule@example.com', budget: 'Over $10k', detail: 'A lot' }),
    );
    expect(await submissions(w, live.id)).toHaveLength(1);
  });
});

describe('the CSV export guards every formula start (forms QA)', () => {
  it('in long answers, picked choices and the questions’ own words', async () => {
    const w = await workspace();
    const live = await liveForm(w, () => [
      question({ id: 'note', key: 'note', label: '=SUM(1,1) your note', answerType: 'long_text' }),
      question({
        id: 'size',
        key: 'size',
        label: 'Team size',
        answerType: 'choice',
        choices: ['-5 people', '+5 people'],
      }),
      question({ id: 'site', key: 'site', label: 'Website', answerType: 'short_text' }),
    ]);
    const attacks = ["=cmd|' /C calc'!A0", '@SUM(A1:A2)', '\t=1+1', '-2+3'];
    for (const [index, attack] of attacks.entries()) {
      await submit(
        live.publicKey,
        body({
          name: `Visitor ${String(index)}`,
          email: `v${String(index)}@example.com`,
          note: attack,
          size: '-5 people',
          site: '+44 20 7946 0000',
        }),
      );
    }
    const exportId = newId();
    const started = await startSubmissionsExport(w.scope, registry, {
      id: exportId,
      formId: live.id,
      select: { kind: 'filter' },
    });
    const kit = jobTestKit(db, ownerUrl);
    await kit.drive(kit.runnerFor(registry), w.workspaceId, started.jobId);
    const file = await exportFile(w.scope, { exportId });
    const text = (
      await Promise.all(Array.from({ length: file.parts }, (_, part) => exportPart(w.scope, { exportId, part })))
    ).join('');
    // Split into cells the way a spreadsheet would (quotes honoured), then no cell may start a formula.
    const cells: string[] = [];
    for (const match of text.replace(/^\uFEFF/u, '').matchAll(/("([^"]|"")*"|[^,\r\n]*)(,|\r\n|$)/gu)) {
      const raw = match[1] ?? '';
      if (raw === '' && match[3] === '') continue;
      cells.push(raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw);
    }
    const formulas = cells.filter((cell) => /^[=+\-@\t\r]/u.test(cell));
    expect(formulas).toEqual([]);
    expect(cells).toContain("'=SUM(1,1) your note");
    expect(cells).toContain("'-5 people");
    expect(cells).toContain("'@SUM(A1:A2)");
  });
});
