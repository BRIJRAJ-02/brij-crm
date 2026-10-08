// The outbox reader (spec 0005, change events): everything the relay asks of
// Postgres, on one direct connection as the app login, so no raw `pg` lives
// outside this package. Which workspaces have unpublished rows comes from the
// security definer function `crm_outbox_workspaces` (ids only), and retention
// from `crm_outbox_prune`; a workspace's rows are read and marked under row
// level security, like every other tenant query.
//
// The relay's hot path is one round trip per batch: `app.workspace_id` is set,
// the last batch marked and the next one read by one simple query of several
// statements, which Postgres runs as one implicit transaction (an error in any
// rolls back all, and the setting ends with it), where `withWorkspace` would
// take four (begin, set_config, the statement, commit). That query can carry
// no parameters, so its values are inlined only after checking them: the
// workspace id against the uuid pattern, and the numbers as whole numbers.
import type pg from 'pg';
import type { outboxKind } from './schema/outbox.ts';

/** A kind of outbox row (`outbox_kind`): one per kind of spec 0007's `ChangeEvent` but the stub. */
export type OutboxKind = (typeof outboxKind.enumValues)[number];

/** The channel a write notifies (`pg_notify`) once its outbox rows commit; the payload is the workspace id. */
export const OUTBOX_CHANNEL = 'crm_outbox';

/** The advisory lock the publishing relay holds for its session, so only one relay publishes. */
const RELAY_LOCK = 7_007_007;

/** The most workspaces `crm_outbox_workspaces` returns at once (it clamps to the same). */
const MAX_WORKSPACES = 500;
/** The most rows one `pending` or `advance` call returns. */
const MAX_ROWS = 1_000;
/** The most rows one `prune` call deletes (`crm_outbox_prune` clamps to the same). */
const MAX_PRUNE = 1_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One outbox row, as the relay and catch up turn it into an event (`outboxEvent` in `@crm/core`). */
export interface OutboxRow {
  readonly seq: number;
  readonly kind: OutboxKind;
  readonly objectId: string | undefined;
  readonly listId: string | undefined;
  readonly recordIds: readonly string[];
  readonly attributeIds: readonly string[];
  /** The row's own items: entry, view, note, task, member or job ids, by kind. */
  readonly itemIds: readonly string[];
  /** Too many records changed to list: refetch what you hold of the object. */
  readonly coarse: boolean;
  readonly mutationId: string | undefined;
  /** The member whose write stored the row. Never published. */
  readonly actorMemberId: string | undefined;
  /** The commit time (`created_at`), ISO 8601: the event's `at`. */
  readonly at: string;
}

/** What marking rows published answers: how many, and each one's lag from commit to publish, in ms. */
export interface Marked {
  readonly marked: number;
  /** `published_at - created_at` of each row marked, in `seq` order. */
  readonly lagsMs: readonly number[];
}

/**
 * The relay's view of the outbox, on one direct connection. Calls may come at
 * once (the relay runs several workspaces' turns side by side): the reader
 * runs them one after another, so a transaction on the one client never
 * interleaves with another statement.
 */
export interface OutboxReader {
  /** Takes the relay lock for this connection's session; false while another relay holds it. */
  lock(): Promise<boolean>;
  /** Lets go of the relay lock. Closing the connection lets go of it too. */
  unlock(): Promise<void>;
  /**
   * Workspace ids with unpublished rows, at most `max` (clamped to 1 to 500),
   * through the definer function: those after `after` first, then wrapping
   * round from the lowest. Throws a `TypeError` for an `after` that isn't a uuid.
   */
  workspaces(max: number, after?: string): Promise<readonly string[]>;
  /**
   * A workspace's unpublished rows in `seq` order, at most `max` (clamped to
   * 1 to 1,000), under its row level security. Throws a `TypeError` unless the
   * id is a uuid.
   */
  pending(workspaceId: string, max: number): Promise<readonly OutboxRow[]>;
  /**
   * Stamps a workspace's rows up to and including `upto` as published, under
   * its row level security; answers how many, with their lags. Throws a
   * `TypeError` unless the id is a uuid and `upto` a whole number.
   */
  mark(workspaceId: string, upto: number): Promise<Marked>;
  /** `mark(workspaceId, upto)` then `pending(workspaceId, max)`, in one round trip and one transaction. */
  advance(workspaceId: string, upto: number, max: number): Promise<Marked & { readonly rows: readonly OutboxRow[] }>;
  /**
   * Deletes at most `max` (clamped to 1 to 1,000) rows published more than
   * `OUTBOX_RETENTION` ago, through the definer function; returns how many.
   */
  prune(max: number): Promise<number>;
  /** LISTENs on `crm_outbox`, calling `onNotify` with the workspace id each committed write names. */
  listen(onNotify: (workspaceId: string) => void): Promise<void>;
  /**
   * Settles once the connection is gone, dropped (a Neon compute sleeping,
   * say) or closed, with what ended it. It never rejects.
   */
  readonly lost: Promise<Error>;
  /** Closes the connection (and so lets go of the lock). Never throws. */
  close(): Promise<void>;
}

/**
 * Wraps a direct connection (from `openDirectConnection`, as the app login)
 * as the relay's outbox reader. The reader owns the client from here: it
 * listens for the client's errors, so a dropped connection settles `lost`
 * instead of crashing the process. A dropped reader is done; open a new
 * connection and a new reader.
 */
export function createOutboxReader(direct: pg.Client): OutboxReader {
  const lost = new Promise<Error>((resolve) => {
    direct.on('error', (error) => resolve(error));
    direct.on('end', () => resolve(new Error('The direct database connection closed.')));
  });
  // One call at a time on the one client: each waits for the one before it to settle.
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  }

  const calls: Omit<OutboxReader, 'lost'> = {
    async lock() {
      const result = await direct.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [RELAY_LOCK]);
      return result.rows[0]?.locked === true;
    },

    async unlock() {
      await direct.query('select pg_advisory_unlock($1)', [RELAY_LOCK]);
    },

    async workspaces(max, after) {
      if (after !== undefined && !UUID.test(after)) throw new TypeError('A workspace id is a uuid.');
      const result = await direct.query<{ workspace_id: string }>(
        'select workspace_id from public.crm_outbox_workspaces($1::integer, $2::uuid) as w(workspace_id)',
        [clamp(max, MAX_WORKSPACES), after ?? null],
      );
      return result.rows.map((row) => row.workspace_id);
    },

    async pending(workspaceId, max) {
      const [, read] = await inWorkspace(direct, workspaceId, [readPending(workspaceId, max)]);
      return rowsOf(read);
    },

    async mark(workspaceId, upto) {
      const [, marked] = await inWorkspace(direct, workspaceId, [markUpto(workspaceId, upto)]);
      return markedOf(marked);
    },

    async advance(workspaceId, upto, max) {
      const [, marked, read] = await inWorkspace(direct, workspaceId, [
        markUpto(workspaceId, upto),
        readPending(workspaceId, max),
      ]);
      return { ...markedOf(marked), rows: rowsOf(read) };
    },

    async prune(max) {
      const result = await direct.query<{ pruned: number }>('select public.crm_outbox_prune($1::integer) as pruned', [
        clamp(max, MAX_PRUNE),
      ]);
      return result.rows[0]?.pruned ?? 0;
    },

    async listen(onNotify) {
      direct.on('notification', (message) => {
        if (message.channel !== OUTBOX_CHANNEL || message.payload === undefined) return;
        if (UUID.test(message.payload)) onNotify(message.payload.toLowerCase());
      });
      await direct.query(`listen ${OUTBOX_CHANNEL}`);
    },

    async close() {
      try {
        await direct.end();
      } catch {
        // Already gone: nothing to close.
      }
    },
  };

  return {
    lock: () => serial(() => calls.lock()),
    unlock: () => serial(() => calls.unlock()),
    workspaces: (max, after) => serial(() => calls.workspaces(max, after)),
    pending: (workspaceId, max) => serial(() => calls.pending(workspaceId, max)),
    mark: (workspaceId, upto) => serial(() => calls.mark(workspaceId, upto)),
    advance: (workspaceId, upto, max) => serial(() => calls.advance(workspaceId, upto, max)),
    prune: (max) => serial(() => calls.prune(max)),
    listen: (onNotify) => serial(() => calls.listen(onNotify)),
    lost,
    // Closing doesn't wait its turn: a call stuck on a dead connection must not hold it open.
    close: () => calls.close(),
  };
}

/** An outbox row as pg parses it. */
export interface RawOutboxRow {
  readonly seq: string;
  readonly kind: OutboxKind;
  readonly object_id: string | null;
  readonly list_id: string | null;
  readonly record_ids: string[];
  readonly attribute_ids: string[];
  readonly item_ids: string[];
  readonly coarse: boolean;
  readonly mutation_id: string | null;
  readonly actor_member_id: string | null;
  /** `created_at` as ISO 8601 in UTC, to the millisecond, formatted by Postgres (so no driver's parsing matters). */
  readonly at: string;
}

/** The columns an `OutboxRow` is read from, in SQL, for `outboxRowOf`. */
export const OUTBOX_ROW_COLUMNS = `seq, kind, object_id, list_id, record_ids, attribute_ids, item_ids, coarse, mutation_id,
  actor_member_id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at`;

/**
 * Runs `statements` (already checked, see the header) after setting
 * `app.workspace_id`, as one simple query: one round trip, one implicit
 * transaction. Returns each statement's result, the setting's first.
 */
async function inWorkspace(
  direct: pg.Client,
  workspaceId: string,
  statements: readonly string[],
): Promise<readonly (pg.QueryResult | undefined)[]> {
  if (!UUID.test(workspaceId)) throw new TypeError('The outbox reader needs a workspace id (a uuid).');
  const text = [`select set_config('app.workspace_id', '${workspaceId}', true)`, ...statements].join(';\n');
  // With more than one statement, pg answers one result per statement.
  const results = (await direct.query(text)) as unknown as pg.QueryResult[];
  return results;
}

function readPending(workspaceId: string, max: number): string {
  return `select ${OUTBOX_ROW_COLUMNS} from public.outbox
    where workspace_id = '${workspaceId}' and published_at is null order by seq limit ${String(clamp(max, MAX_ROWS))}`;
}

function markUpto(workspaceId: string, upto: number): string {
  if (!Number.isSafeInteger(upto)) throw new TypeError('An outbox number is a whole number.');
  // Each row's lag from commit to publish comes back with the stamp, for the relay's stats (spec 0007, AC-77).
  return `with marked as (
      update public.outbox set published_at = now()
      where workspace_id = '${workspaceId}' and seq <= ${String(upto)} and published_at is null
      returning seq, extract(epoch from published_at - created_at) * 1000 as lag_ms
    )
    select lag_ms::float8 as lag_ms from marked order by seq`;
}

function markedOf(result: pg.QueryResult | undefined): Marked {
  const lagsMs = ((result?.rows ?? []) as { lag_ms: number }[]).map((row) => row.lag_ms);
  return { marked: lagsMs.length, lagsMs };
}

/** One outbox row as pg parsed it (selected with `OUTBOX_ROW_COLUMNS`), as an `OutboxRow`. */
export function outboxRowOf(row: RawOutboxRow): OutboxRow {
  return {
    seq: Number(row.seq),
    kind: row.kind,
    objectId: row.object_id ?? undefined,
    listId: row.list_id ?? undefined,
    recordIds: row.record_ids,
    attributeIds: row.attribute_ids,
    itemIds: row.item_ids,
    coarse: row.coarse,
    mutationId: row.mutation_id ?? undefined,
    actorMemberId: row.actor_member_id ?? undefined,
    at: row.at,
  };
}

function rowsOf(result: pg.QueryResult | undefined): readonly OutboxRow[] {
  return ((result?.rows ?? []) as RawOutboxRow[]).map(outboxRowOf);
}

/** A whole number from 1 to `most`. */
function clamp(value: number, most: number): number {
  return Math.min(Math.max(Math.trunc(Number.isFinite(value) ? value : 1), 1), most);
}
