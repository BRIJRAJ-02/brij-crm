// Routing's two doors (spec 0037, lane L6), against the real Postgres: a team page books directly, its own question
// read by its rules, and through a team link form; both decisions show in Routing › Decisions and Overview. The Team
// link starter. The free time check at submit (no free time, the fallback, the contact sentence, a check that takes
// too long) and its steps. Only through a form. No CRM leak: two submits that differ only in an email the CRM knows
// get the same next step. ROUTING_IN_USE on deleting or pausing a page a published form books. And the door:
// Routing › Overview and Decisions need routing.manage.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  defaultAvailability,
  NO_FREE_TIME_MESSAGE,
  type FormDocument,
  type FormQuestion,
  type PublicBookInput,
  type RoutingRule,
  type SubmitBody,
  type SubmitNext,
} from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage, enterPublicForm } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar, BusyAnswer, BusyReader } from '../booking/calendar.ts';
import { createBookingPage, deleteBookingPage, updateBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, getPublicBookingPage, readPublicSlots } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createForm, publishForm, saveFormDraft } from '../forms/forms.ts';
import { submitForm } from '../forms/public.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { createRotation } from '../rotation/rotations.ts';
import { rescope, testScope } from '../testing.ts';
import { routingDecision, routingDecisions, routingOverview } from './log.ts';

const { appUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 9);
const registry = jobKinds({ environment: 'local' });
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-routing-two-doors-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC: the clock of every booking and every free time check. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const MONDAY_10 = '2026-11-02T10:00:00.000Z';

let made = 0;
/** A workspace with Bea and Cy (9 to 17 UTC weekdays) in one rotation, and two live team pages on it. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `two-doors-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Admin', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name.toLowerCase()}-${id.slice(-6)}@acme.example`}, 'member', 'system', 'system')`,
      ),
    );
    const scope = rescope(owner, { actor: { type: 'member', id }, role: 'member' });
    const range: [string, string] = ['09:00', '17:00'];
    await saveDefaultHours(scope, {
      availability: {
        ...defaultAvailability('UTC'),
        weekly: { mon: [range], tue: [range], wed: [range], thu: [range], fri: [range], sat: [], sun: [] },
      },
    });
    return { id, scope };
  };
  const bea = await addMember('Bea');
  const cy = await addMember('Cy');
  const rotation = await createRotation(
    owner,
    {
      id: newId(),
      settings: { name: 'Sales', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'none' },
      members: [bea.id, cy.id].map((memberId) => ({
        memberId,
        weight: 100,
        priority: 2,
        dailyCap: null,
        weeklyCap: null,
        isOn: true,
      })),
    },
    NOW,
  );
  const teamPage = (title: string) =>
    createBookingPage(
      owner,
      { id: newId(), title, timeZone: 'UTC', kind: 'round_robin', hosts: { fixed: [], rotations: [rotation.id] } },
      NOW,
    );
  const demo = await teamPage('Demo');
  const intro = await teamPage('Intro call');
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  return { ...created, owner, bea, cy, rotation, demo, intro, query };
}

type World = Awaited<ReturnType<typeof world>>;

const choice = (key: string, label: string, choices: string[]): FormQuestion => ({
  id: key,
  key,
  label,
  answerType: 'choice',
  choices,
  required: false,
  update: 'fill',
  kept: true,
});

/** A published People form with one more question, routed by `rules`, sending everyone else to `after`. */
async function publishedForm(w: World, rules: RoutingRule[], after: FormDocument['after']) {
  const created = await createForm(w.owner, { id: newId(), name: 'Contact us' });
  const saved = await saveFormDraft(w.owner, {
    formId: created.id,
    document: {
      ...created.draft,
      questions: [...created.draft.questions, choice('plan', 'Plan', ['Starter', 'Enterprise'])],
      routing: { rules },
      after,
    },
    expectedRevision: created.revision,
  });
  return publishForm(w.owner, { formId: created.id, expectedRevision: saved.revision });
}

const booksPage = (id: string, pageId: string, value: string): RoutingRule => ({
  id,
  when: { join: 'all', rules: [{ key: 'plan', op: 'is', value }] },
  then: { kind: 'book', bookingPageId: pageId, message: '' },
});

let sent = 0;
function body(answers: Record<string, unknown>, email?: string): SubmitBody {
  sent += 1;
  return {
    idempotencyKey: newId(),
    answers: { name: `Lead ${String(sent)}`, email: email ?? `lead-${String(sent)}@client.example`, ...answers },
    hidden: {},
    fillMs: 10_000,
  };
}

const allFree: BusyReader = () => Promise.resolve({ status: 'none' } satisfies BusyAnswer);
/** Every host busy for the next month. */
const allBusy: BusyReader = () =>
  Promise.resolve({
    status: 'read',
    busy: [{ start: '2026-10-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z' }],
  } satisfies BusyAnswer);

async function submit(publicKey: string, input: SubmitBody, busy: BusyReader = allFree, limitMs?: number) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  return submitForm(scope, registry, {
    formId,
    body: input,
    captcha: { kind: 'off' },
    answersKey: 'a-test-answers-key',
    signHandoff: (handoff) => `${handoff.submissionId}.${handoff.bookingPageId}`,
    freeTime: { busy, now: () => NOW, ...(limitMs === undefined ? {} : { limitMs }) },
  });
}

/** The submission and page a booking next step hands over (the test's token is `<submission>.<page>`). */
function handedOver(next: SubmitNext): { readonly submissionId: string; readonly pageId: string } {
  if (next.kind !== 'booking') throw new Error(`Expected a booking, got ${next.kind}.`);
  const token = new URL(next.url, 'https://book.example').searchParams.get('p') ?? '';
  const [submissionId = '', pageId = ''] = token.split('.');
  return { submissionId, pageId };
}

const calendar: BookingCalendar = {
  busy: allFree,
  events: () => Promise.resolve({ meetingId: newId() }),
};
const deps = { calendar, now: () => NOW, linkKey: LINK_KEY };

const bookInput = (email: string, answers?: Record<string, unknown>): PublicBookInput => ({
  idempotencyKey: newId(),
  start: MONDAY_10,
  duration: 30,
  name: 'Grace Hopper',
  email,
  timeZone: 'UTC',
  ...(answers === undefined ? {} : { answers }),
});

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

describe('two doors, one story', () => {
  it('books a team page directly by its own question and through a team link, both decisions in the log', async () => {
    const w = await world();
    // The Demo page asks the language, and its rule gives Spanish speakers Cy (AC-1352: the page's own answers).
    await updateBookingPage(
      w.owner,
      { pageId: w.demo.id, settings: { questions: [choice('language', 'Language', ['English', 'Spanish'])] } },
      NOW,
    );
    await updateBookingPage(
      w.owner,
      {
        pageId: w.demo.id,
        settings: {},
        routing: {
          rules: [
            {
              id: 'spanish',
              name: 'Spanish',
              when: { join: 'all', rules: [{ key: 'language', op: 'is', value: 'Spanish' }] },
              then: { kind: 'hosts', hosts: [w.cy.id] },
            },
          ],
        },
      },
      NOW,
    );
    // The direct door.
    const entry = await enterBookingPage({ db }, w.demo.publicKey);
    await bookPublicSlot(entry, deps, bookInput('maria@example.com', { language: 'Spanish' }));
    // The team link door: Enterprise books Demo.
    const form = await publishedForm(w, [booksPage('enterprise', w.demo.id, 'Enterprise')], {
      kind: 'message',
      message: '',
    });
    const answer = await submit(form.publicKey, body({ plan: 'Enterprise' }));
    const handed = handedOver(answer.next);
    expect(handed.pageId).toBe(w.demo.id);
    await bookPublicSlot(
      entry,
      deps,
      { ...bookInput(`lead-${String(sent)}@client.example`), start: '2026-11-02T11:00:00.000Z' },
      [],
      { submissionId: handed.submissionId },
    );

    const page = await w.query<{ rule_id: string | null; hosts: string[] | null; host: string }>(
      sql`select d.rule_id, d.hosts, b.host_member_id::text as host from routing_decisions d
          join bookings b on b.id = d.booking_id where d.surface_kind = 'booking_page' order by d.decided_at`,
    );
    expect(page[0]).toMatchObject({ rule_id: 'spanish', hosts: [w.cy.id], host: w.cy.id });
    // The team link's booking: the form's decision found its booking; the page's rules ran too (no Spanish answer).
    const formRow = await w.query<{ rule_id: string; booking_id: string | null }>(
      sql`select rule_id, booking_id::text from routing_decisions where surface_kind = 'form'`,
    );
    expect(formRow).toEqual([{ rule_id: 'enterprise', booking_id: expect.any(String) as unknown }]);

    const log = await routingDecisions(w.owner, {});
    expect(log.decisions.map((d) => d.surface.name).sort()).toEqual(['Contact us', 'Demo', 'Demo']);
    const direct = log.decisions.find((d) => d.rule?.id === 'spanish');
    expect(direct).toMatchObject({ rule: { position: 1, name: 'Spanish' }, guest: 'Grace Hopper' });
    expect(direct?.booking?.hostName).toBe('Cy');
    const filtered = await routingDecisions(w.owner, { surfaceId: form.id });
    expect(filtered.decisions).toHaveLength(1);
    expect(filtered.decisions[0]?.routedPage?.name).toBe('Demo');

    const overview = await routingOverview(w.owner, NOW);
    const demo = overview.surfaces.find((s) => s.id === w.demo.id);
    expect(demo).toMatchObject({ kind: 'booking_page', rules: 1, fallback: { kind: 'rotation' } });
    const contact = overview.surfaces.find((s) => s.id === form.id);
    expect(contact).toMatchObject({ kind: 'form', rules: 1, fallback: { kind: 'message' } });
  });

  it('records a decision for every team page booking, rules or none (the whole rotation)', async () => {
    const w = await world();
    const entry = await enterBookingPage({ db }, w.intro.publicKey);
    await bookPublicSlot(entry, deps, bookInput('walk-in@example.com'));
    const rows = await w.query<{ rule_id: string | null; booking_id: string | null }>(
      sql`select rule_id, booking_id::text from routing_decisions where surface_id = ${w.intro.id}::uuid`,
    );
    expect(rows).toEqual([{ rule_id: null, booking_id: expect.any(String) as unknown }]);
  });
});

describe('the Team link starter', () => {
  it('makes "Book a call" asking which live team page, one rule each, the first as the fallback', async () => {
    const w = await world();
    const form = await createForm(w.owner, { id: newId(), starter: 'team_link' });
    expect(form.name).toBe('Book a call');
    const asked = form.draft.questions.find((q) => q.key === 'meeting');
    expect(asked?.choices).toEqual(['Demo', 'Intro call']);
    expect(form.draft.questions.map((q) => q.key)).toEqual(['name', 'email', 'meeting']);
    expect(form.draft.routing.rules.map((r) => r.then)).toEqual([
      { kind: 'book', bookingPageId: w.demo.id, message: '' },
      { kind: 'book', bookingPageId: w.intro.id, message: '' },
    ]);
    expect(form.draft.after).toMatchObject({ kind: 'booking', bookingPageId: w.demo.id });
    // It publishes as it is, an ordinary form.
    const live = await publishForm(w.owner, { formId: form.id, expectedRevision: form.revision });
    expect(live.status).toBe('live');
  });

  it('is refused with no live team page', async () => {
    const w = await world();
    for (const page of [w.demo, w.intro]) {
      await updateBookingPage(w.owner, { pageId: page.id, settings: { status: 'paused' } }, NOW);
    }
    const refusal = await refusalOf(createForm(w.owner, { id: newId(), starter: 'team_link' }));
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', message: 'Make a team page or the workspace link first.' });
  });
});

describe('the free time check at submit', () => {
  it('sends the visitor to After someone sends it when the rule’s page has no free time, and records why', async () => {
    const w = await world();
    // The rule books Intro call with Cy only, and Cy is busy all month; Demo, the whole rotation, has Bea free.
    const form = await publishedForm(
      w,
      [
        {
          ...booksPage('enterprise', w.intro.id, 'Enterprise'),
          then: { kind: 'book', bookingPageId: w.intro.id, hosts: [w.cy.id], message: '' },
        },
      ],
      { kind: 'booking', bookingPageId: w.demo.id, countdownSeconds: 0, message: '' },
    );
    const cyFull: BusyReader = (request) => (request.memberId === w.cy.id ? allBusy(request) : allFree(request));
    const answer = await submit(form.publicKey, body({ plan: 'Enterprise' }), cyFull);
    expect(handedOver(answer.next).pageId).toBe(w.demo.id);
    const [row] = await w.query<{ routed_page_id: string; steps: unknown }>(
      sql`select routed_page_id::text, steps from routing_decisions where surface_kind = 'form'`,
    );
    expect(row?.routed_page_id).toBe(w.demo.id);
    expect(row?.steps).toEqual([
      { kind: 'no_free_time', pageId: w.intro.id },
      { kind: 'fallback', pageId: w.demo.id },
    ]);
    const log = await routingDecisions(w.owner, {});
    expect(log.decisions[0]?.steps.map((step) => step.pageName)).toEqual(['Intro call', 'Demo']);
  });

  it('thanks the visitor when no page has free time, and the same answer on a retry', async () => {
    const w = await world();
    const form = await publishedForm(w, [booksPage('enterprise', w.intro.id, 'Enterprise')], {
      kind: 'booking',
      bookingPageId: w.demo.id,
      countdownSeconds: 0,
      message: '',
    });
    const sentBody = body({ plan: 'Enterprise' });
    const answer = await submit(form.publicKey, sentBody, allBusy);
    expect(answer.next).toEqual({ kind: 'message', text: NO_FREE_TIME_MESSAGE, offersMeeting: false });
    const [row] = await w.query<{ routed_page_id: string | null; steps: unknown }>(
      sql`select routed_page_id::text, steps from routing_decisions where surface_kind = 'form'`,
    );
    expect(row?.routed_page_id).toBeNull();
    expect(row?.steps).toEqual([
      { kind: 'no_free_time', pageId: w.intro.id },
      { kind: 'no_free_time', pageId: w.demo.id },
      { kind: 'contact' },
    ]);
    const again = await submit(form.publicKey, sentBody, allFree);
    expect(again.next).toEqual({ kind: 'message', text: NO_FREE_TIME_MESSAGE, offersMeeting: false });
  });

  it('checks a form with no rules too, writing its decision row only for what the check did', async () => {
    const w = await world();
    const form = await publishedForm(w, [], {
      kind: 'booking',
      bookingPageId: w.demo.id,
      countdownSeconds: 0,
      message: '',
    });
    const free = await submit(form.publicKey, body({}), allFree);
    expect(free.next.kind).toBe('booking');
    const full = await submit(form.publicKey, body({}), allBusy);
    expect(full.next).toMatchObject({ kind: 'message', text: NO_FREE_TIME_MESSAGE });
    const rows = await w.query<{ rule_id: string | null; steps: unknown }>(
      sql`select rule_id, steps from routing_decisions where surface_kind = 'form'`,
    );
    expect(rows).toEqual([
      { rule_id: null, steps: [{ kind: 'no_free_time', pageId: w.demo.id }, { kind: 'contact' }] },
    ]);
  });

  it('answers the route unchecked past its time limit, and says so', async () => {
    const w = await world();
    const form = await publishedForm(w, [booksPage('enterprise', w.intro.id, 'Enterprise')], {
      kind: 'message',
      message: '',
    });
    const slow: BusyReader = () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({ status: 'none' });
        }, 400);
      });
    const answer = await submit(form.publicKey, body({ plan: 'Enterprise' }), slow, 50);
    expect(handedOver(answer.next).pageId).toBe(w.intro.id);
    const [row] = await w.query<{ steps: unknown }>(
      sql`select steps from routing_decisions where surface_kind = 'form'`,
    );
    expect(row?.steps).toEqual([{ kind: 'unchecked', pageId: w.intro.id, reason: 'timeout' }]);
  });
});

describe('only through a form', () => {
  it('shows no times and refuses a booking without a hand off, and books with one', async () => {
    const w = await world();
    await updateBookingPage(w.owner, { pageId: w.demo.id, settings: { formOnly: true } }, NOW);
    const entry = await enterBookingPage({ db }, w.demo.publicKey);
    expect((await getPublicBookingPage(entry)).formOnly).toBe(true);
    const query = { from: '2026-11-02T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z', duration: 30, tz: 'UTC' };
    expect((await readPublicSlots(entry, deps, query)).slots).toEqual([]);
    const refused = await refusalOf(bookPublicSlot(entry, deps, bookInput('skipper@example.com')));
    expect(refused.code).toBe('BOOKING_CLOSED');

    const form = await publishedForm(w, [booksPage('enterprise', w.demo.id, 'Enterprise')], {
      kind: 'message',
      message: '',
    });
    const handed = handedOver((await submit(form.publicKey, body({ plan: 'Enterprise' }))).next);
    const link = { submissionId: handed.submissionId };
    expect((await getPublicBookingPage(entry, undefined, link)).formOnly).toBeUndefined();
    expect((await readPublicSlots(entry, deps, query, link)).slots.length).toBeGreaterThan(0);
    const booked = await bookPublicSlot(entry, deps, bookInput(`lead-${String(sent)}@client.example`), [], link);
    expect(booked.booking.title).toBe('Demo');

    // Off again, the page books as before; a personal page can't take it.
    await updateBookingPage(w.owner, { pageId: w.demo.id, settings: { formOnly: false } }, NOW);
    expect((await readPublicSlots(entry, deps, query)).slots.length).toBeGreaterThan(0);
    const personal = await createBookingPage(w.owner, { id: newId(), title: 'Mine', timeZone: 'UTC' }, NOW);
    const refusal = await refusalOf(
      updateBookingPage(w.owner, { pageId: personal.id, settings: { formOnly: true } }, NOW),
    );
    expect(refusal).toMatchObject({ code: 'CONFIG_INVALID', field: 'formOnly' });
  });
});

describe('no CRM leak', () => {
  it('gives two submits that differ only in a CRM known email the same next step', async () => {
    const w = await world();
    // Pat is a known customer: a person record with their email.
    const people = w.objects.people ?? '';
    const fields = await w.query<{ id: string; slug: string }>(
      sql`select id::text, api_slug as slug from attributes where object_id = ${people}::uuid and api_slug in ('name', 'email_addresses')`,
    );
    const field = (slug: string) => fields.find((row) => row.slug === slug)?.id ?? '';
    await createRecord(w.owner, {
      objectId: people,
      values: { [field('name')]: { firstName: 'Pat' }, [field('email_addresses')]: ['pat@bigcustomer.example'] },
    });
    const form = await publishedForm(w, [booksPage('enterprise', w.demo.id, 'Enterprise')], {
      kind: 'booking',
      bookingPageId: w.intro.id,
      countdownSeconds: 0,
      message: '',
    });
    const known = await submit(form.publicKey, body({ plan: 'Enterprise' }, 'pat@bigcustomer.example'));
    const unknown = await submit(form.publicKey, body({ plan: 'Enterprise' }, 'nobody@new.example'));
    expect(known.next.kind).toBe(unknown.next.kind);
    expect(handedOver(known.next).pageId).toBe(handedOver(unknown.next).pageId);
    // Nothing of the CRM in the answer: no facts, no rule, no host.
    expect(JSON.stringify(known.next)).not.toMatch(/enterprise|Bea|Cy|person\./);
  });
});

describe('a page a published form sends people to', () => {
  it('can be neither deleted nor paused while a rule or After someone sends it books it', async () => {
    const w = await world();
    await publishedForm(w, [booksPage('enterprise', w.intro.id, 'Enterprise')], {
      kind: 'booking',
      bookingPageId: w.demo.id,
      countdownSeconds: 0,
      message: '',
    });
    const deleted = await refusalOf(deleteBookingPage(w.owner, { pageId: w.intro.id }));
    expect(deleted).toMatchObject({
      code: 'ROUTING_IN_USE',
      message: 'Rule 1 of Contact us sends people here. Change the rule first.',
    });
    const paused = await refusalOf(
      updateBookingPage(w.owner, { pageId: w.demo.id, settings: { status: 'paused' } }, NOW),
    );
    expect(paused).toMatchObject({ code: 'ROUTING_IN_USE' });
    expect(paused.message).toContain('Contact us');
  });

  it('lets a page go once only a draft names it', async () => {
    const w = await world();
    const draft = await createForm(w.owner, { id: newId(), name: 'Draft only' });
    await saveFormDraft(w.owner, {
      formId: draft.id,
      document: {
        ...draft.draft,
        after: { kind: 'booking', bookingPageId: w.intro.id, countdownSeconds: 5, message: '' },
      },
      expectedRevision: draft.revision,
    });
    await expect(deleteBookingPage(w.owner, { pageId: w.intro.id })).resolves.toEqual({ pageId: w.intro.id });
  });
});

describe('the door', () => {
  it('lets only holders of routing.manage read Overview and Decisions', async () => {
    const w = await world();
    const member = rescope(w.owner, { actor: { type: 'member', id: w.bea.id }, role: 'member' });
    expect((await refusalOf(routingOverview(member))).code).toBe('FORBIDDEN');
    expect((await refusalOf(routingDecisions(member, {}))).code).toBe('FORBIDDEN');
    expect((await refusalOf(routingDecision(member, { id: newId() }))).code).toBe('FORBIDDEN');
    const admin = rescope(w.owner, { actor: { type: 'member', id: w.bea.id }, role: 'admin' });
    await expect(routingOverview(admin)).resolves.toMatchObject({ surfaces: expect.any(Array) as unknown });
    expect((await refusalOf(routingDecision(admin, { id: newId() }))).code).toBe('NOT_FOUND');
  });

  it('refuses a tampered cursor with a code, never a fault', async () => {
    const w = await world();
    const forged = Buffer.from(`1|${newId()}`, 'utf8').toString('base64url');
    expect((await refusalOf(routingDecisions(w.owner, { cursor: forged }))).code).toBe('CONFIG_INVALID');
  });

  it('leaves out a decision whose person the reader can’t see, and keeps it for those who can', async () => {
    const w = await world();
    const entry = await enterBookingPage({ db }, w.intro.publicKey);
    await bookPublicSlot(entry, deps, bookInput('hidden-person@example.com'));
    expect((await routingDecisions(w.owner, {})).decisions).toHaveLength(1);
    const people = w.objects.people ?? '';
    const blind = rescope(w.owner, {
      role: 'admin',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'admin' }, target: { type: 'object', objectId: people }, level: 'none' },
        ],
        records: [],
      },
    });
    expect((await routingDecisions(blind, {})).decisions).toEqual([]);
  });
});
