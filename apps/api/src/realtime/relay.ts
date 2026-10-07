// The outbox relay (spec 0005, change events), run by the worker. Only the
// relay holding the advisory lock publishes. For each workspace it publishes
// the unpublished rows in `seq` order to `workspace:<id>`, each with the
// idempotency key `<workspace>:<seq>`, then marks them. A failed publish stops
// that workspace's batch, to retry later, so nothing is skipped; other
// workspaces carry on.
//
// Neon bills compute by the hour and suspends it after 5 minutes without a
// query, so the relay lets the database sleep while nothing is written:
// - Active: LISTEN on `crm_outbox` on the direct connection, plus a safety
//   poll that backs off over a quiet spell (1, 2, 5, 15, then every 60
//   seconds) and starts again at 1 second on any notification, poke or row.
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
// 30 seconds), and goes dormant instead once the quiet spell has passed.
import { type ChangeEvent, workspaceChannel } from '@crm/contracts';
import type { OutboxReader, OutboxRow } from '@crm/db';
import { errorFields } from '../log.ts';
import type { Publish } from './centrifugo.ts';

type Fields = Record<string, unknown>;

/** Where the relay reports what it does. */
export interface RelayLog {
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
}

export interface RelayDeps {
  /** Opens a fresh direct connection as an outbox reader; called again after one drops or the relay wakes. */
  readonly connect: () => Promise<OutboxReader>;
  readonly publish: Publish;
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
  /** The most rows read from one workspace at a time (default 100). */
  readonly batch?: number;
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

/** The most workspaces asked for in one poll (the definer function's own cap). */
const WORKSPACES_PER_POLL = 500;

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
  const batch = deps.batch ?? 100;
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

  const quiet = (): boolean => Date.now() - lastWork >= dormantAfterMs;
  const pollWait = (): number => schedule[Math.min(step, schedule.length - 1)] ?? 1_000;

  /** Publishes one workspace's pending rows in order and marks them; stops at the first failed publish. */
  async function drain(reader: OutboxReader, workspaceId: string): Promise<void> {
    for (;;) {
      const rows = await reader.pending(workspaceId, batch);
      if (rows.length > 0) sawWork();
      let upto: number | undefined;
      let failed = false;
      for (const row of rows) {
        if (halted()) break;
        try {
          await deps.publish({
            channel: workspaceChannel(workspaceId),
            data: changeEvent(row),
            idempotencyKey: `${workspaceId}:${String(row.seq)}`,
          });
          upto = row.seq;
        } catch (error) {
          log.warn('Publishing a change failed; retrying on the next tick', {
            workspaceId,
            seq: row.seq,
            ...errorFields(error),
          });
          failed = true;
          break;
        }
      }
      if (upto !== undefined) await reader.mark(workspaceId, upto);
      if (failed || halted() || rows.length < batch) return;
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
      await reader.listen((workspaceId) => {
        if (!open) return;
        notified.add(workspaceId);
        sawWork();
        interrupt();
      });
      let holding = false;
      let lastPoll = Number.NEGATIVE_INFINITY;
      for (;;) {
        if (halted()) return { reason: 'stopped' };
        const error = dropped();
        if (error !== undefined) return { reason: 'lost', error };
        const due = Date.now() >= lastPoll + pollWait();
        if (!holding && due) {
          lastPoll = Date.now();
          holding = await reader.lock();
          if (holding) log.info('Relay holds the outbox lock and is publishing');
          else step += 1;
        }
        if (holding) {
          // A notification names its workspace, so it skips the definer function; the poll asks it.
          const workspaces = new Set(notified);
          notified.clear();
          if (due) {
            lastPoll = Date.now();
            const waiting = await reader.workspaces(WORKSPACES_PER_POLL);
            if (waiting.length > 0) sawWork();
            else step += 1;
            for (const workspaceId of waiting) workspaces.add(workspaceId);
          }
          for (const workspaceId of workspaces) {
            if (halted()) break;
            await drain(reader, workspaceId);
          }
        }
        if (halted() || dropped() !== undefined || (holding && notified.size > 0)) continue;
        if (quiet()) {
          // Only a poke from here on wakes it.
          woken = false;
          return { reason: 'quiet' };
        }
        await sleep(Math.min(lastPoll + pollWait(), lastWork + dormantAfterMs) - Date.now());
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
        log.info('Relay woken');
      }
      let reader: OutboxReader | undefined;
      let ended: SessionEnd | undefined;
      try {
        reader = await deps.connect();
        failures = 0;
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
