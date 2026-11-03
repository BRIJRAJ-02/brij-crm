// The visit planner (spec 0066, AC-6603, AC-6604), pure: zones and clock changes, overnight hours, last start =
// close − hold, holds by party size, best fit and joins, pacing, any staff fairness, processing windows, buffers,
// per staff lengths, the bounds and the caps.
import type { PlaceHoursShape } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  containsSpan,
  earliestStart,
  mergeIntervals,
  partyGroups,
  planVisit,
  subtractIntervals,
  type PlanInput,
  type PlannerItem,
  type PlannerResource,
  type PlannerStaff,
} from './planner.ts';

const LONDON = 'Europe/London';
const KOLKATA = 'Asia/Kolkata';
const ALL_WEEK = (from: string, to: string): PlaceHoursShape => ({
  weekly: {
    mon: [{ from, to }],
    tue: [{ from, to }],
    wed: [{ from, to }],
    thu: [{ from, to }],
    fri: [{ from, to }],
    sat: [{ from, to }],
    sun: [{ from, to }],
  },
  exceptions: [],
});
const at = (iso: string) => new Date(iso);
const ms = (iso: string) => Date.parse(iso);
const times = (input: PlanInput) => planVisit(input).starts.map((start) => start.start.toISOString().slice(11, 16));

const table = (id: string, min: number, max: number, extra: Partial<PlannerResource> = {}): PlannerResource => ({
  id,
  kind: 'table',
  minCapacity: min,
  maxCapacity: max,
  joins: [],
  order: Number(id.replace(/\D/g, '')) || 0,
  busy: [],
  ...extra,
});

const TABLE_ITEM: PlannerItem = {
  minutes: 90,
  staff: 'none',
  needs: [{ kind: 'table', count: 1 }],
  capacityMode: 'party',
  holdBySize: [
    { size: 5, minutes: 120 },
    { size: 8, minutes: 150 },
  ],
};

/** A restaurant evening in London, 18:00 to 23:00, on Tuesday 3 Nov 2026 (GMT). */
const evening = (extra: Partial<PlanInput> = {}): PlanInput => ({
  zone: LONDON,
  hours: ALL_WEEK('18:00', '23:00'),
  staff: [],
  resources: [table('T1', 1, 2), table('T2', 2, 4), table('T3', 4, 6)],
  items: [TABLE_ITEM],
  party: 2,
  now: at('2026-11-01T09:00:00Z'),
  from: at('2026-11-03T00:00:00Z'),
  to: at('2026-11-04T00:00:00Z'),
  stepMinutes: 30,
  ...extra,
});

describe('intervals', () => {
  it('merges, subtracts and finds a span by binary search', () => {
    expect(
      mergeIntervals([
        { start: 5, end: 8 },
        { start: 0, end: 3 },
        { start: 3, end: 4 },
      ]),
    ).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 8 },
    ]);
    const free = subtractIntervals(
      [{ start: 0, end: 100 }],
      [
        { start: 10, end: 20 },
        { start: 50, end: 60 },
      ],
    );
    expect(free).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 50 },
      { start: 60, end: 100 },
    ]);
    expect(containsSpan(free, 20, 50)).toBe(true);
    expect(containsSpan(free, 19, 30)).toBe(false);
    expect(containsSpan(free, 55, 58)).toBe(false);
    expect(containsSpan([], 1, 2)).toBe(false);
  });
});

describe('tables: a party fitted to a resource (AC-6604, B7 preset)', () => {
  it('steps from opening and offers the last start at close less the hold (checklabs: last seating = close − turn)', () => {
    const offered = times(evening());
    expect(offered[0]).toBe('18:00');
    // 90 minutes for two: the last start is 21:30, never 22:00.
    expect(offered.at(-1)).toBe('21:30');
  });

  it('holds a party longer by the size thresholds, which moves the last start earlier', () => {
    const five = planVisit(evening({ party: 5 }));
    expect(five.starts.at(-1)?.start.toISOString()).toBe('2026-11-03T21:00:00.000Z');
    expect(five.starts[0]?.end.toISOString()).toBe('2026-11-03T20:00:00.000Z');
    // Eight: 150 minutes, and no single table seats eight, so T2 and T3 joined would.
    const joinedResources = [table('T1', 1, 2), table('T2', 2, 4, { joins: ['T3'] }), table('T3', 4, 6)];
    const eight = planVisit(evening({ party: 8, resources: joinedResources }));
    expect(eight.starts[0]?.end.toISOString()).toBe('2026-11-03T20:30:00.000Z');
    expect(eight.starts.at(-1)?.start.toISOString()).toBe('2026-11-03T20:30:00.000Z');
  });

  it('seats best fit: the smallest table that takes the party, then joins of up to three', () => {
    const resources = [
      table('T1', 1, 2, { joins: ['T2'] }),
      table('T2', 2, 4, { joins: ['T1', 'T3'] }),
      table('T3', 4, 6),
      table('T4', 1, 2, { joins: ['T5'] }),
      table('T5', 1, 2, { joins: ['T6'] }),
      table('T6', 1, 2),
    ];
    const byIds = (party: number) =>
      partyGroups(resources, 'table', party).map((group) => group.map((i) => resources[i]?.id).join('+'));
    expect(byIds(2)[0]).toBe('T1');
    expect(byIds(3)[0]).toBe('T2');
    expect(byIds(5)[0]).toBe('T3');
    // Seven: no single table; joined pairs and triples, the smallest total first.
    expect(byIds(7)[0]).toBe('T2+T3');
    expect(byIds(6)).toContain('T4+T5+T6');
    // A table's minimum keeps a couple off the six top.
    expect(byIds(1)).not.toContain('T3');
    const plan = planVisit(evening({ party: 2, resources }));
    expect(plan.starts[0]?.items[0]?.resourceIds).toEqual(['T1']);
  });

  it('moves to the next table when the best one is held, and offers nothing when every table is', () => {
    const busy = [{ start: ms('2026-11-03T18:00:00Z'), end: ms('2026-11-03T19:30:00Z') }];
    const plan = planVisit(evening({ resources: [table('T1', 1, 2, { busy }), table('T2', 2, 4)] }));
    expect(plan.starts[0]?.items[0]?.resourceIds).toEqual(['T2']);
    const full = planVisit(
      evening({
        resources: [table('T1', 1, 2, { busy }), table('T2', 2, 4, { busy })],
        at: at('2026-11-03T18:00:00Z'),
      }),
    );
    expect(full.starts).toEqual([]);
  });

  it('keeps tables not bookable online out of a guest’s plan', () => {
    const plan = planVisit(
      evening({ onlineOnly: true, resources: [table('T1', 1, 2, { online: false }), table('T2', 2, 4)] }),
    );
    expect(plan.starts[0]?.items[0]?.resourceIds).toEqual(['T2']);
  });

  it('caps covers by pacing: a start whose overlapping parties would pass the cap is not offered', () => {
    const booked = [{ start: ms('2026-11-03T18:00:00Z'), end: ms('2026-11-03T19:30:00Z'), party: 4 }];
    const offered = times(evening({ pacing: { coversCap: 5, booked } }));
    // 18:00 to 19:00 overlap the four already booked: 4 + 2 > 5.
    expect(offered.slice(0, 2)).toEqual(['19:30', '20:00']);
  });

  it('holds the table with the service’s buffer after (cleanup)', () => {
    const plan = planVisit(evening({ items: [{ ...TABLE_ITEM, bufferAfter: 15 }], at: at('2026-11-03T18:00:00Z') }));
    expect(plan.starts[0]?.holds).toEqual([
      { item: 0, resourceId: 'T1', start: at('2026-11-03T18:00:00Z'), end: at('2026-11-03T19:45:00Z') },
    ]);
  });
});

describe('hours on the wall clock', () => {
  it('runs a range past midnight as the day it starts on (overnight)', () => {
    const late = evening({
      hours: ALL_WEEK('20:00', '02:00'),
      from: at('2026-11-03T12:00:00Z'),
      to: at('2026-11-04T12:00:00Z'),
    });
    const offered = planVisit(late).starts.map((start) => start.start.toISOString());
    expect(offered[0]).toBe('2026-11-03T20:00:00.000Z');
    expect(offered.at(-1)).toBe('2026-11-04T00:30:00.000Z');
  });

  it('keeps starts on the wall clock across the autumn clock change', () => {
    // 25 Oct 2026: London goes from BST to GMT. 18:00 is 17:00Z on Saturday and 18:00Z on Sunday.
    const days = evening({
      now: at('2026-10-20T00:00:00Z'),
      from: at('2026-10-24T00:00:00Z'),
      to: at('2026-10-26T00:00:00Z'),
    });
    const firsts = planVisit(days).starts.filter((start) => start.start.toISOString().endsWith('00:00.000Z'));
    expect(planVisit(days).starts[0]?.start.toISOString()).toBe('2026-10-24T17:00:00.000Z');
    expect(firsts.some((start) => start.start.toISOString() === '2026-10-25T18:00:00.000Z')).toBe(true);
  });

  it('plans in the place’s own zone, whatever the server’s', () => {
    const mumbai = evening({
      zone: KOLKATA,
      hours: ALL_WEEK('10:00', '12:00'),
      from: at('2026-11-03T00:00:00Z'),
      to: at('2026-11-03T12:00:00Z'),
    });
    expect(planVisit(mumbai).starts[0]?.start.toISOString()).toBe('2026-11-03T04:30:00.000Z');
  });

  it('honours notice and the booking window', () => {
    const noticed = evening({ now: at('2026-11-03T18:10:00Z'), noticeMinutes: 60 });
    expect(times(noticed)[0]).toBe('19:30');
    expect(planVisit(evening({ now: at('2026-11-01T09:00:00Z'), windowDays: 1 })).starts).toEqual([]);
  });

  it('finds the earliest free day within 14 days, and nothing past it', () => {
    const closedWeek: PlaceHoursShape = { weekly: { sat: [{ from: '18:00', to: '23:00' }] }, exceptions: [] };
    const first = earliestStart(evening({ hours: closedWeek, to: at('2026-12-31T00:00:00Z') }));
    expect(first?.start.toISOString()).toBe('2026-11-07T18:00:00.000Z');
    const never: PlaceHoursShape = {
      weekly: {},
      exceptions: [{ date: '2026-12-01', ranges: [{ from: '18:00', to: '23:00' }] }],
    };
    expect(earliestStart(evening({ hours: never, to: at('2026-12-31T00:00:00Z') }))).toBeUndefined();
  });
});

const stylist = (id: string, order: number, extra: Partial<PlannerStaff> = {}): PlannerStaff => ({
  id,
  order,
  shifts: ALL_WEEK('09:00', '18:00'),
  busy: [],
  ...extra,
});

const CUT: PlannerItem = {
  minutes: 45,
  staff: { qualified: ['asha', 'ben', 'cy'] },
  needs: [{ kind: 'chair', count: 1 }],
};
const chair = (id: string, order: number, busy: PlannerResource['busy'] = []): PlannerResource => ({
  id,
  kind: 'chair',
  minCapacity: 1,
  maxCapacity: 1,
  joins: [],
  order,
  busy,
});

/** A salon day in London, 09:00 to 18:00, on Tuesday 3 Nov 2026. */
const salon = (extra: Partial<PlanInput> = {}): PlanInput => ({
  zone: LONDON,
  hours: ALL_WEEK('09:00', '18:00'),
  staff: [stylist('asha', 0), stylist('ben', 1), stylist('cy', 2)],
  resources: [chair('c1', 0), chair('c2', 1)],
  items: [CUT],
  party: 1,
  now: at('2026-11-01T09:00:00Z'),
  from: at('2026-11-03T00:00:00Z'),
  to: at('2026-11-04T00:00:00Z'),
  stepMinutes: 15,
  ...extra,
});

describe('staff (AC-6604)', () => {
  it('gives "any staff" to the one with the fewest booked minutes that day, ties by the business’s order', () => {
    const plan = planVisit(salon({ at: at('2026-11-03T09:00:00Z') }));
    expect(plan.starts[0]?.items[0]?.staffId).toBe('asha');
    const loaded = salon({
      at: at('2026-11-03T09:00:00Z'),
      staff: [
        stylist('asha', 0, { bookedMinutes: new Map([['2026-11-03', 120]]) }),
        stylist('ben', 1, { bookedMinutes: new Map([['2026-11-03', 60]]) }),
        stylist('cy', 2, { bookedMinutes: new Map([['2026-11-03', 60]]) }),
      ],
    });
    expect(planVisit(loaded).starts[0]?.items[0]?.staffId).toBe('ben');
  });

  it('keeps a chosen professional, and offers nothing while they are busy', () => {
    const busy = [{ start: ms('2026-11-03T09:00:00Z'), end: ms('2026-11-03T12:00:00Z') }];
    const chosen = salon({
      items: [{ ...CUT, staff: { qualified: ['asha', 'ben'], chosen: 'asha' } }],
      staff: [stylist('asha', 0, { busy }), stylist('ben', 1)],
    });
    expect(times(chosen)[0]).toBe('12:00');
  });

  it('never offers time outside a shift, nor a shift outside the opening hours unless allowed', () => {
    const early = salon({
      staff: [stylist('asha', 0, { shifts: ALL_WEEK('07:00', '10:00') })],
      items: [{ ...CUT, staff: { qualified: ['asha'] } }],
    });
    expect(times(early)).toEqual(['09:00', '09:15']);
    const prep = salon({
      hours: ALL_WEEK('07:00', '18:00'),
      staff: [stylist('asha', 0, { shifts: ALL_WEEK('07:00', '10:00'), outsideHours: true })],
      items: [{ ...CUT, staff: { qualified: ['asha'] } }],
    });
    expect(times(prep)[0]).toBe('07:00');
  });

  it('uses a staff member’s own length (senior versus junior)', () => {
    const plan = planVisit(
      salon({
        items: [{ ...CUT, staff: { qualified: ['asha'], chosen: 'asha' }, staffMinutes: new Map([['asha', 60]]) }],
        at: at('2026-11-03T09:00:00Z'),
      }),
    );
    expect(plan.starts[0]?.end.toISOString()).toBe('2026-11-03T10:00:00.000Z');
  });

  it('frees the staff member during processing while the chair stays held', () => {
    const colour: PlannerItem = {
      ...CUT,
      minutes: 90,
      processing: { after: 30, minutes: 40 },
      staff: { qualified: ['asha'] },
    };
    const plan = planVisit(salon({ items: [colour], at: at('2026-11-03T09:00:00Z') }));
    expect(
      plan.starts[0]?.holds.map((hold) => [
        hold.staffId ?? hold.resourceId,
        hold.start.toISOString().slice(11, 16),
        hold.end.toISOString().slice(11, 16),
      ]),
    ).toEqual([
      ['asha', '09:00', '09:30'],
      ['c1', '09:00', '10:30'],
      ['asha', '10:10', '10:30'],
    ]);
    // Asha's own meeting during the processing window doesn't stop the colour.
    const meeting = [{ start: ms('2026-11-03T09:40:00Z'), end: ms('2026-11-03T10:00:00Z') }];
    const busy = planVisit(
      salon({ items: [colour], staff: [stylist('asha', 0, { busy: meeting })], at: at('2026-11-03T09:00:00Z') }),
    );
    expect(busy.starts).toHaveLength(1);
  });

  it('widens holds by the buffer before and after, and refuses a start whose buffer meets a busy time', () => {
    const buffered: PlannerItem = { ...CUT, bufferBefore: 10, bufferAfter: 15, staff: { qualified: ['asha'] } };
    const plan = planVisit(salon({ items: [buffered], at: at('2026-11-03T10:00:00Z') }));
    expect(plan.starts[0]?.holds[0]).toMatchObject({
      staffId: 'asha',
      start: at('2026-11-03T09:50:00Z'),
      end: at('2026-11-03T11:00:00Z'),
    });
    const busy = [{ start: ms('2026-11-03T10:50:00Z'), end: ms('2026-11-03T11:30:00Z') }];
    expect(
      planVisit(salon({ items: [buffered], staff: [stylist('asha', 0, { busy })], at: at('2026-11-03T10:00:00Z') }))
        .starts,
    ).toEqual([]);
  });

  it('places several services back to back, each with its own professional, the scarcest first', () => {
    const wash: PlannerItem = { minutes: 15, staff: { qualified: ['asha', 'ben', 'cy'] }, needs: [] };
    const colour: PlannerItem = {
      minutes: 60,
      staff: { qualified: ['cy'] },
      needs: [{ kind: 'chair', count: 1 }],
      bufferAfter: 10,
    };
    const cut: PlannerItem = {
      minutes: 30,
      staff: { qualified: ['asha', 'ben', 'cy'] },
      needs: [{ kind: 'chair', count: 1 }],
    };
    const plan = planVisit(salon({ items: [wash, colour, cut], at: at('2026-11-03T09:00:00Z') }));
    const visit = plan.starts[0];
    expect(visit?.items.map((item) => [item.staffId, item.start.toISOString().slice(11, 16)])).toEqual([
      ['asha', '09:00'],
      ['cy', '09:15'],
      ['ben', '10:15'],
    ]);
    // The colour's chair is kept on into the cut with its cleanup clipped, never two holds of one chair that overlap.
    const chairHolds = (visit?.holds ?? []).filter((hold) => hold.resourceId === 'c1');
    for (let index = 1; index < chairHolds.length; index += 1) {
      expect(chairHolds[index]?.start.getTime()).toBeGreaterThanOrEqual(chairHolds[index - 1]?.end.getTime() ?? 0);
    }
  });

  it('keeps a recheck to the allocation offered (narrowed)', () => {
    const plan = planVisit(salon({ at: at('2026-11-03T09:00:00Z'), narrow: [{ staffId: 'cy', resourceIds: ['c2'] }] }));
    expect(plan.starts[0]?.items[0]).toMatchObject({ staffId: 'cy', resourceIds: ['c2'] });
    const gone = planVisit(
      salon({
        at: at('2026-11-03T09:00:00Z'),
        narrow: [{ staffId: 'cy', resourceIds: ['c2'] }],
        resources: [
          chair('c1', 0),
          chair('c2', 1, [{ start: ms('2026-11-03T09:00:00Z'), end: ms('2026-11-03T10:00:00Z') }]),
        ],
      }),
    );
    expect(gone.starts).toEqual([]);
  });

  it('needs every resource an item names: two of a kind, or one by id', () => {
    const facial: PlannerItem = { minutes: 60, staff: { qualified: ['asha'] }, needs: [{ kind: 'chair', count: 2 }] };
    const plan = planVisit(salon({ items: [facial], at: at('2026-11-03T09:00:00Z') }));
    expect(plan.starts[0]?.items[0]?.resourceIds).toEqual(['c1', 'c2']);
    const named: PlannerItem = { minutes: 60, staff: { qualified: ['asha'] }, needs: [{ resourceId: 'c2' }] };
    expect(
      planVisit(salon({ items: [named], at: at('2026-11-03T09:00:00Z') })).starts[0]?.items[0]?.resourceIds,
    ).toEqual(['c2']);
  });
});

describe('bounds and caps (AC-6604; the cross check)', () => {
  it('refuses more than 5 items, 60 staff or 300 resources, and a party outside 1 to 100', () => {
    expect(planVisit(salon({ items: Array.from({ length: 6 }, () => CUT) })).refused).toBe('items');
    expect(planVisit(salon({ staff: Array.from({ length: 61 }, (_, i) => stylist(`s${String(i)}`, i)) })).refused).toBe(
      'staff',
    );
    expect(
      planVisit(salon({ resources: Array.from({ length: 301 }, (_, i) => chair(`c${String(i)}`, i)) })).refused,
    ).toBe('resources');
    expect(planVisit(evening({ party: 0 })).refused).toBe('party');
  });

  it('drops a start past its tries cap as not offered, and stops the request at its cap', () => {
    const capped = planVisit(salon({ caps: { perStart: 1 } }));
    expect(capped.starts).toEqual([]);
    expect(capped.stats.startsCapped).toBeGreaterThan(0);
    const request = planVisit(salon({ caps: { perRequest: 10 } }));
    expect(request.stats.requestCapped).toBe(true);
    expect(request.starts.length).toBeLessThan(times(salon()).length);
  });
});
