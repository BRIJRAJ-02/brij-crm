// The calendar health sweep (spec 0037, AC-1310, AC-1311) over a fake queue: the mass outage hold queues none of the
// newly broken (reminders and older first emails still go) and tells Sentry once, an ordinary sweep queues one keyed job per connection owed an email, and the crontab line fires
// every quarter hour with a quarter hour of fill, so the hourly drain turn on Hobby still runs it.
import type { CalendarHealthSweep } from '@crm/db';
import { describe, expect, it } from 'vitest';
import { CALENDAR_HEALTH_CRONTAB, CALENDAR_HEALTH_EMAIL_TASK, runCalendarHealthEmailTask } from './calendar-health.ts';
import { calendarHealthSweepTask, RUNNER_TASKS } from './graphile.ts';

const WS = '0199c0de-0000-7000-8000-000000000001';
const due = (index: number, reminder = false, fresh = !reminder) => ({
  workspaceId: WS,
  connectionId: `0199c0de-0000-7000-8000-${String(index).padStart(12, '0')}`,
  episode: `2026-10-30T09:15:0${String(index)}.123456+00:00`,
  reminder,
  fresh,
});

/** Runs the sweep task once over `sweep`, answering what it queued, logged and held. */
async function sweepOnce(sweep: CalendarHealthSweep) {
  const added: { task: string; payload: unknown; key: string | undefined }[] = [];
  const warned: string[] = [];
  const held: { checked: number; newlyBroken: number }[] = [];
  const task = calendarHealthSweepTask(
    { calendarHealthDue: (max) => Promise.resolve({ ...sweep, due: sweep.due.slice(0, max) }) },
    { info: () => undefined, warn: (message) => warned.push(message) },
    (counts) => held.push(counts),
  );
  const helpers = {
    addJobs: (specs: readonly { identifier: string; payload: unknown; jobKey?: string }[]) => {
      for (const spec of specs) added.push({ task: spec.identifier, payload: spec.payload, key: spec.jobKey });
      return Promise.resolve([]);
    },
  };
  await task({}, helpers as unknown as Parameters<typeof task>[1]);
  return { added, warned, held };
}

describe('the calendar health sweep', () => {
  it('holds the newly broken when five of twelve connections broke at once, and warns once with the counts', async () => {
    const outcome = await sweepOnce({ checked: 12, newlyBroken: 5, due: [1, 2, 3, 4, 5].map((n) => due(n)) });
    expect(outcome.added).toEqual([]);
    expect(outcome.held).toEqual([{ checked: 12, newlyBroken: 5 }]);
    expect(outcome.warned).toEqual(['calendar.health.held']);
  });

  it('still sends reminders and older first emails while it holds the newly broken', async () => {
    const outcome = await sweepOnce({
      checked: 12,
      newlyBroken: 4,
      due: [due(1), due(2), due(3), due(4), due(5, false, false), due(6, true)],
    });
    expect(outcome.held).toHaveLength(1);
    expect(outcome.added.map((each) => (each.payload as { connectionId: string }).connectionId)).toEqual([
      due(5).connectionId,
      due(6).connectionId,
    ]);
  });

  it('queues one job per connection owed an email, keyed by connection, episode and which email', async () => {
    const outcome = await sweepOnce({ checked: 40, newlyBroken: 2, due: [due(1), due(2, true)] });
    expect(outcome.held).toEqual([]);
    expect(outcome.added.map((each) => each.task)).toEqual([CALENDAR_HEALTH_EMAIL_TASK, CALENDAR_HEALTH_EMAIL_TASK]);
    const { fresh: _fresh, ...payload } = due(1);
    expect(outcome.added[0]?.payload).toEqual(payload);
    expect(outcome.added[0]?.key).toBe(
      `crm-calendar-health:${WS}:${due(1).connectionId}:202610300915011234560000:first`,
    );
    expect(outcome.added[1]?.key).toMatch(/:reminder$/);
  });

  it('asks for at most 200 a sweep', async () => {
    const many = Array.from({ length: 250 }, (_, index) => due(index % 10));
    const outcome = await sweepOnce({ checked: 10_000, newlyBroken: 3, due: many });
    expect(outcome.added).toHaveLength(200);
  });

  it('does nothing when nobody is owed an email', async () => {
    expect(await sweepOnce({ checked: 0, newlyBroken: 0, due: [] })).toEqual({ added: [], warned: [], held: [] });
  });

  it('runs every quarter hour with a quarter hour of fill, and keeps a sleeping worker awake for its rows', () => {
    expect(CALENDAR_HEALTH_CRONTAB).toBe('*/15 * * * * crm_cron_calendar_health ?fill=15m&id=calendar_health&max=3');
    expect(RUNNER_TASKS).toEqual(expect.arrayContaining(['crm_cron_calendar_health', CALENDAR_HEALTH_EMAIL_TASK]));
  });

  it('drops a payload that isn’t one of its own, with a warning and no retry', async () => {
    const warned: string[] = [];
    await runCalendarHealthEmailTask(
      {
        systemScope: () => {
          throw new Error('Never entered.');
        },
        log: { info: () => undefined, warn: (message) => warned.push(message) },
      },
      { workspaceId: WS, connectionId: 'nope' },
    );
    expect(warned).toEqual(['calendar.health.payload_invalid']);
  });
});
