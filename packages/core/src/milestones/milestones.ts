// The milestones a workspace reaches once (spec 0010, AC-177): a workspace
// made, and its first record made by a member. Each is stored in
// `workspace_milestones` inside the transaction of the write that reached it,
// with `insert … on conflict do nothing returning`, so a row comes back only
// the first time. Core never sends anything: it returns the milestones a write
// reached, and the api sends their product events once the write commits.
import { eq, sql } from 'drizzle-orm';
import type { Milestone, ObjectKind } from '@crm/contracts/events';
import { schema, type WorkspaceTx } from '@crm/db';
import type { AfterWrite } from '../engine/write.ts';

const { objects, workspaceMilestones } = schema;

/** A milestone a write reached for the first time, as the api turns it into a product event. */
export type ReachedMilestone =
  | {
      readonly milestone: 'workspace_created';
      readonly workspaceId: string;
      /** When its row says it was reached, ISO 8601 UTC. */
      readonly reachedAt: string;
    }
  | {
      readonly milestone: 'first_record_created';
      readonly workspaceId: string;
      readonly reachedAt: string;
      /** The object the first record was made in: a standard one by its key, else `custom`. */
      readonly objectKind: ObjectKind;
    };

/** The standard objects a first record's kind names; every other object is `custom`. */
const STANDARD_KINDS: ReadonlySet<string> = new Set<ObjectKind>(['people', 'companies', 'deals']);

/**
 * Stores `milestone` for the transaction's workspace if it isn't yet, and
 * answers when it was reached, or undefined when an earlier write reached it
 * already. Runs inside the write's transaction, so the row commits or rolls
 * back with it.
 */
export async function reachMilestone(
  tx: WorkspaceTx,
  workspaceId: string,
  milestone: Milestone,
): Promise<string | undefined> {
  // Written by hand: the app may insert only these two columns (reached_at is always the transaction's time), and
  // drizzle's insert would name reached_at too, as `default`.
  const result = await tx.execute<{ reached_at: Date | string }>(
    sql`insert into ${workspaceMilestones} (workspace_id, milestone) values (${workspaceId}, ${milestone})
        on conflict do nothing returning reached_at`,
  );
  const reachedAt = result.rows[0]?.reached_at;
  return reachedAt === undefined ? undefined : new Date(reachedAt).toISOString();
}

/** The kind of object `objectId` is, for a first record's event. */
async function objectKindOf(tx: WorkspaceTx, objectId: string): Promise<ObjectKind> {
  const [row] = await tx.select({ standardKey: objects.standardKey }).from(objects).where(eq(objects.id, objectId));
  const key = row?.standardKey ?? undefined;
  return key !== undefined && STANDARD_KINDS.has(key) ? (key as ObjectKind) : 'custom';
}

/**
 * The hook that stores `first_record_created` (AC-176): after a write by a
 * member that created at least one record, in the write's transaction. A
 * write by the system, a key or an automation, one that created no record
 * (or whose creates were all refused), and any write once the milestone is
 * stored reach nothing. It tells `onReached` what this run reached on every
 * run, so a write tried again after a deadlock reports its last, committed
 * run only. The insert is one primary key probe, a conflict after the first.
 */
export function milestoneHook(onReached: (reached: readonly ReachedMilestone[]) => void): AfterWrite {
  return async (change, tx) => {
    const first = change.createdRecords[0];
    if (change.kind !== 'write' || change.actor.type !== 'member' || first === undefined) {
      onReached([]);
      return;
    }
    const reachedAt = await reachMilestone(tx, change.workspaceId, 'first_record_created');
    if (reachedAt === undefined) {
      onReached([]);
      return;
    }
    const objectKind = await objectKindOf(tx, first.objectId);
    onReached([{ milestone: 'first_record_created', workspaceId: change.workspaceId, reachedAt, objectKind }]);
  };
}
