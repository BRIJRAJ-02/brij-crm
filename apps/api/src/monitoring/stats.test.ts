// The worker's stats reporter (spec 0010, AC-180 to AC-182): once a minute,
// from memory only, `worker.awake`, the relay's backlog while awake, one
// `RELAY_LAGGING` per episode of two slow awake ticks, and a heartbeat at
// every tick, awake or asleep. The sleep test runs it against a real dormant
// relay on the test Postgres and the real Sentry wrapper with a fake transport.
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { createOutboxReader, openDirectConnection } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { memoryTransport } from '../../test/sentry.ts';
import { createRelay, type Relay } from '../realtime/relay.ts';
import { createRelayStats } from '../realtime/stats.ts';
import {
  captureFault,
  flush,
  heartbeat,
  metrics,
  raiseIssue,
  startSentry,
  type IssueCode,
  type MetricName,
} from './sentry.ts';
import {
  createLagSample,
  createStatsReporter,
  relaySource,
  type StatsReporter,
  type StatsReporterDeps,
} from './stats.ts';

const { adminUrl, workerUrl } = inject('testDatabase');
const MINUTE = 60_000;

const reporters: StatsReporter[] = [];
const relays: Relay[] = [];
afterEach(async () => {
  for (const reporter of reporters.splice(0)) reporter.stop();
  for (const relay of relays.splice(0)) await relay.stop();
  vi.useRealTimers();
});

/** A reporter on fakes: what it records, raises, checks in and warns, and a switch for awake. */
function fakeReporter(overrides: Partial<StatsReporterDeps> = {}) {
  const gauges: { name: MetricName; value: number }[] = [];
  const distributions: { name: MetricName; value: number }[] = [];
  const raised: { code: IssueCode; numbers: Readonly<Record<string, number>> }[] = [];
  const warnings: { message: string; fields: Record<string, unknown> }[] = [];
  const state = { awake: true, checkIns: 0 };
  const reporter = createStatsReporter({
    sources: [],
    metrics: {
      gauge: (name, value) => gauges.push({ name, value }),
      distribution: (name, value) => distributions.push({ name, value }),
    },
    heartbeat: () => {
      state.checkIns += 1;
    },
    raise: (code, numbers) => raised.push({ code, numbers }),
    isAwake: () => state.awake,
    log: { warn: (message, fields = {}) => warnings.push({ message, fields }) },
    ...overrides,
  });
  reporters.push(reporter);
  return { reporter, gauges, distributions, raised, warnings, state };
}

/** Relay stats on a clock the test moves (starting at `now`), holding `count` rows, the oldest committed at `committedAt`. */
function stuckRelay(count: number, committedAt: number, now: number) {
  const clock = { now };
  const stats = createRelayStats({ now: () => clock.now });
  stats.pending('workspace-a', count, new Date(committedAt).toISOString());
  return { clock, stats };
}

describe('the stats reporter', () => {
  it('ticks at start and once a minute, recording worker.awake and the relay’s backlog while awake (AC-180)', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const start = Date.parse('2026-10-13T09:00:00Z');
    const relay = stuckRelay(7, start - 4_000, start);
    const { reporter, gauges, state } = fakeReporter({
      sources: [relaySource(() => relay.stats.snapshot())],
    });
    reporter.start();
    expect(gauges).toEqual([
      { name: 'worker.awake', value: 1 },
      { name: 'outbox.pending', value: 7 },
      { name: 'outbox.oldest_age_s', value: 4 },
    ]);
    expect(state.checkIns).toBe(1);

    // A stuck relay's oldest row keeps ageing from its commit time.
    relay.clock.now = start + MINUTE;
    vi.advanceTimersByTime(MINUTE);
    expect(gauges.slice(3)).toEqual([
      { name: 'worker.awake', value: 1 },
      { name: 'outbox.pending', value: 7 },
      { name: 'outbox.oldest_age_s', value: 64 },
    ]);
    expect(state.checkIns).toBe(2);
    reporter.stop();
    vi.advanceTimersByTime(5 * MINUTE);
    expect(state.checkIns).toBe(2);
  });

  it('sends the backlog as 0 with nothing waiting', () => {
    const source = relaySource(() => createRelayStats().snapshot());
    expect(source()).toEqual({ 'outbox.pending': 0, 'outbox.oldest_age_s': 0 });
  });

  it('asleep, records worker.awake 0 and checks in, and reads no source and sends no outbox gauge', () => {
    const source = vi.fn(() => ({ 'outbox.pending': 3 }));
    const { reporter, gauges, state, raised } = fakeReporter({ sources: [source] });
    state.awake = false;
    reporter.start();
    expect(gauges).toEqual([{ name: 'worker.awake', value: 0 }]);
    expect(source).not.toHaveBeenCalled();
    expect(state.checkIns).toBe(1);
    expect(raised).toEqual([]);
  });

  it('raises RELAY_LAGGING once per episode of two slow awake ticks in a row, with the two numbers (AC-182)', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const ages: (number | undefined)[] = [];
    let age: number | undefined = 20;
    const { reporter, raised, warnings, state } = fakeReporter({
      sources: [
        () => {
          ages.push(age);
          return age === undefined ? {} : { 'outbox.pending': 12, 'outbox.oldest_age_s': age };
        },
      ],
    });
    const tickWith = (next: number | undefined, awake = true) => {
      age = next;
      state.awake = awake;
      vi.advanceTimersByTime(MINUTE);
    };
    reporter.start(); // 20 s: fine
    tickWith(31); // slow once
    expect(raised).toEqual([]);
    tickWith(91); // slow twice: raised
    expect(raised).toEqual([{ code: 'RELAY_LAGGING', numbers: { pending: 12, oldest_age_s: 91 } }]);
    expect(warnings).toContainEqual({ message: 'relay.lagging', fields: { pending: 12, oldest_age_s: 91 } });
    tickWith(151); // the same episode: nothing more
    tickWith(30); // exactly 30 is not over: the episode ends
    tickWith(45);
    tickWith(105); // a second episode
    expect(raised).toHaveLength(2);
    // An asleep tick ends a run of slow ticks too.
    tickWith(200);
    tickWith(260, false);
    tickWith(320);
    expect(raised).toHaveLength(2);
    expect(state.checkIns).toBe(10);
  });

  it('raises RELAY_LAGGING again every hour an episode lasts, so auto resolve never closes it meanwhile', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { reporter, raised } = fakeReporter({
      sources: [() => ({ 'outbox.pending': 4, 'outbox.oldest_age_s': 600 })],
    });
    reporter.start(); // slow once
    vi.advanceTimersByTime(MINUTE); // slow twice: raised
    expect(raised).toHaveLength(1);
    vi.advanceTimersByTime(59 * MINUTE);
    expect(raised).toHaveLength(1);
    vi.advanceTimersByTime(MINUTE); // an hour of slow ticks later
    expect(raised).toHaveLength(2);
  });

  it('records the relay’s lag values gathered since the last tick as relay.lag, awake or asleep (AC-179)', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const lag = createLagSample();
    const { reporter, distributions, state } = fakeReporter({ lag });
    lag.add([12, 40]);
    reporter.start();
    expect(distributions).toEqual([
      { name: 'relay.lag', value: 12 },
      { name: 'relay.lag', value: 40 },
    ]);
    // Rows published just before the worker fell asleep still go out.
    lag.add([7]);
    state.awake = false;
    vi.advanceTimersByTime(MINUTE);
    expect(distributions.slice(2)).toEqual([{ name: 'relay.lag', value: 7 }]);
    vi.advanceTimersByTime(MINUTE);
    expect(distributions).toHaveLength(3);
    // Stopping records what came since the last tick.
    lag.add([99]);
    reporter.stop();
    expect(distributions.slice(3)).toEqual([{ name: 'relay.lag', value: 99 }]);
  });

  it('checks in even when a source, a gauge or the issue throws, and says which step failed', () => {
    const { reporter, state, warnings } = fakeReporter({
      sources: [
        () => {
          throw new Error('source broke');
        },
      ],
      metrics: {
        gauge: () => {
          throw new Error('gauge broke');
        },
        distribution: () => undefined,
      },
    });
    reporter.start();
    expect(state.checkIns).toBe(1);
    expect(warnings.map((warning) => warning.fields.step)).toEqual(['worker.awake', 'source 0']);
  });

  it('never lets a failing heartbeat stop the tick', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { reporter, gauges } = fakeReporter({
      heartbeat: () => {
        throw new Error('heartbeat broke');
      },
    });
    expect(() => {
      reporter.start();
      vi.advanceTimersByTime(MINUTE);
    }).not.toThrow();
    expect(gauges.filter((gauge) => gauge.name === 'worker.awake')).toHaveLength(2);
  });
});

describe('the lag sample', () => {
  it('keeps every value up to its size, then a uniform sample of that size, and starts afresh at each drain', () => {
    const sample = createLagSample({ size: 100 });
    sample.add(Array.from({ length: 80 }, (_, index) => index));
    expect(sample.drain()).toEqual(Array.from({ length: 80 }, (_, index) => index));
    expect(sample.drain()).toEqual([]);

    // 100,000 values, 1 to 100,000: the sample keeps 100, spread across the whole range.
    for (let start = 1; start <= 100_000; start += 1_000) {
      sample.add(Array.from({ length: 1_000 }, (_, index) => start + index));
    }
    const kept = [...sample.drain()].sort((a, b) => a - b);
    expect(kept).toHaveLength(100);
    const median = kept[49] ?? 0;
    expect(median).toBeGreaterThan(30_000);
    expect(median).toBeLessThan(70_000);
  });

  it('costs little per row in a burst', () => {
    const sample = createLagSample();
    const rows = Array.from({ length: 100 }, () => 42);
    const started = performance.now();
    for (let turn = 0; turn < 2_000; turn += 1) sample.add(rows);
    // 200,000 rows: well under a microsecond each.
    expect(performance.now() - started).toBeLessThan(200);
    expect(sample.drain()).toHaveLength(500);
  });
});

/** How many connections a relay named `applicationName` holds open. */
async function connections(applicationName: string): Promise<number> {
  const rows = await testQuery<{ open: number }>(
    adminUrl,
    'select count(*)::int as open from pg_stat_activity where application_name = $1',
    [applicationName],
  );
  return rows[0]?.open ?? 0;
}

describe('a sleeping worker (AC-180, AC-181)', () => {
  it('checks in ten times over ten ticks, sends worker.awake 0 each time, no outbox gauge and no issue, with no database connection', async () => {
    const transport = memoryTransport();
    startSentry({
      dsn: 'https://public@o1.ingest.de.sentry.io/1',
      environment: 'production',
      release: 'abc1234',
      service: 'worker',
      deliver: transport.deliver,
    });
    const name = `crm-stats-sleep-${randomUUID().slice(0, 8)}`;
    let connects = 0;
    const relay = createRelay({
      connect: async () => {
        connects += 1;
        return createOutboxReader(
          await openDirectConnection({ url: workerUrl, applicationName: name, proveListen: false }),
        );
      },
      audiences: () => Promise.resolve([]),
      // Whatever other tests left waiting goes out at once.
      publishBatch: (items) => Promise.resolve({ published: items.length }),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      pollScheduleMs: [50],
      dormantAfterMs: 300,
      retryMs: 10,
      maxRetryMs: 20,
      prune: false,
    });
    relays.push(relay);
    relay.start();
    await expect.poll(() => relay.mode(), { timeout: 10_000, interval: 25 }).toBe('dormant');
    await expect.poll(() => connections(name), { timeout: 10_000, interval: 25 }).toBe(0);
    const connectsAsleep = connects;
    transport.clear();

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const reporter = createStatsReporter({
      sources: [relaySource(() => relay.stats())],
      metrics,
      heartbeat,
      raise: raiseIssue,
      isAwake: () => relay.mode() === 'active',
      log: { warn: () => undefined },
    });
    reporters.push(reporter);
    reporter.start(); // the first tick
    vi.advanceTimersByTime(9 * MINUTE); // nine more
    vi.useRealTimers();
    await flush(2000);

    const checkIns = transport.checkIns();
    expect(checkIns).toHaveLength(10);
    expect(checkIns.every((checkIn) => checkIn.monitor_slug === 'worker-heartbeat' && checkIn.status === 'ok')).toBe(
      true,
    );
    expect(checkIns[0]).toMatchObject({
      environment: 'production',
      monitor_config: { schedule: { type: 'interval', value: 1, unit: 'minute' }, checkin_margin: 2 },
    });
    const sent = transport.metrics();
    expect(sent.map((metric) => [metric.name, metric.value])).toEqual(
      Array.from({ length: 10 }, () => ['worker.awake', 0]),
    );
    expect(transport.events()).toEqual([]);
    expect(relay.mode()).toBe('dormant');
    expect(connects).toBe(connectsAsleep);
    expect(await connections(name)).toBe(0);
  });
});

describe('the heartbeat and RELAY_LAGGING through the wrapper', () => {
  it('checks in only in production', async () => {
    for (const environment of ['preview', 'local'] as const) {
      const transport = memoryTransport();
      startSentry({
        dsn: 'https://public@o1.ingest.de.sentry.io/1',
        environment,
        release: 'r',
        service: 'worker',
        deliver: transport.deliver,
      });
      heartbeat();
      await flush(2000);
      expect(transport.checkIns()).toEqual([]);
    }
  });

  it('raises a warning with one fixed fingerprint and its numbers, and nothing of a request around it', async () => {
    const transport = memoryTransport();
    startSentry({
      dsn: 'https://public@o1.ingest.de.sentry.io/1',
      environment: 'production',
      release: 'abc1234',
      service: 'worker',
      deliver: transport.deliver,
    });
    raiseIssue('RELAY_LAGGING', { pending: 12, oldest_age_s: 91 });
    await flush(2000);
    const [event] = transport.events();
    expect(event).toMatchObject({
      level: 'warning',
      fingerprint: ['RELAY_LAGGING'],
      tags: { service: 'worker', code: 'RELAY_LAGGING' },
      contexts: { numbers: { pending: 12, oldest_age_s: 91 } },
    });
    expect(event?.message).toContain('over 30 seconds');
    // Raised again (an hour later, or a later episode), it isn't dropped as a duplicate; other events still are.
    raiseIssue('RELAY_LAGGING', { pending: 12, oldest_age_s: 91 });
    // The same fault twice from one place: the second is a duplicate.
    for (let time = 0; time < 2; time += 1) captureFault(new Error('the same fault'), { task: 'relay' });
    await flush(2000);
    expect(transport.events().filter((sent) => sent.fingerprint?.[0] === 'RELAY_LAGGING')).toHaveLength(2);
    expect(transport.events().filter((sent) => sent.fingerprint === undefined)).toHaveLength(1);
    expect(event?.user).toBeUndefined();
    // No host name: on a laptop it often names its owner.
    expect(event).not.toHaveProperty('server_name');
  });
});
