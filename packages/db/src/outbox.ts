// The outbox reader (spec 0005, change events): everything the relay asks of
// Postgres, on one direct connection as the app login, so no raw `pg` lives
// outside this package. Which workspaces have unpublished rows comes from the
// one security definer function, `crm_outbox_workspaces` (ids only); a
// workspace's rows are read and marked inside `withWorkspace`, under row level
// security, like every other tenant query.
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { workspaceTransaction } from './client.ts';
import * as schema from './schema/index.ts';

const { outbox } = schema;

/** The channel a write notifies (`pg_notify`) once its outbox rows commit; the payload is the workspace id. */
export const OUTBOX_CHANNEL = 'crm_outbox';

/** The advisory lock the publishing relay holds for its session, so only one relay publishes. */
const RELAY_LOCK = 7_007_007;

/** The most workspaces `crm_outbox_workspaces` returns at once (it clamps to the same). */
const MAX_WORKSPACES = 500;
/** The most rows one `pending` call returns. */
const MAX_ROWS = 1_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One unpublished outbox row, as the relay turns it into an event. */
export interface OutboxRow {
  readonly seq: number;
  readonly kind: 'records' | 'definitions';
  readonly objectId: string;
  readonly recordIds: readonly string[];
  readonly attributeIds: readonly string[];
  /** Too many records changed to list: refetch what you hold of the object. */
  readonly coarse: boolean;
  readonly mutationId: string | undefined;
}

/**
 * The relay's view of the outbox, on one direct connection. Call one method
 * at a time (the relay's loop does): a transaction on the one client must not
 * interleave with another statement.
 */
export interface OutboxReader {
  /** Takes the relay lock for this connection's session; false while another relay holds it. */
  lock(): Promise<boolean>;
  /** Lets go of the relay lock. Closing the connection lets go of it too. */
  unlock(): Promise<void>;
  /** Workspace ids with unpublished rows, at most `max` (clamped to 1 to 500), through the definer function. */
  workspaces(max: number): Promise<readonly string[]>;
  /** A workspace's unpublished rows in `seq` order, at most `max` (clamped to 1 to 1,000), inside `withWorkspace`. */
  pending(workspaceId: string, max: number): Promise<readonly OutboxRow[]>;
  /** Stamps a workspace's rows up to and including `upto` as published, inside `withWorkspace`; returns how many. */
  mark(workspaceId: string, upto: number): Promise<number>;
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
  const db = drizzle({ client: direct, schema });
  const lost = new Promise<Error>((resolve) => {
    direct.on('error', (error) => resolve(error));
    direct.on('end', () => resolve(new Error('The direct database connection closed.')));
  });

  return {
    async lock() {
      const result = await direct.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [RELAY_LOCK]);
      return result.rows[0]?.locked === true;
    },

    async unlock() {
      await direct.query('select pg_advisory_unlock($1)', [RELAY_LOCK]);
    },

    async workspaces(max) {
      const result = await direct.query<{ workspace_id: string }>(
        'select workspace_id from public.crm_outbox_workspaces($1::integer) as w(workspace_id)',
        [clamp(max, MAX_WORKSPACES)],
      );
      return result.rows.map((row) => row.workspace_id);
    },

    pending(workspaceId, max) {
      return workspaceTransaction(db, workspaceId, async (tx) => {
        const rows = await tx
          .select({
            seq: outbox.seq,
            kind: outbox.kind,
            objectId: outbox.objectId,
            recordIds: outbox.recordIds,
            attributeIds: outbox.attributeIds,
            coarse: outbox.coarse,
            mutationId: outbox.mutationId,
          })
          .from(outbox)
          .where(and(eq(outbox.workspaceId, workspaceId), isNull(outbox.publishedAt)))
          .orderBy(asc(outbox.seq))
          .limit(clamp(max, MAX_ROWS));
        return rows.map((row) => ({ ...row, mutationId: row.mutationId ?? undefined }));
      });
    },

    mark(workspaceId, upto) {
      return workspaceTransaction(db, workspaceId, async (tx) => {
        const marked = await tx
          .update(outbox)
          .set({ publishedAt: sql`now()` })
          .where(and(eq(outbox.workspaceId, workspaceId), lte(outbox.seq, upto), isNull(outbox.publishedAt)))
          .returning({ seq: outbox.seq });
        return marked.length;
      });
    },

    async listen(onNotify) {
      direct.on('notification', (message) => {
        if (message.channel !== OUTBOX_CHANNEL || message.payload === undefined) return;
        if (UUID.test(message.payload)) onNotify(message.payload.toLowerCase());
      });
      await direct.query(`listen ${OUTBOX_CHANNEL}`);
    },

    lost,

    async close() {
      try {
        await direct.end();
      } catch {
        // Already gone: nothing to close.
      }
    },
  };
}

/** A whole number from 1 to `most`. */
function clamp(value: number, most: number): number {
  return Math.min(Math.max(Math.trunc(Number.isFinite(value) ? value : 1), 1), most);
}
