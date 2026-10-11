// The report (spec 0011, AC-199 to AC-201, AC-203, AC-204): the measured
// window's samples and server samples become one table of lines, each with
// its target, p50, p95, p99, max, count and verdict; the run judges its own
// validity; and the exit code follows: 0 every judged line passes, 1 a budget
// miss in a gate scenario, 2 an invalid run. Every target comes from
// `SCALE_BUDGET`, and from nowhere else.
import type { ScaleBudget } from '@crm/core/scale-budget';
import type { LiveOutput } from './drive.ts';
import { trailingMisses } from './live/stream.ts';
import type { RelayLags } from './outbox.ts';
import type { LoadResult, ReportLine, RunValidity, Verdict } from './result.ts';
import { summarize, type Summary } from './stats.ts';
import { ACTION_METRICS, type Metric, type Sample } from './user.ts';

/** The run's exit codes. */
export const EXIT = { pass: 0, miss: 1, invalid: 2, refused: 3 } as const;

/** The longest the harness's own event loop may stall at p99 before a run is invalid, in milliseconds. */
export const MAX_LOOP_DELAY_P99_MS = 50;
/** The least share of planned actions a valid run sends on time. */
export const MIN_SENT_SHARE = 0.95;

/** What the lines are made from: the measured samples, and the server's own samples. */
export interface ReportInput {
  readonly budget: ScaleBudget;
  /** Measured samples only. */
  readonly samples: readonly Sample[];
  /** PgBouncer's `maxwait` every 5 seconds, in milliseconds, or undefined when it couldn't be read. */
  readonly poolerWaitMs: readonly number[] | undefined;
  /** Postgres's CPU every 5 seconds as a share of its cap (0 to 1), or undefined off the load stack. */
  readonly postgresCpuShares: readonly number[] | undefined;
  /** The API container's CPU the same way, reported beside Postgres's; undefined off the load stack. */
  readonly apiCpuShares?: readonly number[] | undefined;
  /** What the live clients and the outbox said (milestone 3); undefined when the run had no live clients. */
  readonly live?: LiveInput;
  /** The storm's extra lines (AC-207): edits inside bursts and the reconnect. */
  readonly storm?: boolean;
}

/** What the live lines are made from (AC-200, AC-201). */
export interface LiveInput {
  /** The database's clock minus ours: joins `at` and `created_at` to the harness's clock. */
  readonly clockOffsetMs: number;
  /** Each measured event arrival, raw: our arrival time minus `at` on the database's clock. */
  readonly arrivalsRawMs: readonly number[];
  readonly users: readonly LiveOutput[];
  /** The relay lag of every outbox row committed in the window, or undefined when the outbox couldn't be read. */
  readonly relay: RelayLags | undefined;
  /**
   * The workspace's head when the window opened, and its last seq committed
   * at least 10 seconds before the window closed: the seqs every subscriber
   * must have heard of by then.
   */
  readonly heads: { readonly start: number; readonly end: number } | undefined;
}

/** Below this many samples a line's p95 rests on its few slowest: its verdict carries a note saying so. */
export const FEW_SAMPLES = 100;

const round = (value: number) => Math.round(value * 10) / 10;

function rounded(summary: Summary | undefined): Summary | undefined {
  if (summary === undefined) return undefined;
  return {
    count: summary.count,
    p50: round(summary.p50),
    p95: round(summary.p95),
    p99: round(summary.p99),
    max: round(summary.max),
  };
}

/** A judged line: p95 at or under `target` passes. */
function judged(metric: string, values: readonly number[], target: number, unit: 'ms' | '%'): ReportLine {
  const summary = rounded(summarize(values));
  const verdict: Verdict = summary === undefined ? 'no samples' : summary.p95 <= target ? 'pass' : 'miss';
  const few = summary !== undefined && summary.count < FEW_SAMPLES;
  return {
    metric,
    target: `p95 ≤ ${String(target)}${unit === 'ms' ? ' ms' : '%'}`,
    unit,
    ...(summary === undefined ? {} : { summary }),
    verdict,
    judged: true,
    ...(few ? { note: `only ${String(summary.count)} samples: a direction, not a measure` } : {}),
  };
}

/** A reported line: numbers, no verdict. */
function reported(metric: string, values: readonly number[], unit: 'ms' | 'count' = 'ms', note?: string): ReportLine {
  const summary = rounded(summarize(values));
  return {
    metric,
    unit,
    ...(summary === undefined ? {} : { summary }),
    verdict: summary === undefined ? 'no samples' : 'reported',
    judged: false,
    ...(note === undefined ? {} : { note }),
  };
}

/** A line with no number yet, saying why. */
function without(metric: string, verdict: 'not measured' | 'not built yet', note: string, target?: string) {
  return { metric, ...(target === undefined ? {} : { target }), unit: 'ms' as const, verdict, judged: false, note };
}

/** A line that is one number. */
const countSummary = (value: number) => ({ count: value, p50: value, p95: value, p99: value, max: value });

/** The successful samples of a live metric that made a request. */
const liveOk = (samples: readonly Sample[], metric: Metric) =>
  samples.filter((sample) => sample.metric === metric && sample.outcome === 'ok' && sample.requests > 0);

/**
 * Live delivery (AC-200): each holder's refetch, from the write's commit
 * (`at`, moved to our clock) to the refetch's answer, for events that came
 * live; those Centrifugo's recovery replayed or a catch up answered are
 * reported apart. Scheduled to visible joins each refetch to its writer's
 * scheduled moment by `mutationId`; arrival is every subscriber's commit to
 * arrival time.
 */
export function deliveryLines(budget: ScaleBudget, samples: readonly Sample[], live: LiveInput): readonly ReportLine[] {
  const offset = live.clockOffsetMs;
  const deliveries = liveOk(samples, 'delivery').filter((sample) => sample.atMs !== undefined);
  const visible = (sample: Sample) => sample.answeredAt - (sample.atMs ?? 0) + offset;
  const writers = new Map<string, number>();
  for (const sample of samples) {
    if (sample.mutationId !== undefined && sample.metric !== 'delivery')
      writers.set(sample.mutationId, sample.scheduledAt);
  }
  const scheduledToVisible = deliveries.flatMap((sample) => {
    const scheduledAt = sample.mutationId === undefined ? undefined : writers.get(sample.mutationId);
    return scheduledAt === undefined ? [] : [sample.answeredAt - scheduledAt];
  });
  return [
    judged(
      'live delivery (commit to visible)',
      deliveries.filter((sample) => sample.via === 'live').map(visible),
      budget.p95Ms.liveDelivery,
      'ms',
    ),
    reported(
      'scheduled to visible',
      scheduledToVisible,
      'ms',
      "from the writer's scheduled moment to each holder's refetch",
    ),
    reported(
      'event arrival (commit to each subscriber)',
      live.arrivalsRawMs.map((raw) => raw + offset),
    ),
    reported(
      'delivery after recovery or catch up',
      deliveries.filter((sample) => sample.via !== 'live').map(visible),
      'ms',
      'not judged: the gap is the point',
    ),
    reported(
      'settle (window and count reread)',
      liveOk(samples, 'settle').map(durationOf),
      'ms',
      'after a create, delete or reorder of the view',
    ),
  ];
}

/** Relay lag (AC-201): `published_at` minus `created_at` of every outbox row committed in the window. */
export function relayLine(budget: ScaleBudget, relay: RelayLags | undefined): ReportLine {
  if (relay === undefined) return without('relay lag', 'not measured', 'the outbox could not be read');
  const line = judged('relay lag', relay.lagsMs, budget.p95Ms.relayLag, 'ms');
  if (relay.unpublished === 0) return line;
  const note = `${String(relay.unpublished)} rows never published`;
  return { ...line, verdict: 'miss', note: line.note === undefined ? note : `${line.note}; ${note}` };
}

/**
 * The live streams' books (AC-200): missed seqs (judged: a gate must miss
 * none), seqs caught up and recovered, and the events each user applied, with
 * the share it discarded as another object's (spec 0007's AC-91).
 */
export function streamLines(live: LiveInput): readonly ReportLine[] {
  const sum = (pick: (output: LiveOutput) => number) => live.users.reduce((total, output) => total + pick(output), 0);
  const trailing =
    live.heads === undefined
      ? 0
      : sum((output) => trailingMisses(output.snapshot, live.heads?.end ?? 0, live.heads?.start ?? 0));
  const missed = sum((output) => output.tally.missed) + trailing;
  const records = sum((output) => output.tally.recordsEvents);
  const discarded = sum((output) => output.tally.discarded);
  const share = records + discarded === 0 ? 0 : discarded / (records + discarded);
  return [
    {
      metric: 'missed seqs',
      target: '0',
      unit: 'count',
      summary: countSummary(missed),
      verdict: missed === 0 ? 'pass' : 'miss',
      judged: true,
      note: `no event, stub or catch up within 10 s${trailing > 0 ? `; ${String(trailing)} never heard of by the end` : ''}`,
    },
    {
      metric: 'seqs caught up (realtime.catchUp)',
      unit: 'count',
      summary: countSummary(sum((output) => output.tally.caughtUp)),
      verdict: 'reported',
      judged: false,
      note: `${String(sum((output) => output.tally.catchUpCalls))} catch up calls, ${String(sum((output) => output.tally.resets))} answered reset`,
    },
    {
      metric: 'seqs recovered by Centrifugo',
      unit: 'count',
      summary: countSummary(sum((output) => output.tally.recovered)),
      verdict: 'reported',
      judged: false,
    },
    {
      metric: 'events applied',
      unit: 'count',
      summary: countSummary(sum((output) => output.tally.applied)),
      verdict: 'reported',
      judged: false,
      note: `${String(sum((output) => output.tally.ownEchoes))} own echoes skipped, ${String(sum((output) => output.tally.stubs))} stubs, ${String(discarded)} of another object discarded (${(share * 100).toFixed(1)}% of records events)`,
    },
  ];
}

/** How long a sample took: from its scheduled moment to its answer (never from when it was sent). */
export const durationOf = (sample: Sample): number => sample.answeredAt - sample.scheduledAt;

/** The times of a metric's successful samples; one that sent no request (nothing to wait for) isn't a time. */
const okTimes = (samples: readonly Sample[], metric: Metric, filter: (sample: Sample) => boolean = () => true) =>
  samples
    .filter((sample) => sample.metric === metric && sample.outcome === 'ok' && sample.requests > 0 && filter(sample))
    .map(durationOf);

/** The report's lines (AC-199, AC-201). */
export function reportLines(input: ReportInput): readonly ReportLine[] {
  const { budget, samples } = input;
  const p95 = budget.p95Ms;
  const poolMs = samples.flatMap((sample) => sample.poolMs);
  const appMs = samples.flatMap((sample) => sample.appMs);
  const cpu = input.postgresCpuShares?.map((share) => share * 100);
  const apiCpu = input.apiCpuShares?.map((share) => share * 100);
  return [
    judged('read (scroll, filter or sort windows)', okTimes(samples, 'read'), p95.read, 'ms'),
    judged('open a record', okTimes(samples, 'open'), p95.open, 'ms'),
    judged(
      'edit',
      okTimes(samples, 'edit', (sample) => sample.burst !== true),
      p95.edit,
      'ms',
    ),
    judged('create', okTimes(samples, 'create'), p95.create, 'ms'),
    reported(
      'read by position',
      okTimes(samples, 'read', (sample) => sample.mode === 'position'),
    ),
    reported(
      'read by cursor',
      okTimes(samples, 'read', (sample) => sample.mode === 'cursor'),
    ),
    reported('count', okTimes(samples, 'count'), 'ms', 'not judged'),
    reported('API handler time per request', appMs, 'ms', 'Server-Timing app: the server side of every request'),
    ...(input.live === undefined
      ? [
          without(
            'live delivery (commit to visible)',
            'not measured',
            'no live clients',
            `p95 ≤ ${String(p95.liveDelivery)} ms`,
          ),
        ]
      : deliveryLines(budget, samples, input.live)),
    poolMs.length > 0
      ? judged('API pool wait', poolMs, p95.poolWait, 'ms')
      : without('API pool wait', 'not measured', 'no Server-Timing header: is LOAD_TIMING=on?'),
    input.poolerWaitMs === undefined
      ? without('pooler wait (PgBouncer maxwait)', 'not measured', 'SHOW POOLS could not be read')
      : judged('pooler wait (PgBouncer maxwait)', input.poolerWaitMs, p95.poolWait, 'ms'),
    cpu === undefined
      ? without('Postgres CPU', 'not measured', 'off the load stack: no container to sample')
      : judged('Postgres CPU', cpu, budget.postgresCpuP95Share * 100, '%'),
    ...(apiCpu === undefined ? [] : [{ ...reported('API CPU', apiCpu), unit: '%' as const }]),
    input.live === undefined
      ? without('relay lag', 'not measured', 'no live clients', `p95 ≤ ${String(p95.relayLag)} ms`)
      : relayLine(budget, input.live.relay),
    ...(input.live === undefined ? [] : streamLines(input.live)),
    ...(input.storm === true ? stormLines(budget, samples, input.live?.users ?? []) : []),
  ];
}

/**
 * The storm's lines (AC-207): the edits sent inside bursts, judged at p95
 * against the edit target (the storm exits by validity only, so the verdict
 * is for #41), and the reconnect: from the moment every connection dropped to
 * the last user back, recovered by Centrifugo or caught up through the API.
 * Missed seqs (which must be 0) are the stream's own line.
 */
export function stormLines(
  budget: ScaleBudget,
  samples: readonly Sample[],
  users: readonly LiveOutput[],
): readonly ReportLine[] {
  const reconnects = users.flatMap((output) => (output.reconnected === undefined ? [] : [output.reconnected]));
  const back = reconnects.flatMap((each) => (each.backAt === undefined ? [] : [each.backAt - each.droppedAt]));
  const how = (name: string) => reconnects.filter((each) => each.how === name).length;
  const never = reconnects.length - back.length;
  const summary = rounded(summarize(back));
  return [
    judged(
      'edit inside bursts',
      okTimes(samples, 'edit', (sample) => sample.burst === true),
      budget.p95Ms.edit,
      'ms',
    ),
    {
      metric: 'reconnect: drop to back (max: every user back)',
      unit: 'ms',
      ...(summary === undefined ? {} : { summary }),
      verdict: never > 0 ? 'miss' : summary === undefined ? 'no samples' : 'reported',
      judged: false,
      note: `${String(reconnects.length)} dropped: ${String(how('recovered'))} recovered by Centrifugo, ${String(how('caughtUp'))} caught up, ${String(how('reset'))} reset, ${String(never)} never back`,
    },
  ];
}

/** Counts of the measured window's answers by class and reason. */
export function errorCounts(samples: readonly Sample[]) {
  // The share is of actions; a count, a live refetch or a live call (a token, a catch up, a dropped connection)
  // that failed unexpectedly counts as an error too, and a count the harness aborted itself (a newer view replaced
  // it) is neither.
  const actions = samples.filter((sample) => ACTION_METRICS.has(sample.metric));
  const unexpected = samples.filter((sample) => sample.outcome === 'unexpected');
  const byReason: Record<string, number> = {};
  for (const sample of unexpected) {
    const reason = sample.reason ?? 'unknown';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return {
    actions: actions.length,
    unexpected: unexpected.length,
    expected: actions.filter((sample) => sample.outcome === 'expected').length,
    tooMany: samples.filter((sample) => sample.reason?.startsWith('429') === true).length,
    abortedCounts: samples.filter((sample) => sample.metric === 'count' && sample.outcome === 'aborted').length,
    byReason,
  };
}

/** The error lines: unexpected (judged by validity), expected refusals and 429s (reported). */
export function errorLines(samples: readonly Sample[], budget: ScaleBudget): readonly ReportLine[] {
  const counts = errorCounts(samples);
  const share = counts.actions === 0 ? 0 : counts.unexpected / counts.actions;
  const limit = budget.unexpectedErrorShare * 100;
  const count = (value: number) => ({ count: value, p50: value, p95: value, p99: value, max: value });
  return [
    {
      metric: 'unexpected errors',
      target: `≤ ${String(limit)}% of actions`,
      unit: 'count',
      summary: count(counts.unexpected),
      verdict: share <= budget.unexpectedErrorShare ? 'pass' : 'miss',
      judged: false,
      note: `${(share * 100).toFixed(3)}% of ${String(counts.actions)} actions; over the limit the run is invalid`,
    },
    {
      metric: 'expected refusals (409, 422)',
      unit: 'count',
      summary: count(counts.expected),
      verdict: 'reported',
      judged: false,
    },
    {
      metric: '429 too many requests',
      unit: 'count',
      summary: count(counts.tooMany),
      verdict: 'reported',
      judged: false,
      note: 'unexpected: a person would see this refusal',
    },
    {
      metric: 'counts aborted by a newer view',
      unit: 'count',
      summary: count(counts.abortedCounts),
      verdict: 'reported',
      judged: false,
    },
  ];
}

/** What validity is judged on. */
export interface ValidityInput {
  readonly budget: ScaleBudget;
  readonly samples: readonly Sample[];
  readonly plannedActions: number;
  readonly sentActions: number;
  /** Each thread's event loop delay p99 over the measured window, main thread included. */
  readonly eventLoopDelayP99Ms: readonly number[];
}

/** Whether the run counts (AC-203): the harness kept up, and unexpected errors stayed under the budget's share. */
export function judgeValidity(input: ValidityInput): RunValidity {
  const reasons: string[] = [];
  const worstLoop = Math.max(0, ...input.eventLoopDelayP99Ms);
  if (worstLoop > MAX_LOOP_DELAY_P99_MS) {
    reasons.push(
      `the harness couldn't keep up: an event loop stalled ${worstLoop.toFixed(1)} ms at p99 (limit ${String(MAX_LOOP_DELAY_P99_MS)} ms)`,
    );
  }
  const sentShare = input.plannedActions === 0 ? 1 : input.sentActions / input.plannedActions;
  if (sentShare < MIN_SENT_SHARE) {
    reasons.push(
      `the harness couldn't keep up: it sent ${String(input.sentActions)} of ${String(input.plannedActions)} planned actions on time (${(sentShare * 100).toFixed(1)}%, needs ${String(MIN_SENT_SHARE * 100)}%)`,
    );
  }
  const counts = errorCounts(input.samples);
  const unexpectedShare = counts.actions === 0 ? 0 : counts.unexpected / counts.actions;
  if (unexpectedShare > input.budget.unexpectedErrorShare) {
    const reasons_ = Object.entries(counts.byReason)
      .sort((left, right) => right[1] - left[1])
      .map(([reason, count]) => `${reason} ×${String(count)}`)
      .join(', ');
    reasons.push(
      `unexpected errors were ${(unexpectedShare * 100).toFixed(3)}% of actions (limit ${String(input.budget.unexpectedErrorShare * 100)}%): ${reasons_}`,
    );
  }
  return {
    valid: reasons.length === 0,
    reasons,
    plannedActions: input.plannedActions,
    sentActions: input.sentActions,
    eventLoopDelayP99Ms: input.eventLoopDelayP99Ms.map(round),
    unexpectedShare,
  };
}

/** The exit code (AC-203): invalid 2; a judged miss in a gate scenario 1; otherwise 0. */
export function exitCodeOf(validity: RunValidity, lines: readonly ReportLine[], gate: boolean): number {
  if (!validity.valid) return EXIT.invalid;
  if (gate && lines.some((line) => line.judged && line.verdict === 'miss')) return EXIT.miss;
  return EXIT.pass;
}

const pad = (text: string, width: number) => text.padEnd(width);
const padStart = (text: string, width: number) => text.padStart(width);

function number(value: number | undefined, unit: ReportLine['unit']): string {
  if (value === undefined) return '';
  if (unit === 'count') return String(value);
  return value.toFixed(1);
}

/** The printed table (AC-204): metric, target, p50, p95, p99, max, count, verdict, then the run's facts. */
export function formatReport(result: LoadResult): string {
  const rows = result.lines.map((line) => {
    const s = line.summary;
    const showPercentiles = line.unit !== 'count';
    return [
      line.metric,
      line.target ?? '',
      showPercentiles ? number(s?.p50, line.unit) : '',
      showPercentiles ? number(s?.p95, line.unit) : '',
      showPercentiles ? number(s?.p99, line.unit) : '',
      showPercentiles ? number(s?.max, line.unit) : '',
      s === undefined ? '' : String(s.count),
      line.verdict.toUpperCase() + (line.note === undefined ? '' : `  (${line.note})`),
    ];
  });
  const header = ['metric', 'target', 'p50', 'p95', 'p99', 'max', 'count', 'verdict'];
  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((row) => (index === 7 ? 0 : (row[index] ?? '').length))),
  );
  const line = (row: readonly string[]) =>
    row
      .map((cell, index) =>
        index === 7
          ? cell
          : index >= 2 && index <= 6
            ? padStart(cell, widths[index] ?? 0)
            : pad(cell, widths[index] ?? 0),
      )
      .join('  ');
  const facts = result.facts;
  const gb = (bytes: number | undefined) => (bytes === undefined ? '?' : `${(bytes / 1024 ** 3).toFixed(1)} GB`);
  const caps = Object.entries(facts.stackCaps)
    .map(
      ([service, cap]) =>
        `${service} ${cap.cpus === 0 ? 'uncapped' : `${String(cap.cpus)} CPU`}/${gb(cap.memoryBytes)}`,
    )
    .join(', ');
  const counts = Object.entries(facts.manifestCounts)
    .map(([key, count]) => `${key} ${count.live.toLocaleString('en')} live of ${count.stored.toLocaleString('en')}`)
    .join(', ');
  const mix = Object.entries(result.mix.achieved)
    .map(([action, share]) => `${action} ${(share * 100).toFixed(1)}%`)
    .join(', ');
  const out = [
    '',
    line(header),
    line(header.map((_, index) => '-'.repeat(index === 7 ? 7 : (widths[index] ?? 0)))),
    ...rows.map(line),
    '',
    `scenario ${result.scenario} (${result.gate ? 'gate' : 'reported, exits by validity only'}), ${String(result.users)} users, ${String(result.minutes)} measured minutes after ${String(result.warmupSeconds)} s of warm up, seed ${String(result.seed)}`,
    `run ${result.startedAt} to ${result.endedAt}, git ${facts.gitCommit}, API ${facts.apiUrl}, ${String(facts.threads)} thread(s)`,
    `host ${facts.hostModel}, ${String(facts.hostCores)} cores, ${gb(facts.hostMemoryBytes)}; Docker ${facts.dockerCpus === undefined ? '?' : String(facts.dockerCpus)} CPUs, ${gb(facts.dockerMemoryBytes)}`,
    `stack caps: ${caps === '' ? 'not on the load stack' : caps}`,
    `database clock offset: ${facts.databaseClockOffsetMs === undefined ? '?' : `${facts.databaseClockOffsetMs.toFixed(1)} ms`}`,
    `manifest (${facts.manifestProfile}): ${counts}`,
    `mix achieved: ${mix} (largest gap ${(result.mix.deviationPoints * 100).toFixed(2)} points)`,
    `actions: ${String(result.validity.sentActions)} sent of ${String(result.validity.plannedActions)} planned; event loop p99 ${result.validity.eventLoopDelayP99Ms.map((ms) => `${ms.toFixed(1)} ms`).join(', ')}`,
    `WAL written: ${result.walBytes === undefined ? 'not measured' : `${(result.walBytes / 1024 ** 2).toFixed(1)} MB`}`,
  ];
  if (Object.keys(result.errors).length > 0) {
    out.push(
      `unexpected errors: ${Object.entries(result.errors)
        .map(([reason, count]) => `${reason} ×${String(count)}`)
        .join(', ')}`,
    );
  }
  if (result.topStatements === undefined) {
    out.push('top statements: not measured (pg_stat_statements is not on)');
  } else {
    out.push('top statements by total time:');
    for (const statement of result.topStatements) {
      const text = statement.query.replace(/\s+/g, ' ').slice(0, 160);
      out.push(
        `  ${statement.totalMs.toFixed(0).padStart(8)} ms  ${String(statement.calls).padStart(7)} calls  ${statement.meanMs.toFixed(2).padStart(8)} ms mean  ${text}`,
      );
    }
  }
  out.push(
    result.validity.valid
      ? `VALID. Exit ${String(result.exitCode)}${result.exitCode === EXIT.miss ? ': a budget miss in a gate scenario' : ''}.`
      : `INVALID (exit ${String(result.exitCode)}): ${result.validity.reasons.join('; ')}.`,
  );
  return out.join('\n');
}
