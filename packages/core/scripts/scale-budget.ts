// The CRM's speed targets and the load model, in one place (spec 0011, AC-192).
// The load harness (`packages/load`, from milestone 2) reads every target it
// judges against, and the load model it drives, from this constant and from
// nowhere else, so a target changes here and every run follows.

/** The CRM's scale targets and load model (spec 0011). The load harness judges every run against these, and only these. */
export const SCALE_BUDGET = {
  /** People online at once: `gate` is what `steady` and `spread` judge; `room` is what `thousand` pushes (#41 judges it). */
  online: { gate: 100, room: 1_000 },
  /** Live records in one workspace at the target, equal to the engine's own limit (`LIMITS.liveRecords`). */
  recordsPerWorkspace: 1_000_000,
  /**
   * p95 targets in milliseconds, each measured end to end from the action's scheduled moment.
   * `liveDelivery`: from the write's commit (the event's `at`) to the change visible to each holder (spec 0007 AC-78).
   * `poolWait`: the API's wait for a database client, and PgBouncer's `maxwait`.
   * `relayLag`: an outbox row's `published_at` minus its `created_at`.
   */
  p95Ms: { read: 300, open: 200, edit: 250, create: 300, liveDelivery: 1_000, poolWait: 50, relayLag: 250 },
  /** Postgres CPU at p95 (5 second samples), as a share of its cap. */
  postgresCpuP95Share: 0.7,
  /** Unexpected errors (5xx, timeouts, dropped connections, any 401 or 429) as a share of all actions. */
  unexpectedErrorShare: 0.001,
  /** The load model: each user's open model arrival rate, and which action each arrival is. */
  load: {
    actionsPerUserPerSecond: 0.2,
    mix: { scroll: 0.6, filterSort: 0.15, open: 0.1, edit: 0.12, create: 0.03 },
  },
} as const;

/** The type of `SCALE_BUDGET`, for code that takes a budget (tests pass a stricter one). */
export type ScaleBudget = typeof SCALE_BUDGET;

/** One action kind of the load model's mix. */
export type LoadAction = keyof ScaleBudget['load']['mix'];
