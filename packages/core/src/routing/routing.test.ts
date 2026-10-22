// Lead routing end to end in core (spec 0043), against the real Postgres:
// deciding a route, Show when dropping hidden answers, a form's rules sending
// visitors on with a decision row, a team page's rules narrowing hosts by a
// record field, a hand off's hosts narrowing the slots, the fallback when the
// routed hosts are busy, the report's counts, and the no show mark's door.
// Then the leftovers: one decision per submission, is any of, a company read
// only through the person's Company field, UTM and hidden field facts, and
// record facts that never cross workspaces. Last, hidden means absent: a team
// page's rule over a field its reader can't see is in none of their answers,
// their saves keep it in its place, and a booking still routes by it; and the
// migration that rewrites a record fact key the contract now refuses.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  defaultAvailability,
  type FormDocument,
  type FormQuestion,
  type PublicBookInput,
  type RoutingRule,
  type SubmitBody,
} from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { enterBookingPage, enterPublicForm } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import { markNoShow } from '../booking/change.ts';
import type { BookingCalendar, BusyAnswer } from '../booking/calendar.ts';
import { createBookingPage, getBookingPage, listBookingPages, updateBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, readPublicSlots } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { archiveAttribute } from '../engine/definitions.ts';
import { postgresError } from '../engine/refusals.ts';
import { createRecord, setValues } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createForm, getForm, publishForm, saveFormDraft } from '../forms/forms.ts';
import { submitForm } from '../forms/public.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { createRotation } from '../rotation/rotations.ts';
import { createRelationship } from '../relationships/relationships.ts';
import { rescope, testScope } from '../testing.ts';
import { decideRoute } from './decide.ts';
import { routeSubmission } from './forms.ts';
import { routingReport } from './report.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 7);
const registry = jobKinds({ environment: 'local' });
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-routing-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC: the booking clock. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const at = (time: string) => `2026-11-02T${time}:00.000Z`;

const rule = (id: string, over: Partial<RoutingRule> & Pick<RoutingRule, 'when' | 'then'>): RoutingRule => ({
  id,
  ...over,
});

describe('deciding a route', () => {
  const rules: RoutingRule[] = [
    rule('big', {
      when: { join: 'all', rules: [{ key: 'size', op: 'more_than', value: '50' }] },
      then: { kind: 'message', message: 'Big' },
      qualified: true,
    }),
    rule('eu', {
      when: { join: 'any', rules: [{ key: 'country', op: 'is_any_of', value: ['DE', 'FR'] }] },
      then: { kind: 'message', message: 'Europe' },
    }),
    rule('field', {
      when: { join: 'all', rules: [{ key: `person.${newId()}`, op: 'is', value: 'CTO' }] },
      then: { kind: 'hosts', hosts: [newId()] },
    }),
  ];

  it('takes the first rule that holds, with its tag', () => {
    const decision = decideRoute(rules, { size: '120', country: 'DE' });
    expect(decision.rule?.id).toBe('big');
    expect(decision.qualified).toBe(true);
  });

  it('falls back when none holds, and skips rules over facts it can’t read or routes it can’t take', () => {
    const key = rules[2]?.when.rules[0]?.key ?? '';
    const decision = decideRoute(
      rules,
      { size: '3', country: 'US', [key]: 'CTO' },
      {
        routes: ['message'],
        unreadable: new Set([key]),
      },
    );
    expect(decision.rule).toBeUndefined();
    expect(decision.skipped).toEqual(['field']);
  });

  it('never matches a missing fact by accident', () => {
    expect(decideRoute(rules, {}).rule).toBeUndefined();
  });
});

let made = 0;
/** A workspace (Ada, its owner) with two members whose hours are set: Bea 9 to 12, Cy 9 to 17, UTC weekdays. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `routing-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Admin', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string, from: string, to: string) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${id}, ${name}, ${`${name.toLowerCase()}-${id.slice(-6)}@acme.example`}, 'member', 'system', 'system')`,
      ),
    );
    const scope = rescope(owner, { actor: { type: 'member', id }, role: 'member' });
    const range: [string, string] = [from, to];
    const hours = defaultAvailability('UTC');
    await saveDefaultHours(scope, {
      availability: {
        ...hours,
        weekly: { mon: [range], tue: [range], wed: [range], thu: [range], fri: [range], sat: [], sun: [] },
      },
    });
    return { id, scope };
  };
  const bea = await addMember('Bea', '09:00', '12:00');
  const cy = await addMember('Cy', '09:00', '17:00');
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
  const page = await createBookingPage(
    owner,
    {
      id: newId(),
      title: 'Demo',
      timeZone: 'UTC',
      kind: 'round_robin',
      hosts: { fixed: [], rotations: [rotation.id] },
    },
    NOW,
  );
  const attributes = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const attribute = (slug: string) => attributes.rows.find((row) => row.slug === slug)?.id ?? '';
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  return { ...created, owner, bea, cy, page, attribute, query, people: created.objects.people ?? '' };
}

type World = Awaited<ReturnType<typeof world>>;

const question = (
  q: Partial<FormQuestion> & Pick<FormQuestion, 'id' | 'key' | 'label' | 'answerType'>,
): FormQuestion => ({
  required: false,
  update: 'fill',
  ...q,
});

/** A People form asking the budget, and the team size only when the budget is Large; routed by `rules`. */
async function routedForm(w: World, rules: RoutingRule[], change: (d: FormDocument) => FormDocument = (d) => d) {
  const created = await createForm(w.owner, { id: newId(), name: 'Demo request' });
  const document = change({
    ...created.draft,
    questions: [
      ...created.draft.questions,
      question({ id: 'budget', key: 'budget', label: 'Budget', answerType: 'choice', choices: ['Small', 'Large'] }),
      question({
        id: 'size',
        key: 'size',
        label: 'Team size',
        answerType: 'number',
        showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
      }),
    ],
    routing: { rules },
  });
  const saved = await saveFormDraft(w.owner, { formId: created.id, document, expectedRevision: created.revision });
  return publishForm(w.owner, { formId: created.id, expectedRevision: saved.revision });
}

let sent = 0;
function body(answers: Record<string, unknown>): SubmitBody {
  sent += 1;
  return {
    idempotencyKey: newId(),
    answers: { name: `Lead ${String(sent)}`, email: `lead-${String(sent)}@client${String(sent)}.example`, ...answers },
    hidden: {},
    fillMs: 10_000,
  };
}

async function submit(publicKey: string, input: SubmitBody) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  return submitForm(scope, registry, {
    formId,
    body: input,
    captcha: { kind: 'off' },
    answersKey: 'a-test-answers-key',
    signHandoff: (handoff) => `${handoff.submissionId}.${handoff.bookingPageId}`,
  });
}

function calendar(busy: Readonly<Record<string, BusyAnswer>> = {}): BookingCalendar {
  return {
    busy: ({ memberId }) => Promise.resolve(busy[memberId] ?? { status: 'none' }),
    events: () => Promise.resolve({ meetingId: newId() }),
  };
}
const deps = (cal: BookingCalendar = calendar()) => ({ calendar: cal, now: () => NOW, linkKey: LINK_KEY });

const bookInput = (start: string, email: string): PublicBookInput => ({
  idempotencyKey: newId(),
  start,
  duration: 30,
  name: 'Grace Hopper',
  email,
  timeZone: 'UTC',
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

describe('a form’s routing', () => {
  it('sends a Large budget on to the team page with Bea only, and a Small one to a message, hidden answers dropped', async () => {
    const w = await world();
    const form = await routedForm(w, [
      rule('large', {
        name: 'Large',
        when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
        then: { kind: 'book', bookingPageId: w.page.id, hosts: [w.bea.id], message: '' },
        qualified: true,
      }),
      rule('small', {
        when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Small' }] },
        then: { kind: 'message', message: 'We will write to you.' },
        qualified: false,
      }),
    ]);
    const large = await submit(form.publicKey, body({ budget: 'Large', size: '80' }));
    expect(large.next.kind).toBe('booking');
    const small = await submit(form.publicKey, body({ budget: 'Small', size: '5' }));
    expect(small.next).toMatchObject({ kind: 'message', text: 'We will write to you.' });
    const decisions = await w.query<{ rule_id: string; qualified: boolean; hosts: string[] | null; answers: unknown }>(
      sql`select d.rule_id, d.qualified, d.hosts, s.answers from routing_decisions d
          join form_submissions s on s.id = d.submission_id order by d.decided_at`,
    );
    expect(decisions.map((d) => [d.rule_id, d.qualified])).toEqual([
      ['large', true],
      ['small', false],
    ]);
    expect(decisions[0]?.hosts).toEqual([w.bea.id]);
    // Team size shows only for a Large budget: the Small lead's answer to it isn't kept.
    expect(decisions[0]?.answers).toMatchObject({ size: '80' });
    expect(decisions[1]?.answers).not.toHaveProperty('size');
  });

  it('refuses to publish a Show when that reads a later question, or a rule over a choice that is gone', async () => {
    const w = await world();
    const later = await refusalOf(
      routedForm(w, [], (d) => ({
        ...d,
        questions: d.questions.map((q) =>
          q.key === 'budget' ? { ...q, showWhen: { join: 'all', rules: [{ key: 'size', op: 'is_answered' }] } } : q,
        ),
      })),
    );
    expect(later.message).toContain('which comes after it');
    const gone = await refusalOf(
      routedForm(w, [
        rule('mid', {
          when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Medium' }] },
          then: { kind: 'message', message: '' },
        }),
      ]),
    );
    expect(gone.message).toContain('no longer one of its choices');
  });

  it('refuses hosts outside the page’s rotation', async () => {
    const w = await world();
    const refusal = await refusalOf(
      routedForm(w, [
        rule('ada', {
          when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
          then: { kind: 'book', bookingPageId: w.page.id, hosts: [w.memberId], message: '' },
        }),
      ]),
    );
    expect(refusal.message).toContain('isn’t in the page’s rotation');
  });
});

describe('a team page’s routing', () => {
  it('a hand off’s hosts narrow the slots and take the booking; the decision gets it', async () => {
    const w = await world();
    const form = await routedForm(w, [
      rule('large', {
        when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
        then: { kind: 'book', bookingPageId: w.page.id, hosts: [w.cy.id], message: '' },
      }),
    ]);
    const input = body({ budget: 'Large' });
    await submit(form.publicKey, input);
    const [decision] = await w.query<{ submission_id: string }>(sql`select submission_id::text from routing_decisions`);
    const link = { submissionId: decision?.submission_id ?? '' };
    const entry = await enterBookingPage({ db }, w.page.publicKey);
    const query = { from: at('00:00'), to: '2026-11-03T00:00:00.000Z', duration: 30 as const, tz: 'UTC' };
    const everyone = await readPublicSlots(entry, deps(), query);
    const routed = await readPublicSlots(entry, deps(), query, link);
    // Cy works to 17:00, Bea to 12:00: the routed slots are Cy's, which run past noon.
    expect(routed.slots.at(-1)?.start).toBe(everyone.slots.at(-1)?.start);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('10:00'), String(input.answers.email)), [], link);
    const [row] = await w.query<{ host: string; decided: string | null }>(
      sql`select b.host_member_id::text as host, d.booking_id::text as decided
          from bookings b left join routing_decisions d on d.booking_id = b.id where b.id = ${booked.bookingId}::uuid`,
    );
    expect(row).toEqual({ host: w.cy.id, decided: booked.bookingId });
  });

  it('a rule over a person’s field picks Cy; when Cy is busy the rotation picks, never refusing', async () => {
    const w = await world();
    const jobTitle = `person.${w.attribute('people.job_title')}`;
    await updateBookingPage(w.owner, {
      pageId: w.page.id,
      settings: {},
      routing: {
        rules: [
          rule('cto', {
            name: 'Technical buyers',
            when: { join: 'all', rules: [{ key: jobTitle, op: 'is', value: 'cto' }] },
            then: { kind: 'hosts', hosts: [w.cy.id] },
            qualified: true,
          }),
        ],
      },
    });
    await createRecord(w.owner, {
      objectId: w.people,
      values: {
        [w.attribute('people.name')]: { firstName: 'Grace' },
        [w.attribute('people.email_addresses')]: ['grace@navy.example'],
        [w.attribute('people.job_title')]: 'CTO',
      },
    });
    const entry = await enterBookingPage({ db }, w.page.publicKey);
    const first = await bookPublicSlot(entry, deps(), bookInput(at('09:00'), 'grace@navy.example'));
    // Cy is busy at 10:00 on their calendar: the rule's host isn't free, so Bea takes it.
    const busy = calendar({
      [w.cy.id]: { status: 'read', busy: [{ start: at('10:00'), end: at('10:30') }] },
    });
    const second = await bookPublicSlot(entry, deps(busy), bookInput(at('10:00'), 'grace@navy.example'));
    const rows = await w.query<{ id: string; host: string; rule_id: string; hosts: string[] | null }>(
      sql`select b.id::text, b.host_member_id::text as host, d.rule_id, d.hosts from routing_decisions d
          join bookings b on b.id = d.booking_id where d.surface_kind = 'booking_page'`,
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(first.bookingId)).toMatchObject({ host: w.cy.id, rule_id: 'cto', hosts: [w.cy.id] });
    expect(byId.get(second.bookingId)).toMatchObject({ host: w.bea.id, rule_id: 'cto', hosts: null });

    // The report counts both, and a no show marked by the host (never by someone else).
    const after = new Date('2026-11-03T00:00:00.000Z');
    const outsider = await refusalOf(markNoShow(w.bea.scope, { bookingId: first.bookingId, noShow: true }, after));
    expect(outsider.code).toBe('NOT_FOUND');
    await markNoShow(w.cy.scope, { bookingId: first.bookingId, noShow: true }, after);
    const report = await routingReport(w.owner, { surface: { kind: 'booking_page', pageId: w.page.id }, days: 90 });
    expect(report.rows).toEqual([{ ruleId: 'cto', matched: 2, booked: 2, noShow: 1, qualified: 2, notQualified: 0 }]);
    const audited = await w.query<{ action: string }>(sql`select action from audit_events order by at`);
    expect(audited.map((row) => row.action)).toEqual(['routing.changed', 'booking.no_show']);
  });

  it('refuses rules on a page that isn’t a team page, and a member reading the report', async () => {
    const w = await world();
    const personal = await createBookingPage(w.owner, { id: newId(), title: 'Mine', timeZone: 'UTC' }, NOW);
    const refused = await refusalOf(
      updateBookingPage(w.owner, { pageId: personal.id, settings: {}, routing: { rules: [] } }),
    );
    expect(refused.message).toBe('Only a team page has routing rules.');
    const report = await refusalOf(
      routingReport(w.bea.scope, { surface: { kind: 'booking_page', pageId: w.page.id }, days: 30 }),
    );
    expect(report.code).toBe('FORBIDDEN');
  });

  it('refuses a no show from a principal without booking.manage', async () => {
    const w = await world();
    // Every role holds booking.manage, so the principal without it is an API key whose scopes leave it out.
    const key = rescope(w.owner, { actor: { type: 'api_key', id: newId() }, scopes: ['data.read'] });
    const refused = await refusalOf(markNoShow(key, { bookingId: newId(), noShow: true }));
    expect(refused.code).toBe('FORBIDDEN');
  });

  it('answers a form’s report as absent to a forms.manage member who can’t see the form’s object', async () => {
    const w = await world();
    const form = await routedForm(w, []);
    const blind = rescope(w.owner, {
      actor: { type: 'member', id: w.bea.id },
      role: 'admin',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'admin' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    const refused = await refusalOf(routingReport(blind, { surface: { kind: 'form', formId: form.id }, days: 30 }));
    expect(refused.code).toBe('NOT_FOUND');
  });
});

describe('routing leftovers', () => {
  const sizeRules: RoutingRule[] = [
    rule('large', {
      when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
      then: { kind: 'message', message: 'Big' },
    }),
    rule('small', {
      when: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Small' }] },
      then: { kind: 'message', message: 'Small' },
    }),
  ];

  it('decides a submission once: a doubled submit stores one decision, and routing it again keeps the first', async () => {
    const w = await world();
    const form = await routedForm(w, sizeRules);
    const input = body({ budget: 'Large' });
    const [first, second] = await Promise.all([submit(form.publicKey, input), submit(form.publicKey, input)]);
    expect(first.next).toMatchObject({ kind: 'message', text: 'Big' });
    expect(second.next).toMatchObject({ kind: 'message', text: 'Big' });
    const [stored] = await w.query<{ submission_id: string }>(sql`select submission_id::text from routing_decisions`);
    const submissionId = stored?.submission_id ?? '';
    // Routed again with other answers (a retried step, a second path): the first decision stands, and is answered.
    const again = await db.withWorkspace(w.workspaceId, (tx) =>
      routeSubmission(tx, {
        workspaceId: w.workspaceId,
        formId: form.id,
        submissionId,
        document: { routing: { rules: sizeRules } },
        answers: { budget: 'Small' },
      }),
    );
    expect(again).toEqual({ kind: 'message', message: 'Big' });
    expect(await w.query(sql`select rule_id from routing_decisions`)).toEqual([{ rule_id: 'large' }]);
    // The database holds to it too: a second row for the submission is refused.
    const doubled = await db
      .withWorkspace(w.workspaceId, (tx) =>
        tx.execute(sql`insert into routing_decisions (workspace_id, surface_kind, surface_id, submission_id)
          values (${w.workspaceId}::uuid, 'form', ${form.id}::uuid, ${submissionId}::uuid)`),
      )
      .then(
        () => undefined,
        (error: unknown) => postgresError(error),
      );
    expect(doubled).toMatchObject({ code: '23505', constraint: 'routing_decisions_one_per_submission' });
  });

  it('matches is any of: Large or Huge go on, Small falls back', async () => {
    const w = await world();
    const form = await routedForm(
      w,
      [
        rule('big', {
          when: { join: 'all', rules: [{ key: 'budget', op: 'is_any_of', value: ['Large', 'Huge'] }] },
          then: { kind: 'message', message: 'Big' },
        }),
      ],
      (d) => ({
        ...d,
        questions: d.questions.map((q) => (q.key === 'budget' ? { ...q, choices: ['Small', 'Large', 'Huge'] } : q)),
      }),
    );
    expect((await submit(form.publicKey, body({ budget: 'Huge' }))).next).toMatchObject({ text: 'Big' });
    await submit(form.publicKey, body({ budget: 'Small' }));
    const rows = await w.query<{ rule_id: string | null }>(
      sql`select d.rule_id from routing_decisions d join form_submissions s on s.id = d.submission_id
          order by s.answers ->> 'budget'`,
    );
    expect(rows).toEqual([{ rule_id: 'big' }, { rule_id: null }]);
  });

  it('reads a company only through the person’s Company field, and skips the rule once that field is archived', async () => {
    const w = await world();
    const companies = w.objects.companies ?? '';
    const range = w.attribute('companies.employee_range');
    const options = await w.query<{ id: string; label: string }>(
      sql`select id::text, label from attribute_options where attribute_id = ${range}::uuid`,
    );
    const optionOf = (label: string) => options.find((option) => option.label === label)?.id ?? '';
    // A second link between People and Companies that isn't where anyone works.
    const advisor = await createRelationship(w.owner, {
      id: newId(),
      cardinality: 'many_to_one',
      from: { objectId: w.people, title: 'Advisor of' },
      to: { objectId: companies, title: 'Advisors' },
    });
    const company = (name: string, label: string) =>
      createRecord(w.owner, {
        objectId: companies,
        values: { [w.attribute('companies.name')]: name, [range]: optionOf(label) },
      });
    const startup = await company('Tiny', '1 to 10');
    const employer = await company('Mid', '51 to 200');
    const grace = await createRecord(w.owner, {
      objectId: w.people,
      values: {
        [w.attribute('people.name')]: { firstName: 'Grace' },
        [w.attribute('people.email_addresses')]: ['grace@navy.example'],
        [advisor.from.id]: { objectId: companies, recordId: startup.recordId },
      },
    });
    // The employer is set later, so the advisor link is the older one.
    await setValues(w.owner, {
      recordId: grace.recordId,
      values: { [w.attribute('people.company')]: { value: { objectId: companies, recordId: employer.recordId } } },
    });
    await updateBookingPage(w.owner, {
      pageId: w.page.id,
      settings: {},
      routing: {
        rules: [
          rule('mid', {
            when: {
              join: 'all',
              rules: [
                { key: `company.${range}`, op: 'is_any_of', value: [optionOf('51 to 200'), optionOf('201 to 500')] },
              ],
            },
            then: { kind: 'hosts', hosts: [w.cy.id] },
          }),
        ],
      },
    });
    const entry = await enterBookingPage({ db }, w.page.publicKey);
    const decided = async (start: string) => {
      const booked = await bookPublicSlot(entry, deps(), bookInput(at(start), 'grace@navy.example'));
      const [row] = await w.query<{ host: string; rule_id: string | null; skipped: string[] }>(
        sql`select b.host_member_id::text as host, d.rule_id, d.skipped from bookings b
            join routing_decisions d on d.booking_id = b.id where b.id = ${booked.bookingId}::uuid`,
      );
      return row;
    };
    expect(await decided('09:00')).toEqual({ host: w.cy.id, rule_id: 'mid', skipped: [] });
    // With People's Company field archived the company can't be read: the rule is skipped, never matched by accident.
    await archiveAttribute(w.owner, w.attribute('people.company'));
    expect(await decided('10:00')).toMatchObject({ rule_id: null, skipped: ['mid'] });
  });

  it('routes by the visit’s UTM tags: a form’s rule, then the team page’s through the hand off', async () => {
    const w = await world();
    await updateBookingPage(w.owner, {
      pageId: w.page.id,
      settings: {},
      routing: {
        rules: [
          rule('spring', {
            when: { join: 'all', rules: [{ key: 'hidden.utm_campaign', op: 'is', value: 'spring' }] },
            then: { kind: 'hosts', hosts: [w.cy.id] },
          }),
        ],
      },
    });
    const form = await routedForm(w, [
      rule('ads', {
        when: { join: 'all', rules: [{ key: 'hidden.utm_source', op: 'is', value: 'google' }] },
        then: { kind: 'book', bookingPageId: w.page.id, message: '' },
      }),
    ]);
    // The source tag in the submission's context (as the hosted page sends it), the campaign in its older hidden fields.
    const fromAds: SubmitBody = {
      ...body({ budget: 'Small' }),
      context: { mode: 'page', version: '1', utm_source: 'Google' },
      hidden: { utm_campaign: 'Spring' },
    };
    expect((await submit(form.publicKey, fromAds)).next.kind).toBe('booking');
    await submit(form.publicKey, body({ budget: 'Small' }));
    const decisions = await w.query<{ submission_id: string; rule_id: string | null }>(
      sql`select submission_id::text, rule_id from routing_decisions order by decided_at`,
    );
    expect(decisions.map((row) => row.rule_id)).toEqual(['ads', null]);
    const entry = await enterBookingPage({ db }, w.page.publicKey);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('09:00'), String(fromAds.answers.email)), [], {
      submissionId: decisions[0]?.submission_id ?? '',
    });
    const rows = await w.query<{ surface_kind: string; rule_id: string | null; host: string }>(
      sql`select d.surface_kind, d.rule_id, b.host_member_id::text as host from routing_decisions d
          join bookings b on b.id = d.booking_id where b.id = ${booked.bookingId}::uuid order by d.surface_kind`,
    );
    expect(rows).toEqual([
      { surface_kind: 'booking_page', rule_id: 'spring', host: w.cy.id },
      { surface_kind: 'form', rule_id: 'ads', host: w.cy.id },
    ]);
    // Another team page with the same rule, given the same hand off: the form didn't send the visitor there, so its
    // hidden fields never reach it.
    const other = await createBookingPage(
      w.owner,
      {
        id: newId(),
        title: 'Other',
        timeZone: 'UTC',
        kind: 'round_robin',
        hosts: { fixed: [], rotations: [...(w.page.hosts?.rotations ?? [])] },
      },
      NOW,
    );
    await updateBookingPage(w.owner, {
      pageId: other.id,
      settings: {},
      routing: {
        rules: [
          rule('spring', {
            when: { join: 'all', rules: [{ key: 'hidden.utm_campaign', op: 'is', value: 'spring' }] },
            then: { kind: 'hosts', hosts: [w.cy.id] },
          }),
        ],
      },
    });
    const elsewhere = await bookPublicSlot(
      await enterBookingPage({ db }, other.publicKey),
      deps(),
      bookInput(at('11:00'), String(fromAds.answers.email)),
      [],
      { submissionId: decisions[0]?.submission_id ?? '' },
    );
    expect(
      await w.query(sql`select rule_id from routing_decisions where booking_id = ${elsewhere.bookingId}::uuid`),
    ).toEqual([{ rule_id: null }]);
  });

  it('refuses a team page rule over a field its writer can’t see, but keeps one another admin wrote', async () => {
    const w = await world();
    const jobTitle = `person.${w.attribute('people.job_title')}`;
    const cto = rule('cto', {
      when: { join: 'all', rules: [{ key: jobTitle, op: 'is', value: 'cto' }] },
      then: { kind: 'hosts', hosts: [w.cy.id] },
    });
    await updateBookingPage(w.owner, { pageId: w.page.id, settings: {}, routing: { rules: [cto] } });
    // An admin whose role can't see People at all.
    const blind = rescope(w.owner, {
      actor: { type: 'member', id: w.bea.id },
      role: 'admin',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'admin' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    const ads = rule('ads', {
      when: { join: 'all', rules: [{ key: 'hidden.utm_source', op: 'is', value: 'google' }] },
      then: { kind: 'hosts', hosts: [w.bea.id] },
    });
    // The owner's rule kept as it was: the blind admin can still change the rest.
    await updateBookingPage(blind, { pageId: w.page.id, settings: {}, routing: { rules: [cto, ads] } });
    const changed = await refusalOf(
      updateBookingPage(blind, {
        pageId: w.page.id,
        settings: {},
        routing: {
          rules: [{ ...cto, when: { join: 'all', rules: [{ key: jobTitle, op: 'is', value: 'ceo' }] } }, ads],
        },
      }),
    );
    expect(changed).toMatchObject({
      code: 'CONFIG_INVALID',
      message: 'Rule 1 reads a field you can’t use. Pick another field.',
    });
    // A number comparison on a hidden field is refused on a page as on a form.
    const counted = await refusalOf(
      updateBookingPage(w.owner, {
        pageId: w.page.id,
        settings: {},
        routing: {
          rules: [
            rule('many', {
              when: { join: 'all', rules: [{ key: 'hidden.utm_term', op: 'more_than', value: '3' }] },
              then: { kind: 'hosts', hosts: [w.cy.id] },
            }),
          ],
        },
      }),
    );
    expect(counted.message).toBe('Rule 1 compares a hidden field as a number, but it holds text.');
  });

  it('reads record facts only in the page’s own workspace: another’s person or field is never found', async () => {
    const a = await world();
    const b = await world();
    // In workspace B, Grace is a CTO.
    await createRecord(b.owner, {
      objectId: b.people,
      values: {
        [b.attribute('people.name')]: { firstName: 'Grace' },
        [b.attribute('people.email_addresses')]: ['grace@navy.example'],
        [b.attribute('people.job_title')]: 'CTO',
      },
    });
    const cto = (id: string, attributeId: string) =>
      rule(id, {
        when: { join: 'all', rules: [{ key: `person.${attributeId}`, op: 'is', value: 'cto' }] },
        then: { kind: 'hosts', hosts: [a.cy.id] },
      });
    const rules = [cto('foreign', b.attribute('people.job_title')), cto('own', a.attribute('people.job_title'))];
    // Saving a rule over B's field is refused in A: the field can't be found there.
    const refused = await refusalOf(
      updateBookingPage(a.owner, { pageId: a.page.id, settings: {}, routing: { rules } }),
    );
    expect(refused.message).toBe('Rule 1 reads a field you can’t use. Pick another field.');
    // One stored before that check is skipped at the booking, never read.
    await a.query(
      sql`update booking_pages set routing = ${JSON.stringify({ rules })}::jsonb where id = ${a.page.id}::uuid`,
    );
    const entry = await enterBookingPage({ db }, a.page.publicKey);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('09:00'), 'grace@navy.example'));
    const [row] = await a.query<{ rule_id: string | null; skipped: string[] }>(
      sql`select rule_id, skipped from routing_decisions where booking_id = ${booked.bookingId}::uuid`,
    );
    // B's field can't be read from A (skipped), and A holds no Grace: nothing matched.
    expect(row).toEqual({ rule_id: null, skipped: ['foreign'] });
  });
});

describe('hidden means absent: a team page’s rule over a field its reader can’t see', () => {
  /** Bea as an admin whose role sees People, but not the field `attributeId`. */
  const blindTo = (w: World, attributeId: string) =>
    rescope(w.owner, {
      actor: { type: 'member', id: w.bea.id },
      role: 'admin',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'admin' },
            target: { type: 'attribute', objectId: w.people, attributeId },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });

  /** A rule over one of the visit's hidden fields, which every reader sees. */
  const plain = (id: string, value: string, host: string) =>
    rule(id, {
      when: { join: 'all', rules: [{ key: 'hidden.utm_source', op: 'is', value }] },
      then: { kind: 'hosts', hosts: [host] },
    });

  /** The page's rules by id, as its owner (who sees every field) reads them. */
  const storedIds = async (w: World) =>
    ((await getBookingPage(w.owner, { pageId: w.page.id })).routing?.rules ?? []).map((each) => each.id);

  it('leaves it out of the page, the list, a save’s answer and the report; saves keep it; a booking still routes by it', async () => {
    const w = await world();
    const jobTitle = w.attribute('people.job_title');
    const secret = rule('secret-rule', {
      name: 'Secret buyers',
      when: { join: 'all', rules: [{ key: `person.${jobTitle}`, op: 'is', value: 'zebra cto' }] },
      then: { kind: 'hosts', hosts: [w.cy.id] },
      qualified: true,
    });
    const lead = plain('lead', 'google', w.bea.id);
    const tail = plain('tail', 'bing', w.cy.id);
    await updateBookingPage(w.owner, { pageId: w.page.id, settings: {}, routing: { rules: [lead, secret, tail] } });
    const blind = blindTo(w, jobTitle);
    /** Nothing of the hidden rule in an answer: not its field's id, nor the rule's id, name or value. */
    const holdsNone = (answer: unknown) => {
      const text = JSON.stringify(answer);
      for (const kept of [jobTitle, 'secret-rule', 'Secret buyers', 'zebra']) expect(text).not.toContain(kept);
    };
    const idsOf = (page: { readonly routing?: { readonly rules: readonly RoutingRule[] } } | undefined) =>
      page?.routing?.rules.map((each) => each.id);

    expect(await storedIds(w)).toEqual(['lead', 'secret-rule', 'tail']);
    const seen = await getBookingPage(blind, { pageId: w.page.id });
    expect(idsOf(seen)).toEqual(['lead', 'tail']);
    holdsNone(seen);
    const listed = await listBookingPages(blind, NOW);
    expect(idsOf(listed.find((page) => page.id === w.page.id))).toEqual(['lead', 'tail']);
    holdsNone(listed);

    // A save of settings alone answers the same and keeps every rule.
    holdsNone(await updateBookingPage(blind, { pageId: w.page.id, settings: { description: 'Our team' } }));
    expect(await storedIds(w)).toEqual(['lead', 'secret-rule', 'tail']);

    // Reordered, with one added: the hidden rule stays just after the rule it followed.
    const extra = plain('extra', 'duckduckgo', w.bea.id);
    const reordered = await updateBookingPage(blind, {
      pageId: w.page.id,
      settings: {},
      routing: { rules: [tail, lead, extra] },
    });
    expect(idsOf(reordered)).toEqual(['tail', 'lead', 'extra']);
    holdsNone(reordered);
    expect(await storedIds(w)).toEqual(['tail', 'lead', 'secret-rule', 'extra']);

    // Every rule they see removed: the one they can't see stays, unchanged.
    const emptied = await updateBookingPage(blind, { pageId: w.page.id, settings: {}, routing: { rules: [] } });
    expect(emptied.routing).toEqual({ rules: [] });
    expect((await getBookingPage(w.owner, { pageId: w.page.id })).routing?.rules).toEqual([secret]);
    // Their saves changed only their own rules: the audit rows name what each save changed.
    const audited = await w.query<{ after: { changed: string[] } }>(
      sql`select after from audit_events where action = 'routing.changed' order by at`,
    );
    expect(audited.map((row) => row.after.changed)).toEqual([
      ['lead', 'secret-rule', 'tail'],
      ['extra'],
      ['tail', 'lead', 'extra'],
    ]);

    // Routing still reads it on the server: a guest whose job title matches goes to Cy.
    await createRecord(w.owner, {
      objectId: w.people,
      values: {
        [w.attribute('people.name')]: { firstName: 'Grace' },
        [w.attribute('people.email_addresses')]: ['grace@navy.example'],
        [jobTitle]: 'Zebra CTO',
      },
    });
    const entry = await enterBookingPage({ db }, w.page.publicKey);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('09:00'), 'grace@navy.example'));
    const [decided] = await w.query<{ host: string; rule_id: string | null }>(
      sql`select b.host_member_id::text as host, d.rule_id from bookings b
          join routing_decisions d on d.booking_id = b.id where b.id = ${booked.bookingId}::uuid`,
    );
    expect(decided).toEqual({ host: w.cy.id, rule_id: 'secret-rule' });
    // The guest's answer names who they meet, never the rule or the field.
    holdsNone(booked.booking);

    // The report: the owner reads the rule's row; the blind admin gets no row for it.
    const surface = { kind: 'booking_page' as const, pageId: w.page.id };
    const report = await routingReport(w.owner, { surface, days: 30 });
    expect(report.rows.map((row) => row.ruleId)).toEqual(['secret-rule']);
    const blindReport = await routingReport(blind, { surface, days: 30 });
    expect(blindReport.rows).toEqual([]);
    holdsNone(blindReport);
  });

  it('refuses a save past 20 rules, counting those its writer can’t see, and keeps the rules as they were', async () => {
    const w = await world();
    const jobTitle = w.attribute('people.job_title');
    const secret = rule('secret-rule', {
      when: { join: 'all', rules: [{ key: `person.${jobTitle}`, op: 'is_answered' }] },
      then: { kind: 'hosts', hosts: [w.cy.id] },
    });
    const nineteen = Array.from({ length: 19 }, (_, index) =>
      plain(`r${String(index)}`, `s${String(index)}`, w.bea.id),
    );
    await updateBookingPage(w.owner, { pageId: w.page.id, settings: {}, routing: { rules: [secret, ...nineteen] } });
    const blind = blindTo(w, jobTitle);
    expect((await getBookingPage(blind, { pageId: w.page.id })).routing?.rules).toHaveLength(19);
    const refused = await refusalOf(
      updateBookingPage(blind, {
        pageId: w.page.id,
        settings: {},
        routing: { rules: [...nineteen, plain('one-more', 'yahoo', w.cy.id)] },
      }),
    );
    expect(refused).toEqual({
      code: 'CONFIG_INVALID',
      message: 'This page holds the most rules it can, 20. Remove one to add another.',
      field: 'routing',
    });
    expect(await storedIds(w)).toEqual(['secret-rule', ...nineteen.map((each) => each.id)]);
    // Without one of their own, the new rule fits.
    const swapped = [...nineteen.slice(1), plain('one-more', 'yahoo', w.cy.id)];
    await updateBookingPage(blind, { pageId: w.page.id, settings: {}, routing: { rules: swapped } });
    expect(await storedIds(w)).toEqual(['secret-rule', ...swapped.map((each) => each.id)]);
  });

  it('shows every rule to a reader nothing restricts, even one over a field this workspace doesn’t hold', async () => {
    const w = await world();
    const other = await world();
    const foreign = rule('foreign', {
      when: { join: 'all', rules: [{ key: `person.${other.attribute('people.job_title')}`, op: 'is', value: 'cto' }] },
      then: { kind: 'hosts', hosts: [w.cy.id] },
    });
    // Stored past the save's check, as before it existed: the owner can still see it, and so remove it.
    await w.query(
      sql`update booking_pages set routing = ${JSON.stringify({ rules: [foreign] })}::jsonb where id = ${w.page.id}::uuid`,
    );
    expect(await storedIds(w)).toEqual(['foreign']);
    // A reader with any field hidden can't place it, so it stays out of their answers (fail closed).
    const blind = blindTo(w, w.attribute('people.job_title'));
    expect((await getBookingPage(blind, { pageId: w.page.id })).routing).toEqual({ rules: [] });
    await updateBookingPage(w.owner, { pageId: w.page.id, settings: {}, routing: { rules: [] } });
    expect(await storedIds(w)).toEqual([]);
  });
});

describe('the record fact key migration (a malformed key stored before the contract refused it)', () => {
  /** The migration's statements as written, run again as the owner: each touches only a key the contract refuses. */
  const migrate = async () => {
    const folder = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));
    const file = readdirSync(folder).find((name) => name.endsWith('_record_fact_keys.sql'));
    if (file === undefined) throw new Error('The record fact key migration is missing.');
    for (const statement of readFileSync(`${folder}${file}`, 'utf8').split('--> statement-breakpoint')) {
      await testQuery(ownerUrl, statement);
    }
  };

  it('rewrites it to a field that is never found, so the form and the page load again and a booking skips the rule', async () => {
    const w = await world();
    const dashes = `person.${'-'.repeat(36)}`;
    const nil = 'person.00000000-0000-0000-0000-000000000000';
    // Read as empty, the malformed key would match "is empty" by accident; as an unreadable field it is skipped.
    const bad = rule('bad', {
      when: { join: 'all', rules: [{ key: dashes, op: 'is_empty' }] },
      then: { kind: 'hosts', hosts: [w.bea.id] },
    });
    const direct = rule('direct', {
      when: { join: 'all', rules: [{ key: 'hidden.utm_source', op: 'is_empty' }] },
      then: { kind: 'hosts', hosts: [w.cy.id] },
    });
    await w.query(
      sql`update booking_pages set routing = ${JSON.stringify({ rules: [bad, direct] })}::jsonb where id = ${w.page.id}::uuid`,
    );
    const form = await createForm(w.owner, { id: newId(), name: 'Old draft' });
    const formRule = { ...bad, then: { kind: 'message', message: 'Hello' } };
    await w.query(
      sql`update form_versions set document = jsonb_set(document, '{routing}', ${JSON.stringify({ rules: [formRule] })}::jsonb)
          where form_id = ${form.id}::uuid`,
    );
    // Before: the page's rules no longer parse, so none read; the form's draft doesn't parse at all.
    expect((await getBookingPage(w.owner, { pageId: w.page.id })).routing).toEqual({ rules: [] });
    await expect(getForm(w.owner, { formId: form.id })).rejects.toThrow();

    await migrate();
    // A second run finds nothing left to change.
    await migrate();
    const keys = (rules: readonly RoutingRule[] | undefined) => rules?.map((each) => each.when.rules[0]?.key);
    expect(keys((await getBookingPage(w.owner, { pageId: w.page.id })).routing?.rules)).toEqual([
      nil,
      'hidden.utm_source',
    ]);
    expect(keys((await getForm(w.owner, { formId: form.id })).draft.routing.rules)).toEqual([nil]);
    const entry = await enterBookingPage({ db }, w.page.publicKey);
    const booked = await bookPublicSlot(entry, deps(), bookInput(at('09:00'), 'nobody@else.example'));
    const [row] = await w.query<{ host: string; rule_id: string | null; skipped: string[] }>(
      sql`select b.host_member_id::text as host, d.rule_id, d.skipped from bookings b
          join routing_decisions d on d.booking_id = b.id where b.id = ${booked.bookingId}::uuid`,
    );
    expect(row).toEqual({ host: w.cy.id, rule_id: 'direct', skipped: ['bad'] });
  });
});
