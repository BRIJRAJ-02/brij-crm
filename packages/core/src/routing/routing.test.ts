// Lead routing end to end in core (spec 0043), against the real Postgres:
// deciding a route, Show when dropping hidden answers, a form's rules sending
// visitors on with a decision row, a team page's rules narrowing hosts by a
// record field, a hand off's hosts narrowing the slots, the fallback when the
// routed hosts are busy, the report's counts, and the no show mark's door.
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
import { enterBookingPage, enterPublicForm } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import { markNoShow } from '../booking/change.ts';
import type { BookingCalendar, BusyAnswer } from '../booking/calendar.ts';
import { createBookingPage, updateBookingPage } from '../booking/pages.ts';
import { bookPublicSlot, readPublicSlots } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createRecord } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createForm, publishForm, saveFormDraft } from '../forms/forms.ts';
import { submitForm } from '../forms/public.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { createRotation } from '../rotation/rotations.ts';
import { rescope, testScope } from '../testing.ts';
import { decideRoute } from './decide.ts';
import { routingReport } from './report.ts';

const { appUrl } = inject('testDatabase');
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
