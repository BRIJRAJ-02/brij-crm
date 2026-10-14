// The outbox relay (spec 0005, change events), run by the worker. Only the
// relay holding the advisory lock publishes. It works in rounds: each round
// takes one batch from every workspace with something waiting, up to 4
// workspaces at a time and each workspace strictly in turn, so one busy
// workspace can't hold up the rest. A workspace's batch is its unpublished
// rows in `seq` order, published to `workspace:<id>` in one Centrifugo call
// (each with the idempotency key `<workspace>:<seq>`), then marked up to the
// first failure, so nothing is skipped; a full batch gets another turn next
// round. A workspace whose publish failed waits before its next turn, 1
// second doubling to 60, whatever polls or notifications name it meanwhile,
// and its failures are logged at most once a minute, with the count. A
// failing workspace isn't work: its rows found by a poll or a retry don't hold
// the quiet clock back, so it can't keep Neon awake. The relay stays active
// while a retry is still backing off, but once every failing workspace waits
// the longest and has failed for longer than the quiet spell, it logs an error
// and goes dormant anyway, keeping them; the next wake tries them first.
//
// Neon bills compute by the hour and suspends it after 5 minutes without a
// query, so the relay lets the database sleep while nothing is written:
// - Active: LISTEN on `crm_outbox` on the direct connection, plus a safety
//   poll that backs off over a quiet spell (1, 2, 5, 15, then every 60
//   seconds) and starts again at 1 second on any notification, poke or row.
//   A relay without the lock doesn't LISTEN (notifications are the leader's
//   business); it tries for the lock on the same backing off timer, a poke
//   brings its next try forward, and it goes dormant after the same quiet
//   spell. Taking the lock, it LISTENs, then polls.
// - Dormant: after 3 minutes with no rows found and no notification, it
//   closes the connection (which unlistens and lets go of the lock) and makes
//   no database call at all. A connection lost before the quiet spell is over
//   (a restart, a network blip) reconnects with backoff; one lost after it
//   (Neon suspending the compute) goes dormant rather than waking it again.
// - Waking: the api pokes the worker after a write commits (`wake.ts`), and
//   `wake()` reconnects, drains, and listens again. At boot it drains once,
//   then follows the same rules. A lost poke only delays delivery until the
//   next poke from any write: the rows wait in the outbox, and the next drain
//   publishes them in order.
// A query that fails while connected reconnects with backoff (1, 2, 4 up to
// 30 seconds), and goes dormant instead once the quiet spell has passed. The
// backoff starts again from 1 second only after a connection stayed healthy
// for 30 seconds, so a connection that fails as soon as it opens backs off.
// A database error in one workspace's turn costs only that workspace: it is
// logged and the workspace backs off as after a failed publish.
//
// Left for the load harness (#12) to measure, at 1,000 online:
// - `pg_notify` takes a cluster wide lock at commit, so every write that
//   notifies commits one after another, across workspaces. If that shows,
//   drop the NOTIFY from the hook and let the api's poke make the next poll
//   due at once (the poke already reaches the relay after every write).
// - A round is a barrier: the next round starts only when every turn in this
//   one is done, so one slow workspace (a slow Centrifugo call, a big batch)
//   holds up the rest. A continuous queue, where a lane takes the next ready
//   workspace as soon as its turn ends, removes that head of line wait.
//
// Delivery numbers (spec 0007, AC-77): Postgres answers each marked row's lag
// from commit to publish, and the relay keeps a rolling 5 minute window of
// them with what it still holds unpublished (`stats.ts`). While active it logs
// them as `relay.stats` once a minute, from memory, so the log costs no query;
// `stats()` hands the same numbers to the worker's `/health`. Each marked row's
// lag also goes to `deps.lag`, which the worker records as the `relay.lag`
// metric (spec 0010, AC-179).
//
// Retention (spec 0007, milestone 3, AC-89, AC-90): while active and holding
// the lock, the relay prunes in rounds, one batch (`pruneOutbox`, up to
// 10,000 published rows made more than `OUTBOX_RETENTION`, 24 hours, ago)
// after a publish pass, so publishing never waits behind more than one batch.
// A pass is a loop turn that already reached Postgres (a poll, or a round with
// a workspace in it), so the prune never wakes the database, and it isn't
// work, so it never keeps the relay awake. A round is due from the start of an
// awake period, and then `PRUNE_EVERY_MS` (10 minutes) after the last ended;
// it starts on a quiet pass (nothing to publish), so a write that woke the
// worker goes out before any prune on a cold cache, or on any pass once it has
// been due for another 10 minutes. It goes on, a batch a pass, while batches
// come back full, and ends with a short one, a slow one (over 250 ms) or a
// failure (logged). Dormant, it prunes nothing; spec 0008's
// daily cleanup calls the same `pruneOutbox`. Only a relay on the worker's
// login (`crm_worker`) may prune: on any other the worker turns it off.
//
// Audiences (spec 0007, milestone 2, AC-85): each row is planned through spec
// 0009's `filterEvent` for its workspace's audience (`workspaceEvent` in
// `@crm/core`). The relay reads a workspace's audiences at its first turn and
// keeps them until it goes dormant; a batch stops after a `members` or
// `access` row, which drops them, so the rows after it are planned with them
// read again. One channel per workspace until milestone 4: a workspace with
// more than one audience fails its turn rather than share one copy.
import { type ChangeEvent, workspaceChannel } from '@crm/contracts';
import { AUDIENCES_NEED_CHANNELS, isAudiencesNeedChannels, workspaceEvent, type Audience } from '@crm/core';
import { PRUNE_BATCH, type OutboxReader, type OutboxRow } from '@crm/db';
import { errorFields } from '../log.ts';
import type { PublishBatch } from './centrifugo.ts';
import { createRelayStats, type RelayStats, type RelayStatsSnapshot } from './stats.ts';

type Fields = Record<string, unknown>;

/** Where the relay reports what it does. */
export interface RelayLog {
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
}

export interface RelayDeps {
  /** Opens a fresh direct connection as an outbox reader; called again after one drops or the relay wakes. */
  readonly connect: () => Promise<OutboxReader>;
  /**
   * A workspace's audiences (spec 0009's `audiences`, read with the relay's
   * system scope). Loaded once per workspace while the relay is awake, and
   * again after a `members` or `access` row (AC-85).
   */
  readonly audiences: (workspaceId: string) => Promise<readonly Audience[]>;
  readonly publishBatch: PublishBatch;
  readonly log: RelayLog;
  /**
   * The safety poll's waits over a quiet spell, the last repeating (default
   * 1, 2, 5, 15 and 60 seconds). Any notification, poke or row found starts
   * it again from the first.
   */
  readonly pollScheduleMs?: readonly number[];
  /** How long with no rows found and no notification before the relay goes dormant (default 3 minutes). */
  readonly dormantAfterMs?: number;
  /** The first wait before reconnecting after a failure, doubled each failed try (default 1 second). */
  readonly backoffMs?: number;
  /** The longest wait before reconnecting (default 30 seconds). */
  readonly maxBackoffMs?: number;
  /** How long a connection must last before the reconnect backoff starts again from the first wait (default 30 seconds). */
  readonly healthyMs?: number;
  /** The most rows read from one workspace at a time, one Centrifugo call (default 100). */
  readonly batch?: number;
  /** How many workspaces' batches run at once (default 4). Each workspace's own batches never overlap. */
  readonly concurrency?: number;
  /**
   * Whether the relay prunes the outbox: true only on a direct login in
   * `crm_worker`, the one group that may run `crm_outbox_prune`. Required,
   * so no caller prunes on a login it hasn't checked.
   */
  readonly prune: boolean;
  /** The least time from the end of one prune round to the start of the next while awake (default 10 minutes). */
  readonly pruneEveryMs?: number;
  /** The most rows one prune batch deletes (default `PRUNE_BATCH`, 10,000); a full batch carries the round on. */
  readonly pruneBatch?: number;
  /** The most workspaces one poll asks for (default 500, the definer function's own cap). */
  readonly workspacesPerPoll?: number;
  /** A workspace's first wait after a failed publish, doubled each failure in a row (default 1 second). */
  readonly retryMs?: number;
  /** A workspace's longest wait after failed publishes (default 60 seconds). */
  readonly maxRetryMs?: number;
  /**
   * Hears each marked row's lag from commit to publish, in ms, as Postgres
   * answered it in the mark (`published_at - created_at`), one value per row:
   * the worker records them as `relay.lag` (spec 0010, AC-179).
   */
  readonly lag?: (lagsMs: readonly number[]) => void;
  /** Where the delivery numbers go (a fresh `createRelayStats()` by default). */
  readonly stats?: RelayStats;
  /** How often an active relay logs `relay.stats` (default 1 minute). */
  readonly statsEveryMs?: number;
}

/** `active` while it holds a connection, `dormant` while it makes no database call, `stopped` otherwise. */
export type RelayMode = 'active' | 'dormant' | 'stopped';

export interface Relay {
  /** Starts the loop, active: it drains once, then follows the rules. Calling it again does nothing. */
  start(): void;
  /**
   * A write committed (the api's poke): wakes a dormant relay, or brings an
   * active one's next look forward to the first poll wait. Never throws.
   */
  wake(): void;
  /** Where the relay is now. */
  mode(): RelayMode;
  /**
   * The delivery numbers over the last 5 minutes, from memory (the worker's
   * `/health` and the stats tick). The oldest pending age is also at least how
   * long a failing workspace has failed, and how long work has waited for a
   * relay that hasn't reached Postgres since (a failed connect).
   */
  stats(): RelayStatsSnapshot;
  /** How many workspaces' audiences the relay holds now (for tests and #12's measurements). */
  cachedAudiences(): number;
  /** Stops after the publish in flight, closes the connection (letting go of the lock) and waits for the loop. */
  stop(): Promise<void>;
}

/** The safety poll's default waits: 1, 2, 5, 15 seconds, then every minute. */
export const POLL_SCHEDULE_MS: readonly number[] = [1_000, 2_000, 5_000, 15_000, 60_000];

/** The default quiet spell before the relay goes dormant: 3 minutes, inside Neon's 5 minute suspend timeout. */
export const DORMANT_AFTER_MS = 180_000;

/** The least time between the end of one prune round and the start of the next while awake (spec 0007, `PRUNE_EVERY`). */
export const PRUNE_EVERY_MS = 600_000;

/**
 * A prune batch slower than this ends its round even when full (measured: 45 to 80 ms for 10,000 rows locally,
 * on outboxes of 200,000 and 1.2 million rows), so a slow database costs publishing one batch a round, not a
 * round of them. AC-78's relay lag target is 250 ms at p95.
 */
const PRUNE_SLOW_MS = 250;

/**
 * The event for one outbox row on `workspace:<id>` (spec 0007's
 * `ChangeEvent`, by kind): ids only, with its commit time `at`, `mutationId`
 * and `coarse` only when set, planned through spec 0009's `filterEvent` for
 * the workspace's audience (so a job's or a private view's id goes only to an
 * audience whose every member may read it), and never the job starter. A
 * malformed row, or one that leaves nothing, goes out as the stub, so the
 * channel's `seq`s stay gap free (`workspaceEvent` in `@crm/core`).
 */
export function changeEvent(row: OutboxRow, audiences: readonly Audience[]): ChangeEvent {
  return workspaceEvent(row, audiences);
}

/** A row after which the workspace's audiences may differ: the cache drops them before the next row (AC-85). */
const changesAudiences = (row: OutboxRow): boolean => row.kind === 'members' || row.kind === 'access';

/** The least time between two warnings about one workspace's failed publishes. */
const WARN_EVERY_MS = 60_000;

/** A workspace waiting after failed publishes: how many in a row, and when it may try again. */
interface Retry {
  readonly failures: number;
  /** When it may try again. */
  readonly at: number;
  /** The wait before `at`: at `maxRetryMs`, it waits the longest. */
  readonly waitMs: number;
  /** When the first failure in a row happened. */
  readonly since: number;
}

/** How one connection's session ended. */
type SessionEnd =
  { readonly reason: 'stopped' } | { readonly reason: 'quiet' } | { readonly reason: 'lost'; readonly error: Error };

/** The relay, with everything it touches passed in. */
export function createRelay(deps: RelayDeps): Relay {
  const schedule =
    deps.pollScheduleMs !== undefined && deps.pollScheduleMs.length > 0 ? deps.pollScheduleMs : POLL_SCHEDULE_MS;
  const dormantAfterMs = deps.dormantAfterMs ?? DORMANT_AFTER_MS;
  const backoffMs = deps.backoffMs ?? 1_000;
  const maxBackoffMs = deps.maxBackoffMs ?? 30_000;
  const healthyMs = deps.healthyMs ?? 30_000;
  const batch = deps.batch ?? 100;
  const concurrency = Math.max(1, deps.concurrency ?? 4);
  const pruning = deps.prune;
  const pruneEveryMs = deps.pruneEveryMs ?? PRUNE_EVERY_MS;
  const pruneBatch = Math.min(Math.max(1, deps.pruneBatch ?? PRUNE_BATCH), PRUNE_BATCH);
  const workspacesPerPoll = deps.workspacesPerPoll ?? 500;
  const retryMs = deps.retryMs ?? 1_000;
  const maxRetryMs = deps.maxRetryMs ?? 60_000;
  const stats = deps.stats ?? createRelayStats();
  const statsEveryMs = deps.statsEveryMs ?? 60_000;
  const { log } = deps;
  // When recording a lag last failed and was warned about (at most once a minute).
  let lagWarnedAt = Number.NEGATIVE_INFINITY;
  /** Rows marked: their lags go to the rolling stats and to `deps.lag`, which can never fail a turn. */
  const published = (lagsMs: readonly number[]): void => {
    stats.published(lagsMs);
    if (lagsMs.length === 0 || deps.lag === undefined) return;
    try {
      deps.lag(lagsMs);
    } catch (error) {
      if (Date.now() - lagWarnedAt < WARN_EVERY_MS) return;
      lagWarnedAt = Date.now();
      log.warn('Recording the relay lag failed', errorFields(error));
    }
  };
  // Since when work has waited for the relay to reach Postgres at all: set at boot and by a poke, cleared by a
  // poll that answered (or a lock another relay holds). A relay that can't connect, while the api keeps writing
  // and poking, reads no row, so this is what shows its backlog growing (spec 0010, AC-180).
  let unservedSince: number | undefined;
  // Whether a poke set it (work really waits), or only the boot did.
  let unservedByWake = false;
  /**
   * The rolling numbers, with the oldest pending age at least as long as a
   * failing workspace has failed, or as work has waited unserved: a turn that
   * throws before it reads, or a relay that can't connect, still shows its
   * backlog ageing.
   */
  const report = (): RelayStatsSnapshot => {
    const snapshot = stats.snapshot();
    const since = Math.min(
      unservedSince ?? Number.POSITIVE_INFINITY,
      ...[...retries.values()].map((retry) => retry.since),
    );
    if (since === Number.POSITIVE_INFINITY) return snapshot;
    return { ...snapshot, oldestPendingMs: Math.max(snapshot.oldestPendingMs ?? 0, Date.now() - since) };
  };
  const served = (): void => {
    unservedSince = undefined;
    unservedByWake = false;
  };

  // The loop's own state, read through functions where an await sits between a write and a read.
  let stopped = true;
  const halted = (): boolean => stopped;
  let current: RelayMode = 'stopped';
  let running: Promise<void> | undefined;
  // The quiet clock: when the relay last saw a sign of work (a row, a notification, a poke).
  let lastWork = 0;
  // Where the safety poll is in its schedule: 0 after any sign of work.
  let step = 0;
  // Set by a poke; cleared when the relay decides to go dormant, so only a poke after that wakes it.
  let woken = false;
  const isWoken = (): boolean => woken;
  // Cuts the current wait short: a notification, a poke, a lost connection, or stop().
  let interrupt = (): void => undefined;
  // True while waiting to reconnect after a failure: a poke then only marks the relay woken, and the backoff runs
  // its course, so a burst of writes can't hammer a database that is failing.
  let backingOff = false;
  // Workspaces waiting after failed publishes, and when each was last warned about.
  const retries = new Map<string, Retry>();
  const warnedAt = new Map<string, number>();
  // Each workspace's audiences, for the awake period (AC-85): loaded at its first turn, dropped after a `members`
  // or `access` row and when the relay goes dormant. A load that fails is forgotten, so the next turn asks again.
  const audienceCache = new Map<string, Promise<readonly Audience[]>>();
  // Workspaces already reported as needing a channel per audience in this awake period.
  const splitWarned = new Set<string>();
  // The prune's rounds in this awake period (AC-89): when the next may start (the awake period's start, then
  // `pruneEveryMs` after the last ended), and the round still open after a full batch, with what it has deleted.
  let pruneRound: {
    readonly dueAt: number;
    readonly open: { readonly pruned: number; readonly batches: number } | undefined;
  } = { dueAt: Date.now(), open: undefined };
  // When each workspace last took a turn: one quiet for a whole quiet spell lets go of its audiences, so a busy
  // worker that never goes dormant holds only the workspaces that write.
  const audienceUsed = new Map<string, number>();
  function audiencesOf(workspaceId: string): Promise<readonly Audience[]> {
    const now = Date.now();
    for (const [id, at] of audienceUsed) {
      if (now - at < dormantAfterMs) continue;
      audienceUsed.delete(id);
      audienceCache.delete(id);
    }
    audienceUsed.set(workspaceId, now);
    const held = audienceCache.get(workspaceId);
    if (held !== undefined) return held;
    const loading = deps.audiences(workspaceId);
    audienceCache.set(workspaceId, loading);
    loading.catch(() => {
      if (audienceCache.get(workspaceId) === loading) audienceCache.delete(workspaceId);
    });
    return loading;
  }

  /** Waits `ms` (forever when undefined), or until something calls `interrupt`. */
  function sleep(ms: number | undefined): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (timer !== undefined) clearTimeout(timer);
        interrupt = () => undefined;
        resolve();
      };
      if (ms !== undefined) timer = setTimeout(done, Math.max(0, ms));
      interrupt = done;
    });
  }

  /** A sign of work: the quiet clock starts again and the poll goes back to its first wait. */
  function sawWork(): void {
    lastWork = Date.now();
    step = 0;
  }

  /** A failing workspace the relay may go dormant with: waiting the longest, and failing for a whole quiet spell. */
  const stuck = (retry: Retry, now: number): boolean =>
    retry.waitMs >= maxRetryMs && now - retry.since >= dormantAfterMs;

  // Not while a workspace still backs off toward the longest wait: it may yet get through.
  const quiet = (): boolean => {
    const now = Date.now();
    return now - lastWork >= dormantAfterMs && [...retries.values()].every((retry) => stuck(retry, now));
  };

  /** True when the workspace may take a turn now: not waiting after a failure. */
  const ready = (workspaceId: string): boolean => (retries.get(workspaceId)?.at ?? 0) <= Date.now();

  /**
   * Puts a workspace in its backoff after a failed publish or a database
   * error in its turn, and warns at most once a minute about it.
   */
  function failed(workspaceId: string, seq: number | undefined, error: unknown, what: 'publish' | 'database'): void {
    const now = Date.now();
    const before = retries.get(workspaceId);
    const failures = (before?.failures ?? 0) + 1;
    const retryInMs = Math.min(retryMs * 2 ** (failures - 1), maxRetryMs);
    retries.set(workspaceId, { failures, at: now + retryInMs, waitMs: retryInMs, since: before?.since ?? now });
    const last = warnedAt.get(workspaceId);
    if (last !== undefined && now - last < WARN_EVERY_MS) return;
    for (const [id, at] of warnedAt) if (now - at >= WARN_EVERY_MS) warnedAt.delete(id);
    warnedAt.set(workspaceId, now);
    const message =
      what === 'publish'
        ? 'Publishing changes failed; retrying the workspace with backoff'
        : 'Reading or marking changes failed; retrying the workspace with backoff';
    log.warn(message, {
      workspaceId,
      failures,
      retryInMs,
      seq,
      ...errorFields(error),
    });
  }
  const pollWait = (): number => schedule[Math.min(step, schedule.length - 1)] ?? 1_000;

  /**
   * One workspace's turn: publishes a batch with one call (the rows held from
   * its last turn, or a fresh read), then marks what landed and reads the next
   * batch in the same round trip. Returns that next batch when there is one,
   * so the workspace gets another turn next round.
   */
  async function turn(
    reader: OutboxReader,
    workspaceId: string,
    held: readonly OutboxRow[] | undefined,
  ): Promise<readonly OutboxRow[] | undefined> {
    const read = held ?? (await reader.pending(workspaceId, batch));
    // Up to and including the first row that may change who is in which audience: the rows after it are planned
    // with the audiences loaded again (AC-85), from the next batch the mark reads.
    const cut = read.findIndex(changesAudiences);
    const rows = cut === -1 ? read : read.slice(0, cut + 1);
    if (rows.length === 0) {
      retries.delete(workspaceId);
      stats.pending(workspaceId, 0);
      return undefined;
    }
    // A failing workspace's rows aren't work until they go out.
    // Read and not yet published, until the publish below says otherwise: a turn that throws from here on
    // (audiences, planning, the mark) leaves its rows counted as waiting.
    stats.pending(workspaceId, rows.length, rows[0]?.at);
    const retrying = retries.has(workspaceId);
    if (!retrying) sawWork();
    const channel = workspaceChannel(workspaceId);
    const audiences = await audiencesOf(workspaceId);
    const outcome = await deps.publishBatch(
      rows.map((row) => ({
        channel,
        data: changeEvent(row, audiences),
        idempotencyKey: `${workspaceId}:${String(row.seq)}`,
      })),
    );
    // The row that may change the audiences went out: the next one is planned with them read again.
    if (cut !== -1 && outcome.published > cut) audienceCache.delete(workspaceId);
    const landed = rows[outcome.published - 1];
    if (outcome.error !== undefined) {
      failed(workspaceId, rows[outcome.published]?.seq, outcome.error, 'publish');
      stats.pending(workspaceId, rows.length - outcome.published, rows[outcome.published]?.at);
      if (landed !== undefined) {
        // One failure, already counted: a mark that fails too is only noted (what landed goes out again on the
        // retry, and its idempotency key drops the repeat).
        try {
          published((await reader.mark(workspaceId, landed.seq)).lagsMs);
        } catch (error) {
          log.warn('Marking the part of a failed batch that landed failed; it is sent again on the retry', {
            workspaceId,
            ...errorFields(error),
          });
        }
      }
      return undefined;
    }
    retries.delete(workspaceId);
    if (retrying) sawWork();
    const last = rows[rows.length - 1];
    if (last === undefined) return undefined;
    const next = await reader.advance(workspaceId, last.seq, batch);
    published(next.lagsMs);
    stats.pending(workspaceId, next.rows.length, next.rows[0]?.at);
    return next.rows.length > 0 ? next.rows : undefined;
  }

  /**
   * One round: a turn for each workspace, up to `concurrency` at a time.
   * Returns the workspaces with more waiting, and their next batch. A turn
   * that throws (a database error) puts only its workspace in backoff.
   */
  async function round(
    reader: OutboxReader,
    workspaces: ReadonlyMap<string, readonly OutboxRow[] | undefined>,
  ): Promise<Map<string, readonly OutboxRow[]>> {
    const more = new Map<string, readonly OutboxRow[]>();
    const queue = [...workspaces];
    let next = 0;
    const lane = async () => {
      for (;;) {
        if (halted()) return;
        const entry = queue[next];
        next += 1;
        if (entry === undefined) return;
        const [workspaceId, held] = entry;
        try {
          const rows = await turn(reader, workspaceId, held);
          if (rows !== undefined) more.set(workspaceId, rows);
        } catch (error) {
          // Access rules split the workspace before it has a channel per audience: say so, once per awake period.
          if (isAudiencesNeedChannels(error) && !splitWarned.has(workspaceId)) {
            splitWarned.add(workspaceId);
            log.error('A workspace has more than one audience; live updates wait for a channel per audience', {
              workspaceId,
              code: AUDIENCES_NEED_CHANNELS,
            });
          }
          failed(workspaceId, held?.[0]?.seq, error, 'database');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, lane));
    return more;
  }

  /**
   * After a publish pass: one prune batch, when a round is open (the last
   * batch was full), or when one is due (from the start of the awake period,
   * or `pruneEveryMs` after the last ended) and this pass was quiet (nothing
   * to publish), or due for another `pruneEveryMs` already, so a relay that
   * never has a quiet pass still prunes. A short batch or a failure ends the
   * round, and the round's total is logged once.
   */
  async function pruneAfterPass(reader: OutboxReader, quietPass: boolean): Promise<void> {
    if (!pruning) return;
    const round = pruneRound;
    const now = Date.now();
    if (round.open === undefined && (now < round.dueAt || (!quietPass && now < round.dueAt + pruneEveryMs))) return;
    const before = round.open ?? { pruned: 0, batches: 0 };
    let full = false;
    let pruned = 0;
    let failure: unknown;
    const started = Date.now();
    try {
      pruned = await reader.prune(pruneBatch);
      full = pruned >= pruneBatch;
    } catch (error) {
      failure = error;
    }
    // A batch slower than PRUNE_SLOW_MS (dead index entries a long snapshot keeps, a cold cache) ends the round
    // even when full, so publishing waits behind at most one slow batch each round.
    const slow = Date.now() - started > PRUNE_SLOW_MS;
    const sofar = { pruned: before.pruned + pruned, batches: before.batches + 1 };
    if (full && !slow) {
      pruneRound = { dueAt: round.dueAt, open: sofar };
      return;
    }
    pruneRound = { dueAt: Date.now() + pruneEveryMs, open: undefined };
    if (failure !== undefined) {
      log.warn('Pruning the outbox failed; the next round tries again', { ...sofar, ...errorFields(failure) });
    } else if (sofar.pruned > 0) {
      log.info('relay.prune', { ...sofar, ...(full ? { slow: true } : {}) });
    }
  }

  /** Runs on one connection until it drops, the relay stops, or a quiet spell sends it dormant. */
  async function session(reader: OutboxReader): Promise<SessionEnd> {
    let open = true;
    let lost: Error | undefined;
    const dropped = (): Error | undefined => lost;
    const notified = new Set<string>();
    void reader.lost.then((error) => {
      if (!open) return;
      lost = error;
      interrupt();
    });
    try {
      let holding = false;
      let lastPoll = Number.NEGATIVE_INFINITY;
      // The numbers go out a minute after taking the lock, then every minute while publishing.
      let lastStats = Date.now();
      // Where the next poll starts: after the last workspace a full poll named, so with more waiting than one
      // poll returns, every workspace still gets its turn.
      let pollAfter: string | undefined;
      // Workspaces whose last turn left more waiting, with their next batch: they get the next round.
      let leftover = new Map<string, readonly OutboxRow[]>();
      for (;;) {
        if (halted()) return { reason: 'stopped' };
        const error = dropped();
        if (error !== undefined) return { reason: 'lost', error };
        const due = Date.now() >= lastPoll + pollWait();
        if (!holding && due) {
          lastPoll = Date.now();
          holding = await reader.lock();
          // Another relay holds the lock: it serves the outbox.
          if (!holding) served();
          if (holding) {
            // Before the poll below, so a write committed from here on is either seen by it or notified.
            await reader.listen((workspaceId) => {
              if (!open) return;
              notified.add(workspaceId);
              sawWork();
              interrupt();
            });
            log.info('Relay holds the outbox lock and is publishing');
          } else step += 1;
        }
        if (holding) {
          // A notification names its workspace, so it skips the definer function; the poll asks it.
          // A workspace waiting after a failure sits out until its time, whatever names it.
          // Retries that are due go first (after a wake, those the relay went dormant with).
          const workspaces = new Map<string, readonly OutboxRow[] | undefined>();
          const add = (workspaceId: string) => {
            if (!workspaces.has(workspaceId) && ready(workspaceId)) workspaces.set(workspaceId, undefined);
          };
          for (const workspaceId of retries.keys()) add(workspaceId);
          for (const [workspaceId, rows] of leftover) workspaces.set(workspaceId, rows);
          for (const workspaceId of notified) add(workspaceId);
          notified.clear();
          if (due) {
            lastPoll = Date.now();
            const waiting = await reader.workspaces(workspacesPerPoll, pollAfter);
            served();
            pollAfter = waiting.length >= workspacesPerPoll ? waiting.at(-1) : undefined;
            // Only a workspace that isn't failing counts as work.
            if (waiting.some((workspaceId) => !retries.has(workspaceId))) sawWork();
            else step += 1;
            for (const workspaceId of waiting) add(workspaceId);
          }
          leftover = await round(reader, workspaces);
          // After a pass only (a poll, or a round with a workspace in it), so pruning never wakes the database; a
          // pass with nothing to publish is quiet, where a new round prefers to start.
          if ((due || workspaces.size > 0) && !halted()) await pruneAfterPass(reader, workspaces.size === 0);
          // From memory: the line costs no query, and only the publishing relay writes it.
          if (Date.now() - lastStats >= statsEveryMs) {
            lastStats = Date.now();
            log.info('relay.stats', { ...report() });
          }
        }
        if (halted() || dropped() !== undefined || (holding && (notified.size > 0 || leftover.size > 0))) continue;
        if (quiet()) {
          // Only a poke from here on wakes it.
          woken = false;
          if (retries.size > 0) {
            log.error('Relay going dormant with workspaces still failing to publish; the next wake tries them first', {
              workspaces: [...retries.keys()],
            });
          }
          return { reason: 'quiet' };
        }
        const nextRetry = Math.min(...[...retries.values()].map((retry) => retry.at));
        const nextStats = holding ? lastStats + statsEveryMs : Number.POSITIVE_INFINITY;
        await sleep(Math.min(lastPoll + pollWait(), lastWork + dormantAfterMs, nextRetry, nextStats) - Date.now());
      }
    } finally {
      open = false;
    }
  }

  async function run(): Promise<void> {
    let failures = 0;
    // Boot counts as work: drain once, then follow the rules.
    sawWork();
    while (!halted()) {
      if (current === 'dormant') {
        while (!isWoken() && !halted()) await sleep(undefined);
        if (halted()) break;
        woken = false;
        current = 'active';
        failures = 0;
        // The workspaces it went dormant with are due at once.
        const now = Date.now();
        for (const [workspaceId, retry] of retries) retries.set(workspaceId, { ...retry, at: now });
        // A new awake period: a prune round is due from now.
        pruneRound = { dueAt: now, open: undefined };
        log.info('Relay woken');
      }
      let reader: OutboxReader | undefined;
      let ended: SessionEnd | undefined;
      let connectedAt: number | undefined;
      try {
        reader = await deps.connect();
        connectedAt = Date.now();
        ended = await session(reader);
      } catch (error) {
        if (!halted()) log.warn('Relay failed; reconnecting', errorFields(error));
      }
      // Decide before awaiting the close, and clear `woken` with the decision, so a poke that lands while the
      // connection closes wakes the relay rather than being swallowed by it.
      const dormant = !halted() && (ended?.reason === 'quiet' || quiet());
      if (dormant) woken = false;
      await reader?.close();
      if (halted()) break;
      if (ended?.reason === 'lost') {
        log.warn(
          dormant
            ? 'Relay lost its connection after a quiet spell; dormant until a write wakes it'
            : 'Relay lost its connection; reconnecting',
          errorFields(ended.error),
        );
      }
      if (dormant) {
        // Unserved since boot only, with no poke since: nothing is known to wait, so the age doesn't grow all night.
        if (!unservedByWake) served();
        // The awake period is over: the audiences are read again at the next wake (AC-85).
        audienceCache.clear();
        audienceUsed.clear();
        splitWarned.clear();
        // A round left open waits for the next awake period, which starts one of its own.
        if (pruneRound.open !== undefined) log.info('relay.prune', { ...pruneRound.open, unfinished: true });
        pruneRound = { dueAt: Number.POSITIVE_INFINITY, open: undefined };
        log.info('Relay dormant: no database calls until a write wakes it', { quietMs: dormantAfterMs });
        current = 'dormant';
        continue;
      }
      // Only a connection that stayed up a while proves the trouble passed.
      if (connectedAt !== undefined && Date.now() - connectedAt >= healthyMs) failures = 0;
      const delay = Math.min(backoffMs * 2 ** failures, maxBackoffMs);
      failures += 1;
      log.info('Relay reconnecting', { inMs: delay });
      backingOff = true;
      await sleep(delay);
      backingOff = false;
    }
    current = 'stopped';
  }

  return {
    start() {
      if (running !== undefined) return;
      unservedSince = Date.now();
      unservedByWake = false;
      stopped = false;
      current = 'active';
      pruneRound = { dueAt: Date.now(), open: undefined };
      running = run();
    },
    wake() {
      if (halted()) return;
      unservedSince ??= Date.now();
      unservedByWake = true;
      sawWork();
      woken = true;
      if (!backingOff) interrupt();
    },
    mode: () => current,
    stats: report,
    cachedAudiences: () => audienceCache.size,
    async stop() {
      stopped = true;
      interrupt();
      await running;
      running = undefined;
      current = 'stopped';
    },
  };
}
