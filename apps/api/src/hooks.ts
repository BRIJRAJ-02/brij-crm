// The one way a write procedure calls the engine (spec 0005, key invariants):
// `commitWrite` hands the engine call the write's hooks, and once that call has
// resolved (the transaction committed) pokes the worker's relay, so changes are
// published even while the relay is dormant (`realtime/wake.ts`). No procedure
// builds hooks of its own or pokes by hand, so none can forget either; a test
// (`writes.test.ts`) calls every write procedure and fails if one doesn't come
// through here. The audit log (#36) joins the hooks here.
import { outboxHook, type AfterWrite } from '@crm/core';
import type { RequestContext } from './orpc.ts';

/** What a write procedure says about its write: the uuid the browser minted for it. */
export interface WriteMeta {
  /** Echoed in the write's change event, so the browser that made it skips its own echo. */
  readonly mutationId: string;
}

/**
 * The hooks one write runs in its transaction, after its change lands: the
 * outbox hook (spec 0005, task 15), storing one outbox row per object the
 * write touched with `mutationId`, so a refused write stores none.
 */
function writeHooks(meta: WriteMeta): readonly AfterWrite[] {
  return [outboxHook({ mutationId: meta.mutationId })];
}

/**
 * Runs one write procedure's engine call with the write's hooks, then pokes
 * the relay once it resolves; a refused or failed write pokes nothing. `meta`
 * is undefined only for `workspaces.create`, which stores no events (nobody
 * can be subscribed to a workspace that didn't exist) and takes no hooks.
 */
export async function commitWrite<T>(
  context: Pick<RequestContext, 'wakeRelay'>,
  meta: WriteMeta | undefined,
  write: (hooks: readonly AfterWrite[]) => Promise<T>,
): Promise<T> {
  const result = await write(meta === undefined ? [] : writeHooks(meta));
  context.wakeRelay();
  return result;
}
