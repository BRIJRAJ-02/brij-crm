// Reads that stop when their caller stops waiting (spec 0004, AC-15; spec
// 0005): a closed tab or a superseded window cancels its statement in
// Postgres, so an abandoned page or count never holds a connection.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../scope.ts';
import { cancelTagged, inWorkspace } from '../../access/run.ts';

/** Whether `signal` has aborted, read fresh (a call, so a check made earlier doesn't narrow it). */
export const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

/**
 * Runs `work` in a workspace transaction that `signal` can cancel. An aborted
 * signal refuses with `cancelled()` before any connection is taken. Otherwise
 * the transaction carries a name only it holds (`crm-<kind>:<uuid>`, as its
 * application name), and an abort cancels the statement running under that
 * name through the database's own cancel connection, so the cancel never
 * waits behind the work. A statement cancelled that way fails with Postgres
 * code 57014, which the caller turns into its refusal. Between statements an
 * abort can't be cancelled in Postgres, so `work` gets `checkpoint`, which
 * refuses once the signal has aborted: call it between its phases.
 */
export async function withCancel<T>(
  scope: EngineScope,
  kind: 'query' | 'count',
  signal: AbortSignal | undefined,
  cancelled: () => Error,
  work: (tx: WorkspaceTx, checkpoint: () => void) => Promise<T>,
): Promise<T> {
  if (isAborted(signal)) throw cancelled();
  const checkpoint = () => {
    if (isAborted(signal)) throw cancelled();
  };
  if (signal === undefined) return inWorkspace(scope, (tx) => work(tx, checkpoint));
  return inWorkspace(scope, async (tx) => {
    // A name only this transaction carries: the cancel checks it, so a connection the pool has since handed
    // to another request (another workspace's) is never the one cancelled. Local, so it ends with the transaction.
    const tag = `crm-${kind}:${randomUUID()}`;
    const named = await tx.execute<{ pid: number }>(
      sql`select set_config('application_name', ${tag}, true), pg_backend_pid() as pid`,
    );
    const backend = named.rows[0]?.pid;
    const cancel = () => {
      if (backend === undefined) return;
      void cancelTagged(scope, backend, tag).catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      // An abort while the name was set fired before the listener existed.
      checkpoint();
      return await work(tx, checkpoint);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  });
}
