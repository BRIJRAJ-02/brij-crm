// The outbox relay (spec 0005, change events), run by the worker. It LISTENs
// on `crm_outbox` and polls every second for what LISTEN missed, and only the
// relay holding the advisory lock publishes. For each workspace it publishes
// the unpublished rows in `seq` order to `workspace:<id>`, each with the
// idempotency key `<workspace>:<seq>`, then marks them. A failed publish stops
// that workspace's batch, to retry on the next tick, so nothing is skipped;
// other workspaces carry on. A dropped connection (Neon's compute sleeping, a
// deploy) reconnects with backoff, 1, 2, 4 and up to 30 seconds, instead of
// ending the worker.
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
  /** Opens a fresh direct connection as an outbox reader; called again after one drops. */
  readonly connect: () => Promise<OutboxReader>;
  readonly publish: Publish;
  readonly log: RelayLog;
  /** How often to look for unpublished rows without a notification (default 1 second). */
  readonly pollMs?: number;
  /** The first wait before reconnecting, doubled each failed try (default 1 second). */
  readonly backoffMs?: number;
  /** The longest wait before reconnecting (default 30 seconds). */
  readonly maxBackoffMs?: number;
  /** The most rows read from one workspace at a time (default 100). */
  readonly batch?: number;
}

export interface Relay {
  /** Starts the loop. Calling it again does nothing. */
  start(): void;
  /** Stops after the publish in flight, closes the connection (letting go of the lock) and waits for the loop. */
  stop(): Promise<void>;
}

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

/** The relay, with everything it touches passed in. */
export function createRelay(deps: RelayDeps): Relay {
  const pollMs = deps.pollMs ?? 1_000;
  const backoffMs = deps.backoffMs ?? 1_000;
  const maxBackoffMs = deps.maxBackoffMs ?? 30_000;
  const batch = deps.batch ?? 100;
  const { log } = deps;

  let stopped = false;
  // Read through a function: stop() sets it while the loop awaits, which a narrowed local would hide.
  const halted = (): boolean => stopped;
  let running: Promise<void> | undefined;
  // Cuts the current pause short: a notification, a lost connection, or stop().
  let wake = (): void => undefined;

  /** Waits `ms`, or until something calls `wake`. */
  function pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wake = () => undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      wake = done;
    });
  }

  /** Publishes one workspace's pending rows in order and marks them; stops at the first failed publish. */
  async function drain(reader: OutboxReader, workspaceId: string): Promise<void> {
    for (;;) {
      const rows = await reader.pending(workspaceId, batch);
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

  /** Runs on one connection until it drops or the relay stops. Returns what ended it, if it dropped. */
  async function session(reader: OutboxReader): Promise<Error | undefined> {
    let active = true;
    let lost: Error | undefined;
    const dropped = (): Error | undefined => lost;
    const notified = new Set<string>();
    void reader.lost.then((error) => {
      if (!active) return;
      lost = error;
      wake();
    });
    try {
      await reader.listen((workspaceId) => {
        if (!active) return;
        notified.add(workspaceId);
        wake();
      });
      let holding = false;
      let lastPoll = Number.NEGATIVE_INFINITY;
      while (!halted() && dropped() === undefined) {
        if (!holding) {
          holding = await reader.lock();
          if (holding) log.info('Relay holds the outbox lock and is publishing');
        }
        if (holding) {
          const due = Date.now() - lastPoll >= pollMs;
          // A notification names its workspace, so it skips the definer function; the poll asks it.
          const workspaces = new Set(notified);
          notified.clear();
          if (due) {
            lastPoll = Date.now();
            for (const workspaceId of await reader.workspaces(WORKSPACES_PER_POLL)) workspaces.add(workspaceId);
          }
          for (const workspaceId of workspaces) {
            if (halted()) break;
            await drain(reader, workspaceId);
          }
        }
        if (halted() || dropped() !== undefined || (holding && notified.size > 0)) continue;
        await pause(holding ? Math.max(0, lastPoll + pollMs - Date.now()) : pollMs);
      }
      return dropped();
    } finally {
      active = false;
    }
  }

  async function run(): Promise<void> {
    let failures = 0;
    while (!halted()) {
      let reader: OutboxReader | undefined;
      try {
        reader = await deps.connect();
        failures = 0;
        const lost = await session(reader);
        if (lost !== undefined && !halted()) log.warn('Relay lost its connection; reconnecting', errorFields(lost));
      } catch (error) {
        if (!halted()) log.warn('Relay failed; reconnecting', errorFields(error));
      } finally {
        await reader?.close();
      }
      if (halted()) break;
      const delay = Math.min(backoffMs * 2 ** failures, maxBackoffMs);
      failures += 1;
      log.info('Relay reconnecting', { inMs: delay });
      await pause(delay);
    }
  }

  return {
    start() {
      if (running !== undefined) return;
      stopped = false;
      running = run();
    },
    async stop() {
      stopped = true;
      wake();
      await running;
      running = undefined;
    },
  };
}
