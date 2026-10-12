// What a run writes to `.load/results/<scenario>-<time>.json` (spec 0011,
// AC-204): the same table and facts it prints, as one `LoadResult`, so runs
// can be compared later and by a reviewer.
import * as z from 'zod';

/** A line's verdict: judged lines pass or miss; the rest are reported, or say why they have no number. */
export const Verdict = z.enum(['pass', 'miss', 'reported', 'no samples', 'not measured', 'not built yet']);
export type Verdict = z.infer<typeof Verdict>;

/** A set of times (or shares) summed up. */
export const LineSummary = z.object({
  count: z.number().int().min(0),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
  max: z.number(),
});
export type LineSummary = z.infer<typeof LineSummary>;

/** One line of the report: what it measures, its target, its numbers and its verdict. */
export const ReportLine = z.object({
  metric: z.string(),
  /** How the target reads in the table (`p95 ≤ 300 ms`), absent for a reported line. */
  target: z.string().optional(),
  /** The unit the numbers are in. */
  unit: z.enum(['ms', '%', 'count']),
  summary: LineSummary.optional(),
  verdict: Verdict,
  /** Whether a miss here fails a gate run. */
  judged: z.boolean(),
  note: z.string().optional(),
});
export type ReportLine = z.infer<typeof ReportLine>;

/** One of the statements with the most total time in the measured window. */
export const StatementLine = z.object({
  query: z.string(),
  calls: z.number(),
  totalMs: z.number(),
  meanMs: z.number(),
  rows: z.number(),
});
export type StatementLine = z.infer<typeof StatementLine>;

/** Where and on what a run ran. */
export const RunFacts = z.object({
  gitCommit: z.string(),
  hostModel: z.string(),
  hostCores: z.number().int(),
  hostMemoryBytes: z.number(),
  dockerCpus: z.number().optional(),
  dockerMemoryBytes: z.number().optional(),
  /** Each load stack container's caps, by service: CPUs and memory bytes (0 when uncapped). */
  stackCaps: z.record(z.string(), z.object({ cpus: z.number(), memoryBytes: z.number() })),
  /** The database's clock minus ours, in milliseconds, averaged over the start and the end. */
  databaseClockOffsetMs: z.number().optional(),
  /** How far the offset moved from the start to the end, in milliseconds: a drifting clock shows here. */
  databaseClockDriftMs: z.number().optional(),
  /** The manifest's records per object: stored and live. */
  manifestCounts: z.record(z.string(), z.object({ stored: z.number(), live: z.number() })),
  manifestProfile: z.string(),
  apiUrl: z.string(),
  threads: z.number().int(),
});
export type RunFacts = z.infer<typeof RunFacts>;

/** A run's verdict on itself: valid, or why not. */
export const RunValidity = z.object({
  valid: z.boolean(),
  reasons: z.array(z.string()),
  plannedActions: z.number().int(),
  sentActions: z.number().int(),
  eventLoopDelayP99Ms: z.array(z.number()),
  unexpectedShare: z.number(),
});
export type RunValidity = z.infer<typeof RunValidity>;

/** One whole run (AC-204). */
export const LoadResult = z.object({
  scenario: z.string(),
  gate: z.boolean(),
  users: z.number().int(),
  minutes: z.number(),
  warmupSeconds: z.number(),
  seed: z.number().int(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
  facts: RunFacts,
  lines: z.array(ReportLine),
  /** The budget's mix and the mix the measured window achieved, by action, and the largest gap in points. */
  mix: z.object({
    budget: z.record(z.string(), z.number()),
    achieved: z.record(z.string(), z.number()),
    deviationPoints: z.number(),
  }),
  /** Unexpected errors by reason (`500 INTERNAL`, `timeout`, `dropped`), measured window only. */
  errors: z.record(z.string(), z.number()),
  topStatements: z.array(StatementLine).optional(),
  walBytes: z.number().optional(),
  validity: RunValidity,
  exitCode: z.number().int(),
});
export type LoadResult = z.infer<typeof LoadResult>;
