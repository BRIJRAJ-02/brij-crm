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
//   no database call at all. A connection lost while waiting (Neon suspending
//   the compute, a restart) also sends it dormant rather than reconnecting.
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
// Retention: while active and holding the lock, at most once a minute and
// only beside a poll it was making anyway, the relay deletes up to 1,000 rows
// published more than `OUTBOX_RETENTION` (24 hours) ago, and again on the
// next poll while it keeps finding a full batch. Dormant, it prunes nothing.
import { type ChangeEvent, workspaceChannel } from '@crm/contracts';
import type { OutboxReader, OutboxRow } from '@crm/db';
import { errorFields } from '../log.ts';
import type { PublishBatch } from './centrifugo.ts';

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
  /** The least time between two prunes while active (default 1 minute). */
  readonly pruneEveryMs?: number;
  /** The most workspaces one poll asks for (default 500, the definer function's own cap). */
  readonly workspacesPerPoll?: number;
  /** A workspace's first wait after a failed publish, doubled each failure in a row (default 1 second). */
  readonly retryMs?: number;
  /** A workspace's longest wait after failed publishes (default 60 seconds). */
  readonly maxRetryMs?: number;
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
  /** Stops after the publish in flight, closes the connection (letting go of the lock) and waits for the loop. */
  stop(): Promise<void>;
}

/** The safety poll's default waits: 1, 2, 5, 15 seconds, then every minute. */
export const POLL_SCHEDULE_MS: readonly number[] = [1_000, 2_000, 5_000, 15_000, 60_000];

/** The default quiet spell before the relay goes dormant: 3 minutes, inside Neon's 5 minute suspend timeout. */
export const DORMANT_AFTER_MS = 180_000;

/** The most published rows one prune deletes (the definer function's own cap). */
const PRUNE_BATCH = 1_000;

/** The event for one outbox row: ids only, `mutationId` and `coarse` only when set. */
export function changeEvent(row: OutboxRow): ChangeEvent {
  return {
    seq: row.seq,
    kind: row.kind,
    objectId: row.objectId,
    recordIds: [...row.recordIds],
    attributeIds: [...row.attributeIds],
    ...(row.mutationId === undefined ? {} : { mutationId: row.mutationId }),
    ...(row.coarse ? { coarse: true as const } : {}),
  };
}

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
  const pruneEveryMs = deps.pruneEveryMs ?? 60_000;
  const workspacesPerPoll = deps.workspacesPerPoll ?? 500;
  const retryMs = deps.retryMs ?? 1_000;
  const maxRetryMs = deps.maxRetryMs ?? 60_000;
  const { log } = deps;

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
  // Workspaces waiting after failed publishes, and when each was last warned about.
  const retries = new Map<string, Retry>();
  const warnedAt = new Map<string, number>();

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
    const rows = held ?? (await reader.pending(workspaceId, batch));
    if (rows.length === 0) {
      retries.delete(workspaceId);
      return undefined;
    }
    // A failing workspace's rows aren't work until they go out.
    const retrying = retries.has(workspaceId);
    if (!retrying) sawWork();
    const channel = workspaceChannel(workspaceId);
    const outcome = await deps.publishBatch(
      rows.map((row) => ({ channel, data: changeEvent(row), idempotencyKey: `${workspaceId}:${String(row.seq)}` })),
    );
    const landed = rows[outcome.published - 1];
    if (outcome.error !== undefined) {
      failed(workspaceId, rows[outcome.published]?.seq, outcome.error, 'publish');
      if (landed !== undefined) await reader.mark(workspaceId, landed.seq);
      return undefined;
    }
    retries.delete(workspaceId);
    if (retrying) sawWork();
    const last = rows[rows.length - 1];
    if (last === undefined) return undefined;
    const next = await reader.advance(workspaceId, last.seq, batch);
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
          failed(workspaceId, held?.[0]?.seq, error, 'database');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, lane));
    return more;
  }

  /** Deletes one batch of published rows past retention; true when it was full, so there may be more. */
  async function prune(reader: OutboxReader): Promise<boolean> {
    try {
      const pruned = await reader.prune(PRUNE_BATCH);
      if (pruned > 0) log.info('Relay pruned published changes past retention', { pruned });
      return pruned >= PRUNE_BATCH;
    } catch (error) {
      log.warn('Pruning the outbox failed; trying again in a minute', errorFields(error));
      return false;
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
      let lastPrune = Number.NEGATIVE_INFINITY;
      let pruneAgain = false;
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
            pollAfter = waiting.length >= workspacesPerPoll ? waiting.at(-1) : undefined;
            // Only a workspace that isn't failing counts as work.
            if (waiting.some((workspaceId) => !retries.has(workspaceId))) sawWork();
            else step += 1;
            for (const workspaceId of waiting) add(workspaceId);
          }
          leftover = await round(reader, workspaces);
          // Beside a poll only, so pruning never wakes the database on its own.
          if (due && !halted() && (pruneAgain || Date.now() - lastPrune >= pruneEveryMs)) {
            lastPrune = Date.now();
            pruneAgain = await prune(reader);
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
        await sleep(Math.min(lastPoll + pollWait(), lastWork + dormantAfterMs, nextRetry) - Date.now());
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
      } finally {
        await reader?.close();
      }
      if (halted()) break;
      if (ended?.reason === 'lost') {
        // Neon suspending the compute drops the connection; reconnecting would wake it again for nothing.
        // Only a poke from here on wakes it.
        woken = false;
        log.warn('Relay lost its connection; dormant until a write wakes it', errorFields(ended.error));
        current = 'dormant';
        continue;
      }
      if (ended?.reason === 'quiet' || quiet()) {
        // The session cleared `woken` when it decided; a failed connect clears it here.
        if (ended === undefined) woken = false;
        log.info('Relay dormant: no database calls until a write wakes it', { quietMs: dormantAfterMs });
        current = 'dormant';
        continue;
      }
      // Only a connection that stayed up a while proves the trouble passed.
      if (connectedAt !== undefined && Date.now() - connectedAt >= healthyMs) failures = 0;
      const delay = Math.min(backoffMs * 2 ** failures, maxBackoffMs);
      failures += 1;
      log.info('Relay reconnecting', { inMs: delay });
      await sleep(delay);
    }
    current = 'stopped';
  }

  return {
    start() {
      if (running !== undefined) return;
      stopped = false;
      current = 'active';
      running = run();
    },
    wake() {
      if (halted()) return;
      sawWork();
      woken = true;
      interrupt();
    },
    mode: () => current,
    async stop() {
      stopped = true;
      interrupt();
      await running;
      running = undefined;
      current = 'stopped';
    },
  };
}
