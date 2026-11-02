// Outcomes and learning end to end (spec 0037, lane L9), against the real
// Postgres as the app role: the holdout drawn and recorded with the segment
// on every ranked decision (AC-1389, AC-1370), the nightly run counting
// trials and outcomes into `routing_stats` and switching the model (AC-1366,
// AC-1368, AC-1381), the lift the ranking then reads (AC-1369), Insights with
// its marking rate and comparison (AC-1376), "Learn from" (AC-1386), each
// page's objective (AC-1354), and the tenancy guards on the new table.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  ALL_SEGMENTS,
  defaultAvailability,
  HOLDOUT_PERCENT_MAX,
  KNOWN_FACT,
  UNKNOWN_SEGMENT,
  type PublicBookInput,
  type RoutingRule,
} from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterBookingPage } from '../access/door.ts';
import { createAttribute } from '../attributes/attributes.ts';
import { saveDefaultHours } from '../availability/schedules.ts';
import type { BookingCalendar } from '../booking/calendar.ts';
import { createBookingPage, updateBookingPage } from '../booking/pages.ts';
import { bookPublicSlot } from '../booking/public.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { createRotation } from '../rotation/rotations.ts';
import { rescope, testScope } from '../testing.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import {
  LEARN_HOUR,
  LEARN_SPREAD_MINUTES,
  learnKey,
  learnMinute,
  queueRoutingLearn,
  readLocalNow,
  type LocalNow,
} from './fanout.ts';
import { routingInsights } from './insights.ts';
import { routingLearn } from './learn.ts';
import { getRoutingSettings, readSmartSettings, setRoutingSettings } from './settings.ts';
import { readPageLift } from './stats.ts';

const { appUrl } = inject('testDatabase');
const LINK_KEY = Buffer.alloc(32, 13);
const registry = jobKinds({ environment: 'local' });
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-routing-learn-tests' });
});
afterAll(async () => {
  await db.close();
});

/** Sunday 1 November 2026, midnight UTC. */
const NOW = new Date('2026-11-01T00:00:00.000Z');
const at = (time: string) => `2026-11-02T${time}:00.000Z`;

let made = 0;

/**
 * A workspace (Ada its owner) with Bea and Cy in one Sales rotation behind the
 * Demo team page, and a Companies "Segment" select with Enterprise and SMB,
 * which is what a segment attribute may be (never People's, AC-1370).
 */
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `routing-learn-${String(made)}-${newId().slice(-12)}`,
    firstMember: { name: 'Ada Admin', email: 'ada@example.com' },
  });
  const owner = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
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
  const enterprise = newId();
  const smb = newId();
  const segment = await createAttribute(owner, {
    objectId: companies,
    id: newId(),
    title: 'Segment',
    type: 'select',
    options: [
      { id: enterprise, label: 'Enterprise', hue: 'blue' },
      { id: smb, label: 'SMB', hue: 'green' },
    ],
  });
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
    companies,
    bea,
    cy,
    rotation,
    page,
    segment,
    enterprise,
    smb,
    query,
    attribute,
  };
}
type World = Awaited<ReturnType<typeof world>>;

const calendar = (): BookingCalendar => ({
  busy: () => Promise.resolve({ status: 'none' }),
  events: () => Promise.resolve({ meetingId: newId() }),
});
const deps = () => ({ calendar: calendar(), now: () => NOW, linkKey: LINK_KEY });

const bookInput = (start: string, email: string): PublicBookInput => ({
  idempotencyKey: newId(),
  start,
  duration: 30,
  name: 'Grace Hopper',
  email,
  timeZone: 'UTC',
});

/** A team page rule that lets everyone through, so a ranked decision row is always written. */
const everyone: RoutingRule = {
  id: 'all',
  when: { join: 'all', rules: [{ key: KNOWN_FACT, op: 'is_answered' }] },
  then: { kind: 'hosts', hosts: [] },
};

const setRules = (w: World, rules: RoutingRule[] = [everyone]) =>
  updateBookingPage(w.owner, { pageId: w.page.id, settings: {}, routing: { rules } }, NOW);

/** Books the page at `time` and answers its decision row. */
async function booked(w: World, time: string, email: string) {
  const entry = await enterBookingPage({ db }, w.page.publicKey);
  const made2 = await bookPublicSlot(entry, deps(), bookInput(at(time), email), [outboxHook()]);
  const [row] = await w.query<{
    id: string;
    host: string;
    holdout: boolean | null;
    segment_key: string | null;
    snapshot: unknown;
  }>(sql`
    select d.id::text, b.host_member_id::text as host, d.holdout, d.segment_key, d.snapshot
    from bookings b
    join routing_decisions d on d.booking_id = b.id and d.surface_kind = 'booking_page'
    where b.id = ${made2.bookingId}::uuid
  `);
  return { bookingId: made2.bookingId, ...row };
}

/** A lead with a company holding `optionId` as its Segment. */
async function lead(w: World, email: string, optionId?: string) {
  const company = await createRecord(w.owner, {
    objectId: w.companies,
    values: {
      [w.attribute('companies.name')]: 'Globex',
      ...(optionId === undefined ? {} : { [w.segment.id]: optionId }),
    },
  });
  const person = await createRecord(w.owner, {
    objectId: w.people,
    values: {
      [w.attribute('people.email_addresses')]: [email],
      [w.attribute('people.name')]: { firstName: 'Grace', lastName: 'Hopper' },
      [w.attribute('people.company')]: { objectId: w.companies, recordId: company.recordId },
    },
  });
  return { company: company.recordId, person: person.recordId };
}

/** Runs the nightly run to the end, a batch at a time, and answers how many batches it took. */
async function runLearn(w: World, now: Date = NOW): Promise<{ batches: number; result: unknown }> {
  const kind = routingLearn(() => now.getTime());
  let checkpoint: unknown = undefined;
  let batches = 0;
  let result: unknown;
  for (;;) {
    batches += 1;

    const outcome = await runWrite(
      w.system,
      (context) =>
        kind.step(context, { job: { id: newId(), params: { day: '2026-11-01' }, checkpoint, attempts: 0 }, limit: 1 }),
      [],
    );
    checkpoint = outcome.result.checkpoint;
    if (outcome.result.finished) {
      result = outcome.result.result;
      break;
    }
    expect(batches).toBeLessThan(20);
  }
  return { batches, result };
}

/** The cells the last run wrote, at the live model. */
async function statsOf(w: World) {
  const [settings] = await w.query<{ model_version: number }>(sql`select model_version from routing_settings`);
  return w.query<{
    segment_key: string;
    objective: string;
    member_id: string;
    trials: number;
    successes: number;
    waiting: number;
  }>(sql`
    select segment_key, objective, member_id::text, trials, successes, waiting
    from routing_stats where model_version = ${settings?.model_version ?? 0}
    order by segment_key, member_id
  `);
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

describe('the holdout and the segment on every ranked decision (AC-1389, AC-1370)', () => {
  it('stamps the all segments key and a drawn holdout, and never ranks a holdout', async () => {
    const w = await world();
    await setRules(w);
    // Nothing set, so the defaults run: mode learn, a 10 percent holdout, no segment attributes.
    const settings = await db.withWorkspace(w.workspaceId, (tx) => readSmartSettings(tx));
    expect(settings.holdoutPercent).toBe(10);
    expect(settings.segmentAttributeIds).toEqual([]);

    await lead(w, 'grace@globex.example', w.enterprise);
    const one = await booked(w, '10:00', 'grace@globex.example');
    // Every ranked decision carries both, whatever the mode: a workspace that turns Learn on later has cells to warm.
    expect(one.segment_key).toBe(ALL_SEGMENTS);
    expect(typeof one.holdout).toBe('boolean');
    // The seat's snapshot says whether this decision was in the holdout, and a holdout picks plain fair.
    const seats = one.snapshot as readonly { holdout: boolean; by: string }[];
    expect(seats.length).toBe(1);
    expect(seats[0]?.holdout).toBe(one.holdout);
    if (one.holdout === true) expect(seats[0]?.by).toBe('fair_share');
  });

  it('stamps the segment from the lead’s company, and the unknown key when it has no value', async () => {
    const w = await world();
    await setRules(w);
    const before = await getRoutingSettings(w.owner);
    await setRoutingSettings(w.owner, { segmentAttributeIds: [w.segment.id], updatedAt: before.updatedAt });

    await lead(w, 'ent@globex.example', w.enterprise);
    const known = await booked(w, '10:00', 'ent@globex.example');
    expect(known.segment_key).toBe(`${w.segment.id}=${w.enterprise}`);

    // A lead whose company has no Segment lands in `?`, which never warms on its own.
    await lead(w, 'none@globex.example');
    const unknown = await booked(w, '11:00', 'none@globex.example');
    expect(unknown.segment_key).toBe(UNKNOWN_SEGMENT);
  });
});

describe('the nightly run (AC-1366, AC-1368, AC-1381)', () => {
  it('counts each ranked booking once per cell, writes the model beside the old one and switches it', async () => {
    const w = await world();
    await setRules(w);
    await lead(w, 'one@globex.example', w.enterprise);
    await lead(w, 'two@globex.example', w.smb);
    const one = await booked(w, '10:00', 'one@globex.example');
    const two = await booked(w, '11:00', 'two@globex.example');
    expect(one.host).not.toBe('');
    expect(two.host).not.toBe('');

    // Nothing learned yet, so the ranking reads no lift at all.
    const before = await db.withWorkspace(w.workspaceId, (tx) => readSmartSettings(tx));
    expect(before.modelVersion).toBe(0);

    // Three weeks after the meetings: Held has settled (7 days), Deals created has not (30 days).
    const soon = new Date('2026-11-12T00:00:00.000Z');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update booking_pages set routing_objective = 'held' where id = ${w.page.id}::uuid`),
    );
    const run = await runLearn(w, soon);
    // One batch a page, then one that switches the model.
    expect(run.batches).toBe(2);
    const after = await db.withWorkspace(w.workspaceId, (tx) => readSmartSettings(tx));
    expect(after.modelVersion).toBe(1);

    const cells = await statsOf(w);
    expect(cells.length).toBeGreaterThan(0);
    // Both bookings held, so every trial is a success; the all segments cell holds both.
    const all = cells.filter((row) => row.segment_key === ALL_SEGMENTS);
    expect(all.reduce((total, row) => total + row.trials, 0)).toBe(2);
    expect(all.reduce((total, row) => total + row.successes, 0)).toBe(2);
    expect(every(all, (row) => row.objective === 'held')).toBe(true);
  });

  it('a no show marked after a run flips Held at the next one, because every run counts again', async () => {
    const w = await world();
    await setRules(w);
    await lead(w, 'flip@globex.example', w.enterprise);
    const one = await booked(w, '10:00', 'flip@globex.example');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update booking_pages set routing_objective = 'held' where id = ${w.page.id}::uuid`),
    );
    const soon = new Date('2026-11-12T00:00:00.000Z');
    await runLearn(w, soon);
    expect((await statsOf(w)).reduce((total, row) => total + row.successes, 0)).toBe(1);

    // Marked nine days after the meeting, which is past Held's window: the next run counts it as a failure.
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(
        sql`update bookings set no_show_at = ${soon.toISOString()}::timestamptz, no_show_by_member_id = ${w.memberId}::uuid
            where id = ${one.bookingId}::uuid`,
      ),
    );
    await runLearn(w, soon);
    const cells = await statsOf(w);
    expect(cells.reduce((total, row) => total + row.trials, 0)).toBe(1);
    expect(cells.reduce((total, row) => total + row.successes, 0)).toBe(0);
  });

  it('counts a booking still inside its outcome window as waiting, never as a trial', async () => {
    const w = await world();
    await setRules(w);
    await lead(w, 'soon@globex.example', w.enterprise);
    await booked(w, '10:00', 'soon@globex.example');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update booking_pages set routing_objective = 'held' where id = ${w.page.id}::uuid`),
    );
    // Two days after the meeting: Held settles at seven.
    await runLearn(w, new Date('2026-11-04T00:00:00.000Z'));
    const cells = await statsOf(w);
    expect(cells.reduce((total, row) => total + row.trials, 0)).toBe(0);
    expect(cells.reduce((total, row) => total + row.waiting, 0)).toBe(1);
  });

  it('“Learn from” drops the outcomes of earlier bookings (AC-1386)', async () => {
    const w = await world();
    await setRules(w);
    await lead(w, 'old@globex.example', w.enterprise);
    await booked(w, '10:00', 'old@globex.example');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update booking_pages set routing_objective = 'held' where id = ${w.page.id}::uuid`),
    );
    const soon = new Date('2026-11-12T00:00:00.000Z');
    await runLearn(w, soon);
    expect((await statsOf(w)).reduce((total, row) => total + row.trials, 0)).toBe(1);

    // Learning from after the booking: the next run counts nothing at all.
    const read = await getRoutingSettings(w.owner);
    await setRoutingSettings(w.owner, { learnSince: '2026-11-10', updatedAt: read.updatedAt });
    await runLearn(w, soon);
    expect((await statsOf(w)).length).toBe(0);
  });

  it('the lift the ranking reads comes from a warm cell only, and `?` never warms (AC-1369, AC-1370)', async () => {
    const w = await world();
    await setRules(w);
    // The cells written by hand, at the model the ranking reads: the run's own arithmetic is `learning.test.ts`.
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        insert into routing_settings (workspace_id, model_version, created_by_type, updated_by_type)
        values (${w.workspaceId}, 1, 'system', 'system')
        on conflict (workspace_id) do update set model_version = 1
      `),
    );
    const cell = (segmentKey: string, memberId: string, trials: number, successes: number) =>
      db.withWorkspace(w.workspaceId, (tx) =>
        tx.execute(sql`
          insert into routing_stats (workspace_id, model_version, page_id, rotation_id, segment_key, objective,
            member_id, trials, successes, waiting)
          values (${w.workspaceId}, 1, ${w.page.id}::uuid, ${w.rotation.id}::uuid, ${segmentKey}, 'deal',
            ${memberId}::uuid, ${trials}, ${successes}, 0)
        `),
      );
    // A warm all segments cell where Bea closes far more than Cy.
    await cell(ALL_SEGMENTS, w.bea.id, 100, 80);
    await cell(ALL_SEGMENTS, w.cy.id, 100, 20);
    // A cold named cell, and a `?` cell with plenty of trials, which still must give nothing.
    await cell(`${w.segment.id}=${w.enterprise}`, w.bea.id, 5, 5);
    await cell(UNKNOWN_SEGMENT, w.bea.id, 400, 400);
    await cell(UNKNOWN_SEGMENT, w.cy.id, 400, 0);

    const read = (segmentKey: string) =>
      db.withWorkspace(w.workspaceId, (tx) =>
        readPageLift(tx, {
          pageId: w.page.id,
          rotationIds: [w.rotation.id],
          segmentKey,
          objective: 'deal',
          modelVersion: 1,
        }),
      );
    // The cold named cell falls back to the warm all segments cell.
    const cold = (await read(`${w.segment.id}=${w.enterprise}`)).get(w.rotation.id);
    expect(cold?.lift.get(w.bea.id) ?? 0).toBeGreaterThan(0);
    expect(cold?.lift.get(w.cy.id) ?? 0).toBe(0);
    // `?` reads the all segments cell too, never its own: Bea's 100 percent there buys nothing.
    const unknown = (await read(UNKNOWN_SEGMENT)).get(w.rotation.id);
    expect(unknown?.lift.get(w.bea.id)).toBe(cold?.lift.get(w.bea.id));
    // Model 0 reads nothing at all, so a workspace that has never run is never charged a query.
    const none = await db.withWorkspace(w.workspaceId, (tx) =>
      readPageLift(tx, {
        pageId: w.page.id,
        rotationIds: [w.rotation.id],
        segmentKey: ALL_SEGMENTS,
        objective: 'deal',
        modelVersion: 0,
      }),
    );
    expect([...none]).toEqual([]);
  });
});

describe('Routing › Insights (AC-1376, AC-1389)', () => {
  it('answers the cells, the comparison and each rep’s numbers, and nothing to a member', async () => {
    const w = await world();
    await setRules(w);
    await lead(w, 'in@globex.example', w.enterprise);
    await booked(w, '10:00', 'in@globex.example');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update booking_pages set routing_objective = 'held' where id = ${w.page.id}::uuid`),
    );
    await runLearn(w, new Date('2026-11-12T00:00:00.000Z'));

    const insights = await routingInsights(w.owner);
    expect(insights.modelVersion).toBe(1);
    expect(insights.segmentAttributes).toEqual([]);
    expect(insights.segmentsRestarted).toBe(false);
    const page = insights.pages.find((each) => each.pageId === w.page.id);
    expect(page?.objective).toBe('held');
    expect(page?.ranked).toBe(1);
    expect(page?.cells.length ?? 0).toBeGreaterThan(0);
    const all = page?.cells.find((each) => each.segmentKey === ALL_SEGMENTS);
    expect(all?.isWarm).toBe(false);
    // Cold, so it says when it could be ready rather than showing a lift.
    expect(all?.readyFrom === undefined || /^\d{4}-\d{2}-\d{2}$/.test(all.readyFrom)).toBe(true);
    // A cold cell reports no lift at all, rather than 0: on screen that is "—", not a judgement on the rep.
    expect(every(all?.members ?? [], (member) => member.lift === undefined)).toBe(true);
    // One meeting cannot be certain either way.
    expect(page?.isCertain).toBe(false);

    // A member without routing.manage gets nothing (hidden means absent).
    const refusal = await refusalOf(routingInsights(w.bea.scope));
    expect(refusal.code).toBe('FORBIDDEN');
  });

  it('says segment learning restarted once the segment fields changed under the cells (AC-1370)', async () => {
    const w = await world();
    await setRules(w);
    const read = await getRoutingSettings(w.owner);
    await setRoutingSettings(w.owner, { segmentAttributeIds: [w.segment.id], updatedAt: read.updatedAt });
    await lead(w, 'seg@globex.example', w.enterprise);
    await booked(w, '10:00', 'seg@globex.example');
    await runLearn(w, new Date('2026-12-20T00:00:00.000Z'));
    expect((await routingInsights(w.owner)).segmentsRestarted).toBe(false);

    // The fields cleared: the trained segment keys now name a field that isn't a segment any more.
    const again = await getRoutingSettings(w.owner);
    await setRoutingSettings(w.owner, { segmentAttributeIds: [], updatedAt: again.updatedAt });
    const after = await routingInsights(w.owner);
    expect(after.segmentsRestarted).toBe(true);
    expect(after.segmentAttributes).toEqual([]);
  });
});

describe('the settings the lane adds (AC-1370, AC-1386, AC-1389)', () => {
  it('stores the holdout, the segments and Learn from, with one audit row for what changed', async () => {
    const w = await world();
    const before = await getRoutingSettings(w.owner);
    const saved = await setRoutingSettings(w.owner, {
      holdoutPercent: 0,
      segmentAttributeIds: [w.segment.id],
      learnSince: '2026-10-01',
      updatedAt: before.updatedAt,
    });
    expect(saved.holdoutPercent).toBe(0);
    expect(saved.segmentAttributeIds).toEqual([w.segment.id]);
    expect(saved.learnSince).toBe('2026-10-01');
    const rows = await w.query<{ action: string; before: unknown; after: unknown }>(
      sql`select action, before, after from audit_events where action = 'routing.settings_changed' order by at`,
    );
    expect(rows.length).toBe(1);
    expect(Object.keys(rows[0]?.after as object).sort()).toEqual([
      'holdoutPercent',
      'learnSince',
      'segmentAttributeIds',
    ]);

    // Learn from cleared: null means "count everything in the window again".
    const cleared = await setRoutingSettings(w.owner, { learnSince: null, updatedAt: saved.updatedAt });
    expect(cleared.learnSince).toBeUndefined();
    // Nothing changed writes nothing.
    const same = await setRoutingSettings(w.owner, { holdoutPercent: 0, updatedAt: cleared.updatedAt });
    expect(same.updatedAt).toBe(cleared.updatedAt);
  });

  it('refuses a segment field that isn’t a live select of Companies or Deals (AC-1370)', async () => {
    const w = await world();
    const before = await getRoutingSettings(w.owner);
    // A People field is never a segment: a segment must describe the company or the deal, not the person.
    const onPeople = await createAttribute(w.owner, {
      objectId: w.people,
      id: newId(),
      title: 'Preferred language',
      type: 'select',
      options: [{ id: newId(), label: 'Spanish', hue: 'blue' }],
    });
    const refused = await refusalOf(
      setRoutingSettings(w.owner, { segmentAttributeIds: [onPeople.id], updatedAt: before.updatedAt }),
    );
    expect(refused.code).toBe('CONFIG_INVALID');

    // A field with more options than a cell can warm on is refused too.
    const wide = await createAttribute(w.owner, {
      objectId: w.companies,
      id: newId(),
      title: 'Industry',
      type: 'select',
      options: Array.from({ length: 7 }, (_, index) => ({
        id: newId(),
        label: `I${String(index)}`,
        hue: 'blue' as const,
      })),
    });
    const tooWide = await refusalOf(
      setRoutingSettings(w.owner, { segmentAttributeIds: [wide.id], updatedAt: before.updatedAt }),
    );
    expect(tooWide.code).toBe('CONFIG_INVALID');
  });

  it('reads a stored holdout out of range as the nearest allowed one, never as a wild draw (AC-1223)', async () => {
    const w = await world();
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        insert into routing_settings (workspace_id, created_by_type, updated_by_type)
        values (${w.workspaceId}, 'system', 'system')
      `),
    );
    // The check keeps 0 to 20 in the column; the code clamps again, so a future widening can't surprise the draw.
    const settings = await db.withWorkspace(w.workspaceId, (tx) => readSmartSettings(tx));
    expect(settings.holdoutPercent).toBeLessThanOrEqual(HOLDOUT_PERCENT_MAX);
    expect(settings.holdoutPercent).toBeGreaterThanOrEqual(0);
  });
});

describe('the tenancy guards on routing_stats', () => {
  it('forces row level security, has a policy, and answers nothing across workspaces', async () => {
    const w = await world();
    const other = await world();
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        insert into routing_stats (workspace_id, model_version, page_id, rotation_id, segment_key, objective,
          member_id, trials, successes, waiting)
        values (${w.workspaceId}, 1, ${w.page.id}::uuid, ${w.rotation.id}::uuid, ${ALL_SEGMENTS}, 'deal',
          ${w.bea.id}::uuid, 10, 5, 0)
      `),
    );
    const guards = await w.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean; policies: number }>(sql`
      select c.relrowsecurity, c.relforcerowsecurity,
        (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
      from pg_class c where c.relname = 'routing_stats'
    `);
    expect(guards[0]?.relrowsecurity).toBe(true);
    expect(guards[0]?.relforcerowsecurity).toBe(true);
    expect(guards[0]?.policies).toBe(1);

    // The other workspace sees none of it, however it asks.
    const seen = await other.query<{ n: number }>(sql`select count(*)::int as n from routing_stats`);
    expect(seen[0]?.n).toBe(0);
  });

  it('has the partial index the nightly run reads through (AC-1381)', async () => {
    const w = await world();
    const found = await w.query<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where indexname = 'routing_decisions_ranked'`,
    );
    expect(found.length).toBe(1);
    expect(found[0]?.indexdef).toContain('snapshot IS NOT NULL');
  });
});

describe('the hourly fan out (AC-1381)', () => {
  it('starts one run a workspace at its own 03:00, spread by a hash, and skips every other hour', async () => {
    const w = await world();
    const log = { info: () => undefined, error: () => undefined };
    // The clock each workspace reads, so the hour under test is the test's, not the machine's.
    const run = (now: LocalNow | undefined) =>
      queueRoutingLearn({
        registry,
        systemScope: () => w.system,
        hooks: () => [],
        sweep: { due: () => Promise.resolve([w.workspaceId]) },
        localNow: () => Promise.resolve(now),
        log,
      });

    // The 02:00 hour: nothing starts, however much there is to count.
    expect(await run({ day: '2026-11-01', hour: 2, minute: 59 })).toMatchObject({ started: 0, skipped: 1 });
    // A damaged zone answers nothing, so such a workspace is never due rather than holding up the sweep.
    expect(await run(undefined)).toMatchObject({ started: 0, skipped: 1 });

    const slot = learnMinute(w.workspaceId);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(LEARN_SPREAD_MINUTES);
    // Inside the hour but before its slot: a later turn in the same hour starts it.
    if (slot > 0) {
      expect(await run({ day: '2026-11-01', hour: LEARN_HOUR, minute: slot - 1 })).toMatchObject({
        started: 0,
        waiting: 1,
      });
    }
    // Its slot has come: one job, under the local day's once key.
    expect(await run({ day: '2026-11-01', hour: LEARN_HOUR, minute: slot })).toMatchObject({ started: 1 });
    const jobs = await w.query<{ kind: string; once_key: string | null; params: unknown }>(
      sql`select kind, once_key, params from jobs where kind = 'routing.learn'`,
    );
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.once_key).toBe(learnKey('2026-11-01'));
    expect(jobs[0]?.params).toMatchObject({ day: '2026-11-01' });

    // A second turn in the same hour is a no op: the once key is the same day's.
    expect(await run({ day: '2026-11-01', hour: LEARN_HOUR, minute: 59 })).toMatchObject({ started: 1, failed: 0 });
    const again = await w.query<{ n: number }>(sql`select count(*)::int as n from jobs where kind = 'routing.learn'`);
    expect(again[0]?.n).toBe(1);
  });

  it('reads a workspace’s own clock under row level security', async () => {
    const w = await world();
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update workspaces set time_zone = 'Asia/Kolkata' where id = ${w.workspaceId}::uuid`),
    );
    const now = await readLocalNow(w.system);
    expect(now).toBeDefined();
    expect(now?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(now?.hour).toBeGreaterThanOrEqual(0);
    expect(now?.hour).toBeLessThan(24);
  });
});

/** Every row satisfies `holds` (an empty list does). */
function every<T>(rows: readonly T[], holds: (row: T) => boolean): boolean {
  return rows.every(holds);
}
