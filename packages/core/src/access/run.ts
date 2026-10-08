// The one runner (spec 0009, AC-138): the only code in packages/core that
// reads `scope.db`. Every read goes through `inWorkspace`, and `runWrite`
// (engine/write.ts) runs its transaction through it too, so nothing reaches
// the database without a scope the door sealed. A source scan
// (`access/seal.test.ts`) fails on `scope.db` anywhere else.
import { LAST_OWNER_MESSAGE } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { postgresError, refuse } from '../engine/refusals.ts';
import { checkScope, type EngineScope } from './mint.ts';

/** The SQLSTATE `members_keep_an_owner` raises when a live workspace would be left with no active owner. */
export const LAST_OWNER_SQLSTATE = 'CRM01';

/**
 * The last owner guard's refusal, from a failure that carries its SQLSTATE
 * (at commit, where the deferred trigger raises), else the failure as it was.
 */
function lastOwner(error: unknown): unknown {
  if (postgresError(error)?.code !== LAST_OWNER_SQLSTATE) return error;
  return Object.assign(refuse('LAST_OWNER', LAST_OWNER_MESSAGE), { cause: error });
}

/**
 * Runs `work` in one transaction in the scope's workspace, after checking the
 * scope's seal. A commit the last owner guard refuses (SQLSTATE `CRM01`)
 * answers 409 `LAST_OWNER`; any other error stays as it was.
 */
export async function inWorkspace<T>(scope: EngineScope, work: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  checkScope(scope);
  try {
    return await scope.db.withWorkspace(scope.workspaceId, work);
  } catch (error) {
    throw lastOwner(error);
  }
}

/**
 * Cancels the statement backend `pid` runs while it still carries `tag`
 * (`Database.cancelTagged`), for a read whose caller stopped waiting. Checks
 * the scope's seal like every other way to the database.
 */
export function cancelTagged(scope: EngineScope, pid: number, tag: string): Promise<boolean> {
  checkScope(scope);
  return scope.db.cancelTagged(pid, tag);
}
