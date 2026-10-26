// A booking page's own questions (spec 0057), against the real Postgres: saved on the page and checked where they
// file (AC-5717), drawn on the public page without their filing (AC-5709), checked at booking (AC-5710), kept on the
// booking with their labels (AC-5711), filed onto the person by each question's rule (AC-5712), and nothing made when
// the page keeps bookings out of the CRM (AC-5708). The pure helpers are checked at the end.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { BookingQuestions, PublicBookInput } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage } from '../access/door.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { NO_CALENDAR } from './calendar.ts';
import { bookingPageAttributes, createBookingPage, getBookingPage, listBookings, updateBookingPage } from './pages.ts';
import { bookPublicSlot, getPublicBookingPage } from './public.ts';
import { answerWords, bookingAnswersOf, handedOver, storedBookingAnswers } from './questions.ts';
import { listWorkspaceBookings } from './list.ts';

const { appUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY_9 = '2026-11-02T09:00:00.000Z';
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-booking-questions-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Questions',
    slug: `booking-questions-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Host', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const attributes = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(attributes.rows.map((row) => [row.slug, row.id]));
  return { ...created, owner, attribute: (slug: string): string => ids[slug] ?? '' };
}

const deps = { calendar: NO_CALENDAR, now: () => NOW, linkKey: LINK_KEY };

const bookInput = (over: Partial<PublicBookInput> = {}): PublicBookInput => ({
  idempotencyKey: newId(),
  start: MONDAY_9,
  duration: 30,
  name: 'Grace Hopper',
  email: 'grace@navy.example',
  timeZone: 'Europe/London',
  ...over,
});

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('It was let through.');
}

/** A Job title question filed on People's Job title, and an unfiled required Budget choice. */
function questionsOn(jobTitle: string, update: 'fill' | 'always' = 'fill'): BookingQuestions {
  return [
    {
      id: 'role',
      key: 'role',
      label: 'Your role',
      answerType: 'short_text',
      required: false,
      update,
      filedOn: { objectRole: 'main', attributeId: jobTitle },
    },
    {
      id: 'budget',
      key: 'budget',
      label: 'Budget',
      answerType: 'choice',
      choices: ['Under 5k', 'Over 5k'],
      required: true,
      update: 'fill',
    },
  ];
}

/** The person's current Job title. */
async function jobTitleOf(w: Awaited<ReturnType<typeof workspace>>, personId: string | undefined) {
  const found = await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute<{ text_value: string }>(
      sql`select text_value from "values" where record_id = ${personId ?? ''}::uuid and attribute_id = ${w.attribute('people.job_title')}::uuid and active_until is null`,
    ),
  );
  return found.rows[0]?.text_value;
}

describe('a booking page’s questions (spec 0057)', () => {
  it('saves, draws without filing, checks, keeps and files a question’s answer (AC-5701, AC-5709 to AC-5712)', async () => {
    const w = await workspace();
    const page = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Intro call',
        timeZone: 'UTC',
        settings: { questions: questionsOn(w.attribute('people.job_title')) },
      },
      NOW,
    );
    expect(page.questions).toHaveLength(2);
    expect(page.fileToCrm).toBe(true);
    const entry = await enterBookingPage({ db }, page.publicKey);

    // The public page names the questions, never where they are filed.
    const facts = await getPublicBookingPage(entry);
    expect(facts.questions?.map((question) => question.key)).toEqual(['role', 'budget']);
    expect(JSON.stringify(facts)).not.toContain(w.attribute('people.job_title'));

    // A missing required answer refuses the booking on its question, and books nothing.
    const refused = await refusalOf(bookPublicSlot(entry, deps, bookInput({ answers: { role: 'CTO' } })));
    expect(refused).toEqual([expect.objectContaining({ code: 'ATTRIBUTE_VALUE_INVALID', field: 'answers.budget' })]);
    expect(await listBookings(w.owner, { pageId: page.id, when: 'upcoming' }, NOW)).toEqual([]);

    // Answered: kept on the booking with its labels, the filed one on the person.
    await bookPublicSlot(entry, deps, bookInput({ answers: { role: 'CTO', budget: 'Over 5k', stray: 'dropped' } }));
    const [booking] = await listBookings(w.owner, { pageId: page.id, when: 'upcoming' }, NOW);
    expect(await jobTitleOf(w, booking?.personRecordId)).toBe('CTO');
    const stored = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ answers: unknown }>(sql`select answers from bookings`),
    );
    expect(storedBookingAnswers(stored.rows[0]?.answers)).toEqual([
      expect.objectContaining({ key: 'role', label: 'Your role', value: 'CTO', saved: true }),
      expect.objectContaining({ key: 'budget', label: 'Budget', value: 'Over 5k' }),
    ]);
    // Bookings shows them, label then answer (AC-5714).
    const [listed] = await listWorkspaceBookings(w.owner, { when: 'upcoming' }, NOW);
    expect(listed?.answers?.map((answer) => answer.label)).toEqual(['Your role', 'Budget']);

    // A rename later never changes what was answered.
    await updateBookingPage(w.owner, {
      pageId: page.id,
      settings: {
        questions: questionsOn(w.attribute('people.job_title')).map((question) => ({ ...question, label: 'Role' })),
      },
    });
    const [after] = await listWorkspaceBookings(w.owner, { when: 'upcoming' }, NOW);
    expect(after?.answers?.[0]?.label).toBe('Your role');
  });

  it('fills only an empty value, and overwrites with always (AC-5712)', async () => {
    const w = await workspace();
    const person = await createRecord(w.owner, {
      objectId: w.objects.people ?? '',
      values: {
        [w.attribute('people.name')]: { firstName: 'Lin' },
        [w.attribute('people.email_addresses')]: ['lin@acme.example'],
        [w.attribute('people.job_title')]: 'Founder',
      },
    });
    const fill = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Fill',
        timeZone: 'UTC',
        settings: { questions: questionsOn(w.attribute('people.job_title')) },
      },
      NOW,
    );
    const fillEntry = await enterBookingPage({ db }, fill.publicKey);
    await bookPublicSlot(
      fillEntry,
      deps,
      bookInput({ email: 'lin@acme.example', answers: { role: 'CTO', budget: 'Under 5k' } }),
    );
    expect(await jobTitleOf(w, person.recordId)).toBe('Founder');

    const always = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Always',
        timeZone: 'UTC',
        settings: { questions: questionsOn(w.attribute('people.job_title'), 'always') },
      },
      NOW,
    );
    const alwaysEntry = await enterBookingPage({ db }, always.publicKey);
    await bookPublicSlot(
      alwaysEntry,
      deps,
      bookInput({
        start: '2026-11-02T10:00:00.000Z',
        email: 'lin@acme.example',
        answers: { role: 'CTO', budget: 'Under 5k' },
      }),
    );
    expect(await jobTitleOf(w, person.recordId)).toBe('CTO');
  });

  it('finds and makes no records, and keeps the answers, on a page kept out of the CRM (AC-5708)', async () => {
    const w = await workspace();
    const page = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Private',
        timeZone: 'UTC',
        settings: { questions: questionsOn(w.attribute('people.job_title')), fileToCrm: false },
      },
      NOW,
    );
    const entry = await enterBookingPage({ db }, page.publicKey);
    await bookPublicSlot(entry, deps, bookInput({ answers: { role: 'CTO', budget: 'Under 5k' } }));
    const records = await db.withWorkspace(w.workspaceId, (tx) => tx.execute(sql`select 1 from records`));
    expect(records.rows).toHaveLength(0);
    const [booking] = await listBookings(w.owner, { pageId: page.id, when: 'upcoming' }, NOW);
    expect(booking?.personRecordId).toBeUndefined();
    const [listed] = await listWorkspaceBookings(w.owner, { when: 'upcoming' }, NOW);
    expect(listed?.answers).toHaveLength(2);
  });

  it('books as before on a page with no questions, and asks a chat booking none (AC-5704)', async () => {
    const w = await workspace();
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Plain', timeZone: 'UTC' }, NOW);
    const entry = await enterBookingPage({ db }, page.publicKey);
    expect((await getPublicBookingPage(entry)).questions).toBeUndefined();
    await bookPublicSlot(entry, deps, bookInput({ answers: { anything: 'ignored' } }));
    const stored = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ answers: Record<string, unknown> }>(sql`select answers from bookings`),
    );
    expect(stored.rows[0]?.answers).not.toHaveProperty('questions');
  });
});

describe('where a question may be filed (AC-5703, AC-5706, AC-5717)', () => {
  const filedOn = (attributeId: string): BookingQuestions => [
    {
      id: 'q',
      key: 'q',
      label: 'Question',
      answerType: 'short_text',
      required: false,
      update: 'fill',
      filedOn: { objectRole: 'main', attributeId },
    },
  ];

  it('refuses another object’s attribute, another workspace’s, an unknown id and the person’s email', async () => {
    const w = await workspace();
    const other = await workspace();
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Guarded', timeZone: 'UTC' }, NOW);
    const save = (questions: BookingQuestions) =>
      refusalOf(updateBookingPage(w.owner, { pageId: page.id, settings: { questions } }));
    const refusal = [expect.objectContaining({ code: 'CONFIG_INVALID', field: 'questions' })];
    expect(await save(filedOn(w.attribute('companies.description')))).toEqual(refusal);
    expect(await save(filedOn(other.attribute('people.job_title')))).toEqual(refusal);
    expect(await save(filedOn(newId()))).toEqual(refusal);
    expect(
      await save([
        { ...filedOn(w.attribute('people.email_addresses'))[0], answerType: 'email' } as BookingQuestions[0],
      ]),
    ).toEqual(refusal);
    // A text question onto a checkbox doesn't fit either.
    expect(await save(filedOn(w.attribute('people.email_opt_out')))).toEqual(refusal);
    // People's own Job title is fine.
    await updateBookingPage(w.owner, {
      pageId: page.id,
      settings: { questions: filedOn(w.attribute('people.job_title')) },
    });
  });

  it('lists People’s attributes for Where it goes, leaving the email out', async () => {
    const w = await workspace();
    const page = await createBookingPage(w.owner, { id: newId(), title: 'Targets', timeZone: 'UTC' }, NOW);
    const targets = await bookingPageAttributes(w.owner, { pageId: page.id });
    expect(targets.objectId).toBe(w.objects.people);
    const ids = targets.items.map((item) => item.attributeId);
    expect(ids).toContain(w.attribute('people.job_title'));
    expect(ids).not.toContain(w.attribute('people.email_addresses'));
  });
});

describe('a field hidden from the reader (hidden means absent)', () => {
  it('leaves its filing out of the page and its answers out of Bookings, keeps it on save, and refuses filing onto it', async () => {
    const w = await workspace();
    const title = w.attribute('people.job_title');
    const page = await createBookingPage(
      w.owner,
      { id: newId(), title: 'Hidden', timeZone: 'UTC', settings: { questions: questionsOn(title) } },
      NOW,
    );
    const entry = await enterBookingPage({ db }, page.publicKey);
    await bookPublicSlot(entry, deps, bookInput({ answers: { role: 'CTO', budget: 'Under 5k' } }));
    const blind = rescope(w.owner, {
      role: 'admin',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'admin' },
            target: { type: 'attribute', objectId: w.objects.people ?? '', attributeId: title },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    const seen = await getBookingPage(blind, { pageId: page.id }, NOW);
    expect(seen.questions[0]?.filedOn).toBeUndefined();
    expect(JSON.stringify(seen)).not.toContain(title);
    const [listed] = await listWorkspaceBookings(blind, { when: 'upcoming' }, NOW);
    expect(listed?.answers?.map((answer) => answer.key)).toEqual(['budget']);
    // Their save sends the questions as they saw them: the filing they never saw stays.
    await updateBookingPage(blind, {
      pageId: page.id,
      settings: { questions: seen.questions.map((question) => ({ ...question, label: `${question.label}!` })) },
    });
    const after = await getBookingPage(w.owner, { pageId: page.id }, NOW);
    expect(after.questions[0]?.filedOn?.attributeId).toBe(title);
    // And they can't file a question onto it themselves.
    const refused = await refusalOf(
      updateBookingPage(blind, {
        pageId: page.id,
        settings: { questions: [{ ...questionsOn(title)[0], id: 'new', key: 'new' } as BookingQuestions[0]] },
      }),
    );
    expect(refused).toEqual([expect.objectContaining({ code: 'CONFIG_INVALID', field: 'questions' })]);
  });
});

describe('the pure helpers', () => {
  const questions: BookingQuestions = [
    {
      id: 'a',
      key: 'role',
      label: 'Role',
      answerType: 'short_text',
      required: false,
      update: 'fill',
      filedOn: { objectRole: 'main', attributeId: 'attr-role' },
    },
    { id: 'b', key: 'team', label: 'Team', answerType: 'short_text', required: false, update: 'fill' },
  ];

  it('keeps the answers in the page’s order with their labels', () => {
    expect(bookingAnswersOf(questions, { team: 'Ops', role: 'CTO' }).map((each) => each.key)).toEqual(['role', 'team']);
  });

  it('skips what a form filed onto the same People attribute, and prefills by key (AC-5713)', () => {
    const handed = [
      { key: 'job', value: 'CTO', filedOn: { objectId: 'people', attributeId: 'attr-role' } },
      { key: 'team', value: 'Ops' },
    ];
    expect(handedOver(questions, handed, 'people')).toEqual({ skip: ['role'], answers: { team: 'Ops' } });
    // Filed on another object than People: nothing is skipped.
    expect(handedOver(questions, handed, 'companies').skip).toEqual([]);
  });

  it('words an answer for an email', () => {
    expect([
      answerWords('x'),
      answerWords(true),
      answerWords({ number: '+15550001234', country: 'US' }),
      answerWords(3),
    ]).toEqual(['x', 'Yes', '+15550001234', '']);
  });
});
