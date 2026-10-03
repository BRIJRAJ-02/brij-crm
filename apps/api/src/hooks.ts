// The one composer of write hooks (spec 0005, key invariants): every write
// procedure takes the hooks it hands the engine from `writeHooks`, so a hook
// added here reaches every write at once and no procedure can forget one.
import type { AfterWrite } from '@crm/core';
import type { RequestContext } from './orpc.ts';

/** What a write procedure says about its write: the uuid the browser minted for it. */
export interface WriteMeta {
  /** Echoed in the write's change event, so the browser that made it skips its own echo. */
  readonly mutationId: string;
}

/**
 * The hooks one write runs in its transaction, after its change lands. None
 * yet: the outbox hook joins here in milestone 3 (spec 0005, task 15),
 * storing one outbox row per write with `mutationId`, so a refused write
 * stores none. `workspaces.create` never calls this (nobody can be
 * subscribed to a workspace that didn't exist).
 */
export function writeHooks(_context: Pick<RequestContext, 'requestId'>, _meta: WriteMeta): readonly AfterWrite[] {
  return [];
}
