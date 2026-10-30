// Which of some members are active now (parity #53): a definition names its recipients by id, and a run checks them
// again before it acts, since a member can leave between the two.
import { and, eq, inArray } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';

const { members } = schema;

/** The members among `ids` that are active in the transaction's workspace. */
export async function activeMembers(tx: WorkspaceTx, ids: readonly string[]): Promise<ReadonlySet<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(inArray(members.id, [...ids]), eq(members.status, 'active')));
  return new Set(rows.map((row) => row.id));
}
