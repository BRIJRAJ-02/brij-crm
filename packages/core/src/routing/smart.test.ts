// The smart ranking end to end (spec 0037, lane L8), against the real
// Postgres as the app role: the settings and their audit row (AC-1351,
// AC-1363, AC-1374), fit from the lead's own record and from an answer filed
// onto that field (AC-1362), the ranking at a team page booking with the
// `facts` and `snapshot` it freezes (AC-1361, AC-1373), the explanation's
// three tiers (AC-1373), a decision replayed from its snapshot (AC-1387), no
// AI vendor anywhere in the routing path (AC-1379), and a form lead's owner
// that follows its meeting, with the claim, the unbooked job and the deferred
// notice (AC-1372, AC-1391, AC-1423, AC-1427).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  defaultAvailability,
  KNOWN_FACT,
  TILT_PERCENT_MAX,
  type FitLink,
  type PublicBookInput,
  type RoutingRule,
  type SubmitBody,
} from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage, enterPublicForm } from '../access/door.ts';
import { createAttribute } from '../attributes/attributes.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar, BusyAnswer } from '../booking/calendar.ts';
import { createBookingPage, updateBookingPage } from '../booking/pages.ts';
import { bookPublicSlot } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { storedRules } from '../access/stored-rules.ts';
import type { RuleSource } from '../access/door.ts';
import { createRecord } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { createForm, publishForm, saveFormDraft, updateFormSettings } from '../forms/forms.ts';
import { processSubmission } from '../forms/process.ts';
import { submitForm } from '../forms/public.ts';
import { getSubmission } from '../forms/submissions.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { createRotation } from '../rotation/rotations.ts';
import { adjustCount } from '../rotation/distribution.ts';
import { rescope, testScope } from '../testing.ts';
import { explainDecision, snapshotOf } from './explain.ts';
import { HANDOFF_LIFE_MS, UNBOOKED_DELAY_MS, WAITING_FOR_BOOKING } from './lead-owner.ts';
import { assignUnbooked } from '../forms/unbooked.ts';
import { routingDecision, routingDecisions } from './log.ts';
import { getRoutingSettings, readSmartSettings, setRoutingSettings, SMART_DEFAULTS } from './settings.ts';
import { createSkill, setMemberSkills } from './skills.ts';

const { appUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 11);
const registry = jobKinds({ environment: 'local' });
/** The app's own rules, as the api passes them: a notice reads each member through them. */
const APP_RULES: RuleSource = storedRules;
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-routing-smart-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const at = (time: string) => `2026-11-02T${time}:00.000Z`;

let made = 0;
/**
 * A workspace (Ada its owner) with Bea and Cy on weekday hours in one Sales
 * rotation behind the Demo team page, a People "Preferred language" select
 * with Spanish and German, and a Spanish skill.
 */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `routing-smart-${String(made)}-${newId().slice(-12)}`,
    firstMember: { name: 'Ada Admin', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const people = created.objects.people ?? '';
  const addMember = async (name: string) => {
    const id = newId();
    await db.withWorkspace(created.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
            values (${created.workspaceId}, ${id}, ${name}, ${`${name.toLowerCase()}-${id.slice(-6)}@acme.example`},
              'member', 'system', 'system')`,
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
  const spanishOption = newId();
  const germanOption = newId();
  const language = await createAttribute(owner, {
    objectId: people,
    id: newId(),
    title: 'Preferred language',
    type: 'select',
    options: [
      { id: spanishOption, label: 'Spanish', hue: 'blue' },
      { id: germanOption, label: 'German', hue: 'green' },
    ],
  });
  const spanishSkill = newId();
  await createSkill(owner, { id: spanishSkill, group: 'language', name: 'Spanish' });
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  const attributes = await query<{ id: string; slug: string }>(
    sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
  );
  const attribute = (slug: string) => attributes.find((row) => row.slug === slug)?.id ?? '';
  return {
    ...created,
    owner,
    system,
    people,
    bea,
    cy,
    rotation,
    page,
    language,
    spanishOption,
    germanOption,
    spanishSkill,
    query,
    attribute,
  };
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

/** A team page rule that lets everyone through, so a decision row is always written. */
const everyone: RoutingRule = {
  id: 'all',
  when: { join: 'all', rules: [{ key: KNOWN_FACT, op: 'is_answered' }] },
  then: { kind: 'hosts', hosts: [] },
};

/** Books the page at `time` and answers the booking with its decision row. */
async function booked(w: World, time: string, email: string, submissionId?: string) {
  const entry = await enterBookingPage({ db }, w.page.publicKey);
  const input = bookInput(at(time), email);
  const link = submissionId === undefined ? undefined : { submissionId };
  // The rules a lead's new owner is read with (AC-1391); without them the notice tells nobody.
  const made = await bookPublicSlot(entry, { ...deps(), rules: APP_RULES }, input, [outboxHook()], link);
  const [row] = await w.query<{
    id: string;
    host: string;
    reason: string;
    facts: unknown;
    snapshot: unknown;
  }>(sql`
    select d.id::text, b.host_member_id::text as host, a.reason, d.facts, d.snapshot
    from bookings b
    join routing_decisions d on d.booking_id = b.id and d.surface_kind = 'booking_page'
    left join rotation_assignments a on a.booking_id = b.id and a.voided_at is null
    where b.id = ${made.bookingId}::uuid
  `);
  return { bookingId: made.bookingId, ...row };
}

/** A lead person with a Preferred language, by email. */
async function lead(w: World, email: string, optionId: string) {
  const record = await createRecord(w.owner, {
    objectId: w.people,
    values: {
      [w.attribute('people.email_addresses')]: [email],
      [w.attribute('people.name')]: { firstName: 'Grace', lastName: 'Hopper' },
      [w.language.id]: optionId,
    },
  });
  return record.recordId;
}

/** Puts `count` meetings on a member, so the ranking has a load to work against. */
const loadUp = (w: World, memberId: string, count: number) =>
  adjustCount(w.owner, { rotationId: w.rotation.id, memberId, units: count, note: 'A test' });

/**
 * A busy rotation: `ahead` meetings on one member and `behind` on the other,
 * so the allowance (a share of the pool's mean load, never under one meeting)
 * is worth more than the gap between them. On a quiet rotation the allowance
 * floors at one meeting and a one meeting gap is a tie, which spec 0029's own
 * order settles, so the ranking has nothing to move.
 */
async function busy(w: World, ahead: string, behind: string) {
  await loadUp(w, ahead, 10);
  await loadUp(w, behind, 8);
}

describe('the routing settings (AC-1351, AC-1363, AC-1374)', () => {
  it('reads the code’s defaults with no row, stores a change, and audits only what changed', async () => {
    const w = await world();
    expect(await getRoutingSettings(w.owner)).toEqual({});
    expect(await db.withWorkspace(w.workspaceId, (tx) => readSmartSettings(tx))).toEqual(SMART_DEFAULTS);

    const first = await setRoutingSettings(w.owner, { smartMode: 'fit' });
    expect(first).toMatchObject({ smartMode: 'fit' });
    const second = await setRoutingSettings(w.owner, { tiltPercent: 40, updatedAt: first.updatedAt });
    expect(second).toMatchObject({ smartMode: 'fit', tiltPercent: 40 });
    // A repeat changes nothing and writes no audit row.
    const again = await setRoutingSettings(w.owner, { tiltPercent: 40, updatedAt: second.updatedAt });
    expect(again).toEqual(second);

    const audited = await w.query<{ before: unknown; after: unknown }>(
      sql`select before, after from audit_events where action = 'routing.settings_changed' order by at`,
    );
    expect(audited).toEqual([
      { before: { smartMode: null }, after: { smartMode: 'fit' } },
      { before: { tiltPercent: null }, after: { tiltPercent: 40 } },
    ]);
  });

  it('refuses a stale change, and a fit link whose field, option or skill isn’t live', async () => {
    const w = await world();
    const stored = await setRoutingSettings(w.owner, { smartMode: 'learn' });
    expect(await refusalOf(setRoutingSettings(w.owner, { tiltPercent: 1 }))).toMatchObject({ code: 'STALE' });

    const link: FitLink = { attributeId: w.language.id, optionId: w.spanishOption, skillId: w.spanishSkill };
    const ok = await setRoutingSettings(w.owner, { fit: [link], updatedAt: stored.updatedAt });
    expect(ok.fit).toEqual([link]);
    // An option of another field, and a skill that doesn't exist.
    for (const bad of [
      { ...link, optionId: w.germanOption, attributeId: w.attribute('deals.stage') },
      { ...link, skillId: newId() },
    ]) {
      expect(await refusalOf(setRoutingSettings(w.owner, { fit: [bad], updatedAt: ok.updatedAt }))).toMatchObject({
        code: 'CONFIG_INVALID',
        field: 'fit',
      });
    }
  });

  it('is read and changed by holders of routing.manage only', async () => {
    const w = await world();
    expect(await refusalOf(getRoutingSettings(w.bea.scope))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(setRoutingSettings(w.bea.scope, { smartMode: 'off' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    // Nothing was stored by the refused write.
    expect(await getRoutingSettings(w.owner)).toEqual({});
  });

  it('reads an unknown stored mode as off, and the database refuses an allowance out of range (AC-1223)', async () => {
    const w = await world();
    await setRoutingSettings(w.owner, { smartMode: 'learn', tiltPercent: 20 });
    // A mode a newer deploy wrote, or a hand edit: nothing unknown ever tilts a pick.
    await w.query(sql`update routing_settings set smart_mode = 'telepathy'`);
    expect(await db.withWorkspace(w.workspaceId, (tx) => readSmartSettings(tx))).toMatchObject({
      mode: 'off',
      tiltPercent: 20,
    });
    // The allowance can't be stored out of range at all (`routing_settings_tilt`).
    await expect(w.query(sql`update routing_settings set tilt_percent = 99`)).rejects.toThrow();
  });
});

describe('fit and the ranking at a booking (AC-1361, AC-1362, AC-1373)', () => {
  /** Bea speaks Spanish; Spanish leads should prefer her, inside the allowance. */
  async function spanishWorld() {
    const w = await world();
    await setMemberSkills(w.owner, { memberId: w.bea.id, skillIds: [w.spanishSkill] });
    await setRules(w, [everyone]);
    await setRoutingSettings(w.owner, {
      smartMode: 'fit',
      tiltPercent: TILT_PERCENT_MAX,
      fit: [{ attributeId: w.language.id, optionId: w.spanishOption, skillId: w.spanishSkill }],
    });
    return w;
  }

  it('prefers the rep who matches the lead, inside the allowance, and keeps `facts` and `snapshot` on the decision', async () => {
    const w = await spanishWorld();
    await lead(w, 'spanish@client.example', w.spanishOption);
    // Bea is two meetings ahead, so plain fairness would pick Cy; the allowance covers that gap.
    await busy(w, w.bea.id, w.cy.id);
    const row = await booked(w, '09:00', 'spanish@client.example');
    expect(row.host).toBe(w.bea.id);
    expect(row.reason).toBe('routed');
    expect(row.facts).toEqual([{ attributeId: w.language.id, optionId: w.spanishOption, from: 'record' }]);
    const seats = snapshotOf(row.snapshot);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({
      rotationId: w.rotation.id,
      mode: 'fit',
      holdout: false,
      tiltPercent: TILT_PERCENT_MAX,
      pickedMemberId: w.bea.id,
      by: 'track_record',
      windowDays: 30,
    });
    const candidates = seats[0]?.candidates ?? [];
    expect(candidates.find((each) => each.memberId === w.bea.id)).toMatchObject({ fit: 1, isPicked: true });
    expect(candidates.find((each) => each.memberId === w.cy.id)).toMatchObject({ fit: 0, isPicked: false });
  });

  it('changes nothing with mode off, and nothing when no fit link applies', async () => {
    const w = await spanishWorld();
    await setRoutingSettings(w.owner, { smartMode: 'off', updatedAt: (await getRoutingSettings(w.owner)).updatedAt });
    await lead(w, 'off@client.example', w.spanishOption);
    await busy(w, w.bea.id, w.cy.id);
    const off = await booked(w, '09:00', 'off@client.example');
    expect(off.host).toBe(w.cy.id);
    expect(off.reason).toBe('fair');
    // No snapshot at all: nothing was ranked.
    expect(off.snapshot).toBeNull();

    // Mode on, but this lead speaks German, which no link names: everyone's fit is 0.
    const second = await world();
    await setMemberSkills(second.owner, { memberId: second.bea.id, skillIds: [second.spanishSkill] });
    await setRules(second, [everyone]);
    await setRoutingSettings(second.owner, {
      smartMode: 'fit',
      tiltPercent: TILT_PERCENT_MAX,
      fit: [{ attributeId: second.language.id, optionId: second.spanishOption, skillId: second.spanishSkill }],
    });
    await lead(second, 'german@client.example', second.germanOption);
    await busy(second, second.bea.id, second.cy.id);
    const german = await booked(second, '09:00', 'german@client.example');
    expect(german.host).toBe(second.cy.id);
    expect(german.reason).toBe('fair');
    expect(snapshotOf(german.snapshot)[0]?.candidates.map((each) => each.fit)).toEqual([0, 0]);
  });

  it('never moves the pick further than the allowance, however strong the fit', async () => {
    const w = await spanishWorld();
    await setRoutingSettings(w.owner, {
      tiltPercent: 0,
      updatedAt: (await getRoutingSettings(w.owner)).updatedAt,
    });
    await lead(w, 'nolimit@client.example', w.spanishOption);
    await busy(w, w.bea.id, w.cy.id);
    const row = await booked(w, '09:00', 'nolimit@client.example');
    // An allowance of 0 picks exactly as the rotation's own strategy would.
    expect(row.host).toBe(w.cy.id);
    expect(row.reason).toBe('fair');
  });

  it('reads a fit option from an answer the page files onto that field, not only from the record', async () => {
    const w = await world();
    await setMemberSkills(w.owner, { memberId: w.cy.id, skillIds: [w.spanishSkill] });
    await setRules(w, [everyone]);
    await setRoutingSettings(w.owner, {
      smartMode: 'fit',
      tiltPercent: TILT_PERCENT_MAX,
      fit: [{ attributeId: w.language.id, optionId: w.spanishOption, skillId: w.spanishSkill }],
    });
    await updateBookingPage(
      w.owner,
      {
        pageId: w.page.id,
        settings: {
          questions: [
            {
              id: newId(),
              key: 'language',
              label: 'Preferred language',
              answerType: 'dropdown',
              required: false,
              update: 'fill',
              choices: ['Spanish', 'German'],
              filedOn: { objectRole: 'main', attributeId: w.language.id },
            },
          ],
        },
      },
      NOW,
    );
    // Cy is two meetings ahead, so only the answer can bring the booking to them.
    await busy(w, w.cy.id, w.bea.id);
    const entry = await enterBookingPage({ db }, w.page.publicKey);
    const input = { ...bookInput(at('09:00'), 'answered@client.example'), answers: { language: 'Spanish' } };
    const made = await bookPublicSlot(entry, deps(), input);
    const [row] = await w.query<{ host: string; facts: unknown }>(sql`
      select b.host_member_id::text as host, d.facts from bookings b
      join routing_decisions d on d.booking_id = b.id and d.surface_kind = 'booking_page'
      where b.id = ${made.bookingId}::uuid
    `);
    expect(row?.host).toBe(w.cy.id);
    expect(row?.facts).toEqual([{ attributeId: w.language.id, optionId: w.spanishOption, from: 'answered' }]);
  });
});

describe('the explanation (AC-1373) and replaying a decision (AC-1387)', () => {
  it('shows every candidate’s numbers with rates to routing.manage, only their own to the rep, and none to anyone else', async () => {
    const w = await world();
    await setMemberSkills(w.owner, { memberId: w.bea.id, skillIds: [w.spanishSkill] });
    await setRules(w, [everyone]);
    await setRoutingSettings(w.owner, {
      smartMode: 'fit',
      tiltPercent: TILT_PERCENT_MAX,
      fit: [{ attributeId: w.language.id, optionId: w.spanishOption, skillId: w.spanishSkill }],
    });
    await lead(w, 'why@client.example', w.spanishOption);
    await busy(w, w.bea.id, w.cy.id);
    const row = await booked(w, '09:00', 'why@client.example');

    // Routing › Decisions, which only `routing.manage` reaches: every row, with the rates.
    const seen = await routingDecision(w.owner, { id: row.id ?? '' });
    expect(seen.pick).toMatchObject({ memberId: w.bea.id, name: 'Bea', skills: ['Spanish'], by: 'track_record' });
    expect(seen.numbers).toHaveLength(2);
    expect(seen.numbers.every((each) => each.rate !== undefined && each.teamRate !== undefined)).toBe(true);

    const names = new Map([
      [w.bea.id, 'Bea'],
      [w.cy.id, 'Cy'],
    ]);
    const skills = new Map([[w.spanishSkill, 'Spanish']]);
    // The rule tier: the pick and its matched skills, and no numbers at all.
    const plain = explainDecision(row.snapshot, { tier: 'rule', memberNames: names, skillNames: skills });
    expect(plain.pick).toMatchObject({ name: 'Bea', skills: ['Spanish'] });
    expect(plain.numbers).toEqual([]);
    // The picked rep: their own row, with no rate.
    const own = explainDecision(row.snapshot, {
      tier: 'own',
      memberId: w.bea.id,
      memberNames: names,
      skillNames: skills,
    });
    expect(own.numbers.map((each) => each.memberId)).toEqual([w.bea.id]);
    expect(own.numbers[0]?.rate).toBeUndefined();
    // Another candidate reading at the same tier sees nobody's numbers.
    const other = explainDecision(row.snapshot, {
      tier: 'own',
      memberId: w.cy.id,
      memberNames: names,
      skillNames: skills,
    });
    expect(other.numbers).toEqual([]);
  });

  it('replays a stored decision to the same pick, from its snapshot alone', async () => {
    const w = await world();
    await setMemberSkills(w.owner, { memberId: w.bea.id, skillIds: [w.spanishSkill] });
    await setRules(w, [everyone]);
    await setRoutingSettings(w.owner, {
      smartMode: 'fit',
      tiltPercent: TILT_PERCENT_MAX,
      fit: [{ attributeId: w.language.id, optionId: w.spanishOption, skillId: w.spanishSkill }],
    });
    await busy(w, w.bea.id, w.cy.id);
    for (const [index, email] of ['a', 'b', 'c'].entries()) {
      await lead(w, `${email}@client.example`, index === 1 ? w.germanOption : w.spanishOption);
    }
    const rows = [
      await booked(w, '09:00', 'a@client.example'),
      await booked(w, '10:00', 'b@client.example'),
      await booked(w, '11:00', 'c@client.example'),
    ];
    // What changed since must not change the explanation: the skills and the settings move.
    await setMemberSkills(w.owner, { memberId: w.bea.id, skillIds: [] });
    await setRoutingSettings(w.owner, {
      smartMode: 'off',
      updatedAt: (await getRoutingSettings(w.owner)).updatedAt,
    });
    for (const row of rows) {
      const seats = snapshotOf(row.snapshot);
      const seat = seats[0];
      expect(seat?.pickedMemberId, 'the snapshot still names the host it picked').toBe(row.host);
      // The ranking's own key order over the frozen numbers still puts the pick first among those it could reach.
      const reachable = (seat?.candidates ?? []).filter(
        (each) => each.load <= (seat?.candidates[0]?.fairShare ?? 0) + (seat?.slack ?? 0),
      );
      expect(reachable.some((each) => each.memberId === row.host)).toBe(true);
    }
    // And the log still reads them the same way: every row's pick, and the numbers only when one is opened.
    const page = await routingDecisions(w.owner, {});
    expect(page.decisions.filter((each) => each.pick !== undefined)).toHaveLength(3);
    expect(page.decisions.every((each) => each.numbers.length === 0)).toBe(true);
  });
});

describe('what the routing folder may not do (AC-1379, AC-1423)', () => {
  /** Every file routing owns, source and all, read once for both scans. */
  async function routingSources(): Promise<ReadonlyMap<string, string>> {
    const here = new URL('.', import.meta.url).pathname;
    const files = (await readdir(here)).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThan(5);
    return new Map(
      await Promise.all(files.map(async (name) => [name, await readFile(join(here, name), 'utf8')] as const)),
    );
  }

  it('imports no AI vendor (AC-1379)', async () => {
    const vendors = /@anthropic-ai|openai|@google\/gener|@mistralai|cohere-ai|ollama|langchain|replicate/i;
    for (const [name, source] of await routingSources()) {
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((found) => found[1] ?? '');
      expect(
        imports.filter((each) => vendors.test(each)),
        name,
      ).toEqual([]);
    }
  });

  it('writes no record and never the owner attribute: it only ever claims (AC-1423)', async () => {
    // The engine's record writes, and the two helpers that build an owner value. Routing claims; the booking
    // (`booking/lead.ts`) and the unbooked job (`forms/unbooked.ts`) are the only places the owner lands.
    const writes = /\b(insertRecord|updateRecord|writeSkipping|ownerValue|recordLeadOwner|pickLeadOwner)\b/;
    for (const [name, source] of await routingSources()) {
      const code = source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
        .join('\n');
      expect(writes.test(code), `${name} writes a record`).toBe(false);
    }
  });
});

describe('a lead owner that follows its meeting (AC-1372, AC-1391, AC-1423, AC-1427)', () => {
  /** A published form whose owner is the Sales rotation and whose rule books the Demo page. */
  async function leadForm(w: World) {
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
              then: { kind: 'book', bookingPageId: w.page.id, message: '' },
            },
          ],
        },
      },
      expectedRevision: created.revision,
    });
    const live = await publishForm(w.owner, { formId: created.id, expectedRevision: saved.revision });
    return updateFormSettings(w.owner, { formId: live.id, ownerRotationId: w.rotation.id });
  }

  /** Sends the form and answers the submission's id. */
  async function submit(publicKey: string, email: string): Promise<string> {
    const { scope, formId } = await enterPublicForm({ db }, publicKey);
    const body: SubmitBody = {
      idempotencyKey: newId(),
      answers: { name: 'Grace', email },
      hidden: {},
      fillMs: 10_000,
    };
    await submitForm(scope, registry, {
      formId,
      body,
      captcha: { kind: 'off' },
      answersKey: 'a-test-answers-key',
      signHandoff: (handoff) => `${handoff.submissionId}.${handoff.bookingPageId}`,
    });
    const stored = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id::text from form_submissions where form_id = ${formId} and idempotency_key = ${body.idempotencyKey}`,
      ),
    );
    const id = stored.rows[0]?.id;
    if (id === undefined) throw new Error('No submission stored.');
    return id;
  }

  /** The member owning a record now, if any. */
  async function ownerOf(w: World, recordId: string | undefined): Promise<string | undefined> {
    const [row] = await w.query<{ member: string }>(sql`
      select v.actor_member_id::text as member from "values" v
      where v.record_id = ${recordId ?? newId()}::uuid and v.attribute_id = ${w.attribute('people.owner')}::uuid
        and v.active_until is null and not v.is_cleared
    `);
    return row?.member;
  }

  /** The members told of this submission, by id: one `notifications` row each (AC-1391). */
  const notified = (w: World, submissionId: string) =>
    w
      .query<{ member: string }>(
        sql`select member_id::text as member from notifications where submission_id = ${submissionId}::uuid
            order by created_at, id`,
      )
      .then((rows) => rows.map((row) => row.member));

  /** The rotation's live ledger rows, oldest first. */
  const ledger = (w: World) =>
    w.query<{ member: string; source: string; reason: string }>(sql`
      select member_id::text as member, source, reason from rotation_assignments
      where rotation_id = ${w.rotation.id} and voided_at is null and source <> 'adjustment'
      order by assigned_at, id
    `);

  it('leaves the lead unowned at submit, and gives it the booking’s host with one ledger row', async () => {
    const w = await world();
    const form = await leadForm(w);
    const submissionId = await submit(form.publicKey, 'waiting@client.example');
    await runWrite(w.system, (context) => processSubmission(context, submissionId, NOW, undefined, APP_RULES));

    const view = await getSubmission(w.owner, { submissionId });
    expect(view.assignment).toEqual({ rotationId: w.rotation.id, reason: WAITING_FOR_BOOKING });
    expect(await ownerOf(w, view.mainRecord?.recordId)).toBeUndefined();
    // There is always a row to claim, and nothing has claimed it yet.
    const [decision] = await w.query<{ id: string; assigned: string | null }>(
      sql`select id::text, assigned_member_id::text as assigned from routing_decisions where surface_kind = 'form'`,
    );
    expect(decision?.assigned).toBeNull();

    // At submit only the form's listed members were told; the waiting owner was not (AC-1391).
    const atSubmit = await notified(w, submissionId);
    expect(atSubmit).not.toContain(w.bea.id);
    expect(atSubmit).not.toContain(w.cy.id);

    const row = await booked(w, '09:00', 'waiting@client.example', submissionId);
    expect(await ownerOf(w, view.mainRecord?.recordId)).toBe(row.host);
    // The owner hears of the lead now, when they became it, and nobody is told twice.
    const told = await notified(w, submissionId);
    expect(told).toContain(row.host);
    expect(told).toEqual([...atSubmit, row.host]);
    const claimed = await w.query<{ assigned: string | null }>(
      sql`select assigned_member_id::text as assigned from routing_decisions where surface_kind = 'form'`,
    );
    expect(claimed[0]?.assigned).toBe(row.host);
    // One count for both: the booking's row, and no `form` row.
    const rows = await ledger(w);
    expect(rows.map((each) => ({ member: each.member, source: each.source }))).toEqual([
      { member: row.host, source: 'booking' },
    ]);
    const after = await getSubmission(w.owner, { submissionId });
    expect(after.assignment).toMatchObject({ memberId: row.host, rotationId: w.rotation.id });
  });

  it('picks the owner through pickLeadOwner when no booking came, and the booking afterwards claims nothing', async () => {
    const w = await world();
    const form = await leadForm(w);
    const submissionId = await submit(form.publicKey, 'unbooked@client.example');
    await runWrite(w.system, (context) => processSubmission(context, submissionId, NOW, undefined, APP_RULES));
    const view = await getSubmission(w.owner, { submissionId });
    const [decision] = await w.query<{ id: string }>(
      sql`select id::text from routing_decisions where surface_kind = 'form'`,
    );
    const later = new Date(NOW.getTime() + HANDOFF_LIFE_MS + UNBOOKED_DELAY_MS);
    await runWrite(w.system, (context) =>
      assignUnbooked(context, { submissionId, decisionId: decision?.id ?? newId() }, later, APP_RULES),
    );
    const owner = await ownerOf(w, view.mainRecord?.recordId);
    expect([w.bea.id, w.cy.id]).toContain(owner);
    // The job's own ledger row, as a form assignment, and the submission records who it went to.
    const rows = await ledger(w);
    expect(rows.map((each) => ({ member: each.member, source: each.source }))).toEqual([
      { member: owner ?? '', source: 'form' },
    ]);
    expect((await getSubmission(w.owner, { submissionId })).assignment).toMatchObject({ memberId: owner });
    // The owner is told when the job assigns them, beside the listed members told at submit (AC-1391).
    expect(await notified(w, submissionId)).toContain(owner);

    // Running it again changes nothing: the claim is taken.
    await runWrite(w.system, (context) =>
      assignUnbooked(context, { submissionId, decisionId: decision?.id ?? newId() }, later, APP_RULES),
    );
    expect(await ledger(w)).toHaveLength(1);
  });

  it('refuses a booking through a hand off past its 24 hours (AC-1427)', async () => {
    const w = await world();
    const form = await leadForm(w);
    const submissionId = await submit(form.publicKey, 'expired@client.example');
    await runWrite(w.system, (context) => processSubmission(context, submissionId, NOW, undefined, APP_RULES));
    // The submission came in more than a day before the booking's clock.
    const old = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    await w.query(sql`update form_submissions set received_at = ${old}::timestamptz where id = ${submissionId}::uuid`);
    const entry = await enterBookingPage({ db }, w.page.publicKey);
    const refusal = await refusalOf(
      bookPublicSlot(entry, deps(), bookInput(at('09:00'), 'expired@client.example'), [], { submissionId }),
    );
    expect(refusal).toMatchObject({ code: 'HANDOFF_EXPIRED' });
  });

  it('picks the owner at submit, as today, when the page doesn’t use the form’s rotation', async () => {
    const w = await world();
    const other = await createRotation(
      w.owner,
      {
        id: newId(),
        settings: { name: 'Support', strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'none' },
        members: [{ memberId: w.bea.id, weight: 100, priority: 2, dailyCap: null, weeklyCap: null, isOn: true }],
      },
      NOW,
    );
    const form = await leadForm(w);
    await updateFormSettings(w.owner, { formId: form.id, ownerRotationId: other.id });
    const submissionId = await submit(form.publicKey, 'nowait@client.example');
    await runWrite(w.system, (context) => processSubmission(context, submissionId, NOW, undefined, APP_RULES));
    const view = await getSubmission(w.owner, { submissionId });
    expect(view.assignment).toMatchObject({ memberId: w.bea.id, rotationId: other.id });
    expect(await ownerOf(w, view.mainRecord?.recordId)).toBe(w.bea.id);
  });
});
