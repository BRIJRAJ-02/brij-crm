// The operator console's one write (spec 0065, AC-6502): a workspace's early access flag on or off, through
// crm_operator's `crm_set_early_access`, which may change that column and nothing else. Who may call it is the api's
// operator gate (OPERATOR_EMAILS, two factor, a recent sign in), never this module; the api keeps the before and
// after in the console's log.
import { EARLY_ACCESS_FLAGS, type EarlyAccessChange, type EarlyAccessFlag } from '@crm/contracts';
import type { Database } from '@crm/db';
import { sql } from 'drizzle-orm';
import { refuse } from '../engine/refusals.ts';

/** The nil uuid: the definer runs with every tenant policy around it matching nothing. */
const NO_WORKSPACE = '00000000-0000-0000-0000-000000000000';

const flagsOf = (value: unknown): EarlyAccessFlag[] =>
  Array.isArray(value) ? EARLY_ACCESS_FLAGS.filter((flag) => (value as unknown[]).includes(flag)) : [];

/**
 * Turns `flag` on or off for one workspace and answers its flags before and after. `NOT_FOUND` for a workspace that
 * isn't there. A switch to where it already is changes nothing and answers the same flags twice.
 */
export async function setEarlyAccess(
  deps: { readonly db: Database },
  input: { readonly workspaceId: string; readonly flag: EarlyAccessFlag; readonly on: boolean },
): Promise<EarlyAccessChange> {
  const result = await deps.db.withWorkspace(NO_WORKSPACE, (tx) =>
    tx.execute<{ before: unknown; after: unknown }>(
      sql`select before, after from crm_set_early_access(${input.workspaceId}::uuid, ${input.flag}, ${input.on})`,
    ),
  );
  const [row] = result.rows;
  if (row === undefined) throw refuse('NOT_FOUND', 'There is no workspace with that id.');
  return { workspaceId: input.workspaceId, before: flagsOf(row.before), after: flagsOf(row.after) };
}
