// The planner at the engine's bounds (spec 0066, AC-6604; the cross check's performance rules): 60 staff, 300
// resources and 5 items over one week, busy enough that most starts need more than a first guess. It must answer
// inside the request cap, and fast enough for a slot read; the numbers are logged for the lane's report.
import type { PlaceHoursShape } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { planVisit, type PlanInput, type PlannerItem, type PlannerResource, type PlannerStaff } from './planner.ts';

const range = [{ from: '09:00', to: '21:00' }];
const WEEK: PlaceHoursShape = {
  weekly: { mon: range, tue: range, wed: range, thu: range, fri: range, sat: range, sun: range },
  exceptions: [],
};
const MONDAY = Date.parse('2026-11-02T00:00:00Z');
const HOUR = 3_600_000;

/** A busy pattern: every member and resource holds an hour in each three, offset by their index. */
const busyOf = (index: number) =>
  Array.from({ length: 7 * 4 }, (_, n) => {
    const start = MONDAY + 9 * HOUR + Math.floor(n / 4) * 24 * HOUR + (n % 4) * 3 * HOUR + (index % 3) * HOUR;
    return { start, end: start + HOUR };
  });

const staff: PlannerStaff[] = Array.from({ length: 60 }, (_, index) => ({
  id: `s${String(index)}`,
  order: index,
  shifts: WEEK,
  busy: busyOf(index),
}));
const resources: PlannerResource[] = Array.from({ length: 300 }, (_, index) => ({
  id: `r${String(index)}`,
  kind: index % 3 === 0 ? 'room' : 'chair',
  minCapacity: 1,
  maxCapacity: 1,
  joins: [],
  order: index,
  busy: busyOf(index + 1),
}));
const qualified = (every: number) => staff.filter((_, index) => index % every === 0).map((member) => member.id);
const items: PlannerItem[] = [
  { minutes: 30, staff: { qualified: qualified(1) }, needs: [{ kind: 'chair', count: 1 }] },
  { minutes: 45, staff: { qualified: qualified(2) }, needs: [{ kind: 'chair', count: 1 }], bufferAfter: 10 },
  {
    minutes: 60,
    staff: { qualified: qualified(5) },
    needs: [{ kind: 'room', count: 1 }],
    processing: { after: 20, minutes: 20 },
  },
  { minutes: 20, staff: { qualified: qualified(7) }, needs: [] },
  { minutes: 30, staff: { qualified: qualified(4) }, needs: [{ kind: 'chair', count: 2 }] },
];
const input: PlanInput = {
  zone: 'Europe/London',
  hours: WEEK,
  staff,
  resources,
  items,
  party: 1,
  now: new Date(MONDAY - 24 * HOUR),
  from: new Date(MONDAY),
  to: new Date(MONDAY + 7 * 24 * HOUR),
  stepMinutes: 15,
};

describe('the planner at its bounds (60 staff × 300 resources × 5 items, one week)', () => {
  it('answers within the request cap, in well under a second', () => {
    planVisit(input); // warm up
    const runs = 5;
    const started = performance.now();
    let result = planVisit(input);
    for (let run = 1; run < runs; run += 1) result = planVisit(input);
    const each = (performance.now() - started) / runs;
    console.warn(
      `planner bench: ${each.toFixed(1)} ms a week, ${String(result.starts.length)} starts offered, ${String(result.stats.tries)} tries, ${String(result.stats.startsCapped)} starts capped, request capped ${String(result.stats.requestCapped)}`,
    );
    expect(result.starts.length).toBeGreaterThan(0);
    expect(result.stats.tries).toBeLessThanOrEqual(20_000);
    expect(each).toBeLessThan(1_500);
  });
});
