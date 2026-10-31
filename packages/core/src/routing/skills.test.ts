// Routing's shared layer (spec 0037, lane L7), against the real Postgres: skills and who holds them (AC-1382), a host
// route requiring skills narrowing to their holders and falling back to the whole rotation (AC-1356), SKILL_IN_USE and
// SKILL_LIMIT, a removed member's skills going with them (AC-1440), Won means (AC-1385), a deal's fields and Known read
// only by a team page's rules (AC-1377, AC-1393), and Test storing nothing but its audit row (AC-1392).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  defaultAvailability,
  KNOWN_FACT,
  SKILLS_MAX,
  type FormDocument,
  type PublicBookInput,
  type RoutingRule,
  type SubmitBody,
} from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage, enterPublicForm } from '../access/door.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar, BusyAnswer } from '../booking/calendar.ts';
import { createBookingPage, updateBookingPage } from '../booking/pages.ts';
import { bookPublicSlot } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createForm, publishForm, saveFormDraft } from '../forms/forms.ts';
import { submitForm } from '../forms/public.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { removeMember } from '../members/members.ts';
import { createRotation } from '../rotation/rotations.ts';
import { rescope, testScope } from '../testing.ts';
import { recordFacts } from './facts.ts';
import { getRoutingSettings, setRoutingSettings } from './settings.ts';
import { createSkill, deleteSkill, listSkills, setMemberSkills, updateSkill } from './skills.ts';
import { routingTest } from './test.ts';

const { appUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 11);
const registry = jobKinds({ environment: 'local' });
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-routing-skills-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC: the booking clock. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const at = (time: string) => `2026-11-02T${time}:00.000Z`;

let made = 0;
/** A workspace (Ada, its owner) with Bea and Cy (9 to 17 UTC weekdays) in one rotation behind the Demo team page. */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `routing-skills-${String(made)}-${String(Date.now())}`,
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
  const optionOf = async (attributeSlug: string, label: string) => {
    const [row] = await query<{ id: string }>(
      sql`select id::text from attribute_options where attribute_id = ${attribute(attributeSlug)}::uuid and label = ${label}`,
    );
    return row?.id ?? '';
  };
  const skill = async (name: string, group: 'language' | 'region' = 'language') => {
    const id = newId();
    await createSkill(owner, { id, group, name });
    return id;
  };
  const objects = {
    people: created.objects.people ?? '',
    companies: created.objects.companies ?? '',
    deals: created.objects.deals ?? '',
  };
  return { ...created, owner, bea, cy, rotation, page, attribute, query, optionOf, skill, objects };
}

type World = Awaited<ReturnType<typeof world>>;

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
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

/** The page's rules, replaced. */
const setRules = (w: World, rules: RoutingRule[]) =>
  updateBookingPage(w.owner, { pageId: w.page.id, settings: {}, routing: { rules } }, NOW);

/** "Speaks <skills>": a team page rule taking everyone (an answered email) to the members holding `skillIds`. */
const needsSkills = (id: string, skillIds: string[]): RoutingRule => ({
  id,
  when: { join: 'all', rules: [{ key: 'email', op: 'is_answered' }] },
  then: { kind: 'hosts', hosts: { requireSkillIds: skillIds, ifNoneFree: 'whole_rotation' } },
});

/** Books the page at `time` and answers its host and the page's decision. */
async function booked(w: World, time: string, email: string, cal?: BookingCalendar) {
  const entry = await enterBookingPage({ db }, w.page.publicKey);
  const made = await bookPublicSlot(entry, deps(cal), bookInput(at(time), email));
  const [row] = await w.query<{ host: string; rule_id: string | null; hosts: string[] | null }>(
    sql`select b.host_member_id::text as host, d.rule_id, d.hosts::text[] as hosts from bookings b
        join routing_decisions d on d.booking_id = b.id and d.surface_kind = 'booking_page'
        where b.id = ${made.bookingId}::uuid`,
  );
  return row;
}

describe('skills (AC-1382)', () => {
  it('makes, renames and lists skills by group; a second name in a group is refused, ignoring case', async () => {
    const w = await world();
    const spanish = await w.skill('Spanish');
    await w.skill('EMEA', 'region');
    await w.skill('German');
    const taken = await refusalOf(createSkill(w.owner, { id: newId(), group: 'language', name: 'spanish' }));
    expect(taken).toMatchObject({ code: 'CONFIG_INVALID', field: 'name' });
    // The same name in another group is another skill.
    await createSkill(w.owner, { id: newId(), group: 'other', name: 'Spanish' });
    await updateSkill(w.owner, { id: spanish, name: 'Español' });
    const listed = await listSkills(w.bea.scope);
    expect(listed.skills.map((skill) => `${skill.group}:${skill.name}`)).toEqual([
      'language:Español',
      'language:German',
      'region:EMEA',
      'other:Spanish',
    ]);
    expect(listed.wonMeansSet).toBe(false);
    // A retried create (the same id) answers the list and makes nothing more.
    await createSkill(w.owner, { id: spanish, group: 'language', name: 'Again' });
    expect((await listSkills(w.owner)).skills).toHaveLength(4);
    const audited = await w.query<{ count: number }>(
      sql`select count(*)::int as count from audit_events where action = 'routing.skills_changed'`,
    );
    expect(audited[0]?.count).toBe(5);
  });

  it('refuses the 101st skill with SKILL_LIMIT', async () => {
    const w = await world();
    for (let index = 0; index < SKILLS_MAX; index += 1) {
      await createSkill(w.owner, { id: newId(), group: 'other', name: `Skill ${String(index)}` });
    }
    const refusal = await refusalOf(createSkill(w.owner, { id: newId(), group: 'other', name: 'One more' }));
    expect(refusal).toEqual({ code: 'SKILL_LIMIT', message: 'A workspace can have at most 100 skills.' });
  });

  it('is changed only by holders of routing.manage, and listed for any member', async () => {
    const w = await world();
    const spanish = await w.skill('Spanish');
    for (const call of [
      createSkill(w.bea.scope, { id: newId(), group: 'language', name: 'French' }),
      updateSkill(w.bea.scope, { id: spanish, name: 'French' }),
      deleteSkill(w.bea.scope, { id: spanish }),
      setMemberSkills(w.bea.scope, { memberId: w.bea.id, skillIds: [spanish] }),
      getRoutingSettings(w.bea.scope),
      setRoutingSettings(w.bea.scope, { wonStage: null }),
      routingTest(w.bea.scope, { surface: { kind: 'booking_page', pageId: w.page.id }, answers: {} }),
    ]) {
      expect((await refusalOf(call)).code).toBe('FORBIDDEN');
    }
    expect((await listSkills(w.bea.scope)).skills).toHaveLength(1);
  });

  it('sets and replaces a member’s skills; a removed member holds none (AC-1440)', async () => {
    const w = await world();
    const spanish = await w.skill('Spanish');
    const german = await w.skill('German');
    await setMemberSkills(w.owner, { memberId: w.cy.id, skillIds: [spanish, german] });
    await setMemberSkills(w.owner, { memberId: w.bea.id, skillIds: [german] });
    let listed = await setMemberSkills(w.owner, { memberId: w.cy.id, skillIds: [spanish] });
    expect(listed.members).toEqual(
      expect.arrayContaining([
        { memberId: w.cy.id, skillIds: [spanish] },
        { memberId: w.bea.id, skillIds: [german] },
      ]),
    );
    const unknown = await refusalOf(setMemberSkills(w.owner, { memberId: w.cy.id, skillIds: [newId()] }));
    expect(unknown).toMatchObject({ code: 'CONFIG_INVALID', field: 'skillIds' });
    await removeMember(w.owner, { memberId: w.cy.id }, [outboxHook({ mutationId: newId() })]);
    listed = await listSkills(w.owner);
    expect(listed.members).toEqual([{ memberId: w.bea.id, skillIds: [german] }]);
    const rows = await w.query<{ count: number }>(
      sql`select count(*)::int as count from member_skills where member_id = ${w.cy.id}::uuid`,
    );
    expect(rows[0]?.count).toBe(0);
  });
});

describe('members with skills in a host route (AC-1356)', () => {
  it('narrows to the members holding every skill, and falls back to the whole rotation when none of them is free', async () => {
    const w = await world();
    const spanish = await w.skill('Spanish');
    const emea = await w.skill('EMEA', 'region');
    await setMemberSkills(w.owner, { memberId: w.cy.id, skillIds: [spanish, emea] });
    await setMemberSkills(w.owner, { memberId: w.bea.id, skillIds: [emea] });
    await setRules(w, [needsSkills('spanish', [spanish, emea])]);
    // Cy alone holds both, twice in a row (a fair rotation would have given Bea the second).
    expect(await booked(w, '09:00', 'one@client.example')).toEqual({
      host: w.cy.id,
      rule_id: 'spanish',
      hosts: [w.cy.id],
    });
    expect(await booked(w, '11:00', 'two@client.example')).toMatchObject({ host: w.cy.id, hosts: [w.cy.id] });
    // Cy busy at 14:00: the whole rotation picks, and the decision says nobody was narrowed to.
    const busy: BusyAnswer = {
      status: 'read',
      busy: [{ start: at('13:00'), end: at('16:00') }],
    };
    expect(await booked(w, '14:00', 'three@client.example', calendar({ [w.cy.id]: busy }))).toEqual({
      host: w.bea.id,
      rule_id: 'spanish',
      hosts: null,
    });
  });

  it('lets the whole rotation pick when nobody holds the skills', async () => {
    const w = await world();
    const french = await w.skill('French');
    await setRules(w, [needsSkills('french', [french])]);
    const row = await booked(w, '09:00', 'four@client.example');
    expect(row).toMatchObject({ rule_id: 'french', hosts: null });
    expect([w.bea.id, w.cy.id]).toContain(row?.host);
  });

  it('hands a form’s route requiring skills on with their holders', async () => {
    const w = await world();
    const spanish = await w.skill('Spanish');
    await setMemberSkills(w.owner, { memberId: w.bea.id, skillIds: [spanish] });
    const created = await createForm(w.owner, { id: newId(), name: 'Contact us' });
    const saved = await saveFormDraft(w.owner, {
      formId: created.id,
      document: {
        ...created.draft,
        routing: {
          rules: [
            {
              id: 'all',
              when: { join: 'all', rules: [{ key: 'email', op: 'is_answered' }] },
              then: {
                kind: 'book',
                bookingPageId: w.page.id,
                hosts: { requireSkillIds: [spanish], ifNoneFree: 'whole_rotation' },
                message: '',
              },
            },
          ],
        },
      },
      expectedRevision: created.revision,
    });
    const form = await publishForm(w.owner, { formId: created.id, expectedRevision: saved.revision });
    const { scope, formId } = await enterPublicForm({ db }, form.publicKey);
    const input: SubmitBody = {
      idempotencyKey: newId(),
      answers: { name: 'Lead', email: 'lead@client.example' },
      hidden: {},
      fillMs: 10_000,
    };
    await submitForm(scope, registry, {
      formId,
      body: input,
      captcha: { kind: 'off' },
      answersKey: 'a-test-answers-key',
      signHandoff: (handoff) => `${handoff.submissionId}.${handoff.bookingPageId}`,
    });
    const rows = await w.query<{ hosts: string[] | null; routed: string | null }>(
      sql`select hosts::text[] as hosts, routed_page_id::text as routed from routing_decisions where surface_kind = 'form'`,
    );
    expect(rows).toEqual([{ hosts: [w.bea.id], routed: w.page.id }]);
  });

  it('refuses deleting a skill a rule requires (SKILL_IN_USE, naming the rule), and deletes it once unused', async () => {
    const w = await world();
    const spanish = await w.skill('Spanish');
    await setMemberSkills(w.owner, { memberId: w.cy.id, skillIds: [spanish] });
    await setRules(w, [needsSkills('first', [spanish])]);
    const refusal = await refusalOf(deleteSkill(w.owner, { id: spanish }));
    expect(refusal).toEqual({
      code: 'SKILL_IN_USE',
      message: 'Spanish is used by Rule 1 of Demo. Change the rule first.',
    });
    await setRules(w, []);
    const listed = await deleteSkill(w.owner, { id: spanish });
    expect(listed.skills).toEqual([]);
    expect(listed.members).toEqual([]);
    // A rule can't then name it.
    const named = await refusalOf(setRules(w, [needsSkills('again', [spanish])]));
    expect(named).toMatchObject({ code: 'CONFIG_INVALID', field: 'routing' });
  });
});

describe('Won means (AC-1385)', () => {
  it('keeps the Deals stage and its won stages, refuses a stale or foreign one, and says it is set', async () => {
    const w = await world();
    const stage = w.attribute('deals.stage');
    const won = await w.optionOf('deals.stage', 'Won');
    expect(await getRoutingSettings(w.owner)).toEqual({});
    const set = await setRoutingSettings(w.owner, { wonStage: { attributeId: stage, optionIds: [won] } });
    expect(set.wonStage).toEqual({ attributeId: stage, optionIds: [won] });
    expect(set.updatedAt).toEqual(expect.any(String));
    const stale = await refusalOf(setRoutingSettings(w.owner, { wonStage: null }));
    expect(stale.code).toBe('STALE');
    const foreign = await refusalOf(
      setRoutingSettings(w.owner, {
        wonStage: { attributeId: w.attribute('companies.employee_range'), optionIds: [won] },
        ...(set.updatedAt === undefined ? {} : { updatedAt: set.updatedAt }),
      }),
    );
    expect(foreign).toMatchObject({ code: 'CONFIG_INVALID', field: 'wonStage' });
    expect((await listSkills(w.bea.scope)).wonMeansSet).toBe(true);
    const audited = await w.query<{ count: number }>(
      sql`select count(*)::int as count from audit_events where action = 'routing.settings_changed'`,
    );
    expect(audited[0]?.count).toBe(1);
  });
});

/** Grace (grace@navy.example) at Navy, with an open Referral deal and, when `won`, a won deal of Navy's. */
async function customer(w: World, options: { readonly company?: boolean; readonly won?: boolean } = {}) {
  const companies = w.objects.companies;
  const navy = await createRecord(w.owner, {
    objectId: companies,
    values: { [w.attribute('companies.name')]: 'Navy' },
  });
  const grace = await createRecord(w.owner, {
    objectId: w.objects.people,
    values: {
      [w.attribute('people.name')]: { firstName: 'Grace' },
      [w.attribute('people.email_addresses')]: ['grace@navy.example'],
      ...(options.company === false
        ? {}
        : { [w.attribute('people.company')]: { objectId: companies, recordId: navy.recordId } }),
    },
  });
  const deal = (name: string, stage: string, source: string, link: Record<string, unknown>) =>
    createRecord(w.owner, {
      objectId: w.objects.deals,
      values: {
        [w.attribute('deals.name')]: name,
        [w.attribute('deals.stage')]: stage,
        [w.attribute('deals.source')]: source,
        ...link,
      },
    });
  const referral = await w.optionOf('deals.source', 'Referral');
  const inbound = await w.optionOf('deals.source', 'Inbound');
  const open = await deal('Pilot', await w.optionOf('deals.stage', 'Lead'), referral, {
    [w.attribute('deals.associated_people')]: [{ objectId: w.objects.people, recordId: grace.recordId }],
  });
  if (options.won === true) {
    await deal('First order', await w.optionOf('deals.stage', 'Won'), inbound, {
      [w.attribute('deals.associated_company')]: { objectId: companies, recordId: navy.recordId },
    });
  }
  return { grace, navy, open, referral, inbound };
}

describe('a deal’s fields and Known (AC-1393, AC-1377)', () => {
  const read = (w: World, email: string, keys: string[]) =>
    db.withWorkspace(w.workspaceId, (tx) =>
      recordFacts(tx, { people: w.objects.people, companies: w.objects.companies }, email, keys),
    );

  it('reads the latest open deal of the person, and Known as New, Known person, Known company or Customer', async () => {
    const w = await world();
    const source = `deal.${w.attribute('deals.source')}`;
    const { referral } = await customer(w, { won: true });
    // Won means unset: a won deal makes no Customer yet.
    expect((await read(w, 'grace@navy.example', [source, KNOWN_FACT])).facts).toEqual({
      [source]: [referral],
      [KNOWN_FACT]: 'company',
    });
    await setRoutingSettings(w.owner, {
      wonStage: { attributeId: w.attribute('deals.stage'), optionIds: [await w.optionOf('deals.stage', 'Won')] },
    });
    // The won deal is the company's; the open one still the person's.
    expect((await read(w, 'grace@navy.example', [source, KNOWN_FACT])).facts).toEqual({
      [source]: [referral],
      [KNOWN_FACT]: 'customer',
    });
    expect((await read(w, 'nobody@new.example', [source, KNOWN_FACT])).facts).toEqual({ [KNOWN_FACT]: 'new' });
  });

  it('reads Known person for someone with no company', async () => {
    const w = await world();
    await customer(w, { company: false });
    expect((await read(w, 'grace@navy.example', [KNOWN_FACT])).facts).toEqual({ [KNOWN_FACT]: 'person' });
  });

  it('routes a team page by Known, and never lets a form’s rules read a deal or Known', async () => {
    const w = await world();
    await customer(w, { won: true });
    await setRoutingSettings(w.owner, {
      wonStage: { attributeId: w.attribute('deals.stage'), optionIds: [await w.optionOf('deals.stage', 'Won')] },
    });
    await setRules(w, [
      {
        id: 'customers',
        when: { join: 'all', rules: [{ key: KNOWN_FACT, op: 'is', value: 'customer' }] },
        then: { kind: 'hosts', hosts: [w.bea.id] },
      },
    ]);
    expect(await booked(w, '09:00', 'grace@navy.example')).toEqual({
      host: w.bea.id,
      rule_id: 'customers',
      hosts: [w.bea.id],
    });
    expect(await booked(w, '10:00', 'walk-in@new.example')).toMatchObject({ rule_id: null });

    const created = await createForm(w.owner, { id: newId(), name: 'Contact us' });
    for (const key of [KNOWN_FACT, `deal.${w.attribute('deals.source')}`]) {
      const document: FormDocument = {
        ...created.draft,
        routing: {
          rules: [
            {
              id: 'crm',
              when: { join: 'all', rules: [{ key, op: 'is_answered' }] },
              then: { kind: 'message', message: 'Hi' },
            },
          ],
        },
      };
      const refused = await refusalOf(
        saveFormDraft(w.owner, { formId: created.id, document, expectedRevision: created.revision }),
      );
      expect(refused.code).toBe('CONFIG_INVALID');
    }
  });
});

describe('Routing › Test (AC-1392)', () => {
  it('answers what a team page would decide for an email, stores no decision and audits the email', async () => {
    const w = await world();
    const spanish = await w.skill('Spanish');
    await setMemberSkills(w.owner, { memberId: w.cy.id, skillIds: [spanish] });
    await customer(w);
    await setRules(w, [
      {
        id: 'known',
        name: 'Known people',
        when: { join: 'all', rules: [{ key: KNOWN_FACT, op: 'is_any_of', value: ['person', 'company'] }] },
        then: { kind: 'hosts', hosts: { requireSkillIds: [spanish], ifNoneFree: 'whole_rotation' } },
        qualified: true,
      },
    ]);
    const result = await routingTest(w.owner, {
      surface: { kind: 'booking_page', pageId: w.page.id },
      answers: {},
      email: 'Grace@Navy.example',
    });
    expect(result).toEqual({
      rule: { id: 'known', position: 1, name: 'Known people' },
      qualified: true,
      skipped: [],
      route: {
        kind: 'hosts',
        hosts: [{ id: w.cy.id, name: 'Cy' }],
        skills: [{ id: spanish, name: 'Spanish' }],
        wholeRotation: false,
      },
      known: 'company',
    });
    // Nobody known: the fallback, the whole rotation.
    const stranger = await routingTest(w.owner, {
      surface: { kind: 'booking_page', pageId: w.page.id },
      answers: {},
      email: 'nobody@new.example',
    });
    expect(stranger).toMatchObject({ fallback: { kind: 'rotation' }, known: 'new' });
    expect(stranger.rule).toBeUndefined();
    const decisions = await w.query<{ count: number }>(sql`select count(*)::int as count from routing_decisions`);
    expect(decisions[0]?.count).toBe(0);
    const audited = await w.query<{ email: string }>(
      sql`select after ->> 'email' as email from audit_events where action = 'routing.tested' order by at`,
    );
    expect(audited.map((row) => row.email)).toEqual(['grace@navy.example', 'nobody@new.example']);
  });

  it('runs a form’s rules on typed answers, never reading the CRM, and writes no audit row without an email', async () => {
    const w = await world();
    const created = await createForm(w.owner, { id: newId(), name: 'Contact us' });
    await saveFormDraft(w.owner, {
      formId: created.id,
      document: {
        ...created.draft,
        questions: [
          ...created.draft.questions,
          {
            id: 'plan',
            key: 'plan',
            label: 'Plan',
            answerType: 'choice',
            choices: ['Starter', 'Enterprise'],
            required: false,
            update: 'fill',
          },
        ],
        routing: {
          rules: [
            {
              id: 'enterprise',
              when: { join: 'all', rules: [{ key: 'plan', op: 'is', value: 'Enterprise' }] },
              then: { kind: 'book', bookingPageId: w.page.id, message: '' },
            },
          ],
        },
        after: { kind: 'message', message: '' },
      },
      expectedRevision: created.revision,
    });
    const enterprise = await routingTest(w.owner, {
      surface: { kind: 'form', formId: created.id },
      answers: { plan: 'Enterprise' },
    });
    expect(enterprise).toMatchObject({
      rule: { id: 'enterprise', position: 1 },
      route: { kind: 'book', page: { id: w.page.id, name: 'Demo' }, hosts: [], skills: [], wholeRotation: false },
    });
    expect(enterprise.known).toBeUndefined();
    const starter = await routingTest(w.owner, {
      surface: { kind: 'form', formId: created.id },
      answers: { plan: 'Starter' },
    });
    expect(starter).toMatchObject({ fallback: { kind: 'message' }, skipped: [] });
    const audited = await w.query<{ count: number }>(
      sql`select count(*)::int as count from audit_events where action = 'routing.tested'`,
    );
    expect(audited[0]?.count).toBe(0);
  });
});
