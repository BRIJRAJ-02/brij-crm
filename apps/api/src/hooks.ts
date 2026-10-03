// The one composer of write hooks (spec 0005, key invariants): every write
// procedure takes the hooks it hands the engine from `writeHooks`, so a hook
// added here reaches every write at once and no procedure can forget one.
// `workspaces.create` is the one write without it: nobody can be subscribed to
// a workspace that didn't exist. The audit log (#36) joins the list here.
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
export function writeHooks(_context: Pick<RequestContext, 'requestId'>, meta: WriteMeta): readonly AfterWrite[] {
  return [outboxHook({ mutationId: meta.mutationId })];
}
