// Which of some members are active now (parity #53): a definition names its recipients by id, and a run checks them
// again before it acts, since a member can leave between the two. And a member's removal: the automations they run
// as switch off at once, with the reason the list shows (`CREATOR_GONE`), rather than at their next run.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import type { RemovalEffect } from '../members/removal-effect.ts';

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

/**
 * A removed member's automations (parity #53): each one that runs as them is switched off with `CREATOR_GONE`, as a
 * run would find it, so none fires with nobody to run as; deleted ones are left as they are. Someone who may manage
 * automations turns one back on as themself.
 */
export const automationsRemoval: RemovalEffect = {
  feature: 'automations',
  constraints: ['automations_run_as'],
  run: async (context, memberId) => {
    const { tx, scope } = context;
    const off = await tx.execute<{ id: string }>(sql`
      update automations set enabled = false, disabled_reason = 'CREATOR_GONE'
      where workspace_id = ${scope.workspaceId}::uuid and run_as_member_id = ${memberId}::uuid
        and enabled and deleted_at is null
      returning id::text
    `);
    if (off.rows.length > 0) context.record({ automations: off.rows.map((row) => row.id) });
  },
};
