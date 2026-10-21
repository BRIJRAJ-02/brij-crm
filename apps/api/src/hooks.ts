// The one way a write procedure calls the engine (spec 0005, key invariants):
// `commitWrite` hands the engine call the write's hooks, and once that call has
// resolved (the transaction committed) pokes the worker's relay, so changes are
// published even while the relay is dormant (`realtime/wake.ts`). No procedure
// builds hooks of its own or pokes by hand, so none can forget either; a test
// (`writes.test.ts`) calls every write procedure and fails if one doesn't come
// through here. The audit log (#36) joins the hooks here. So does the first
// record milestone (spec 0010, AC-176): stored in the write's transaction, its
// product event queued only once the write has committed.
import { milestoneHook, outboxHook, type AfterWrite, type ReachedMilestone } from '@crm/core';
import { type MilestoneSender, sendMilestones } from './monitoring/milestones.ts';
import type { RequestContext } from './orpc.ts';

/** What a write needs from its request: the relay's poke, and what sending a milestone's event needs. */
export type WriteRequest = Pick<RequestContext, 'wakeRelay'> & MilestoneSender;

/** What a write procedure says about its write: the uuid the browser minted for it. */
export interface WriteMeta {
  /** Echoed in the write's change event, so the browser that made it skips its own echo. */
  readonly mutationId: string;
}

/**
 * The hooks one write runs in its transaction, after its change lands: the
 * outbox hook (spec 0005, task 15), storing one outbox row per object the
 * write touched with `mutationId`, so a refused write stores none, and
 * telling `onStored` how many; then the milestone hook (spec 0010, AC-176),
 * storing `first_record_created` the first time a member's write creates a
 * record, and telling `onReached`.
 */
function writeHooks(
  meta: WriteMeta,
  onStored: (count: number) => void,
  onReached: (reached: readonly ReachedMilestone[]) => void,
): readonly AfterWrite[] {
  return [outboxHook({ mutationId: meta.mutationId, onStored }), milestoneHook(onReached)];
}

/**
 * The hooks a background job's batch runs (spec 0008): the same outbox hook
 * a request's write runs, with no mutation id (no browser made the write).
 * The worker's runner takes them as a dependency, so packages/core never
 * imports this app.
 */
export function backgroundHooks(): readonly AfterWrite[] {
  return [outboxHook()];
}

/**
 * Runs one write procedure's engine call with the write's hooks, then pokes
 * the relay once it resolves; a refused or failed write pokes nothing. `meta`
 * is undefined for `workspaces.create`, which stores no events (nobody can
 * be subscribed to a workspace that didn't exist), and for
 * `account.deletion.confirm`, whose core stores each workspace's members event
 * itself; neither takes hooks.
 */
export async function commitWrite<T>(
  context: WriteRequest,
  meta: WriteMeta | undefined,
  write: (hooks: readonly AfterWrite[]) => Promise<T>,
): Promise<T> {
  return (await commitCounted(context, meta, write)).result;
}

/**
 * `commitWrite`, also answering `echoes`: how many outbox rows (so change
 * events carrying the write's `mutationId`) the committed write stored, one
 * per object it touched, 0 when it changed nothing (spec 0006, AC-60). The
 * browser skips exactly that many of its own echoes. Once the write has
 * committed, the events for the milestones it reached are queued too.
 */
export async function commitCounted<T>(
  context: WriteRequest,
  meta: WriteMeta | undefined,
  write: (hooks: readonly AfterWrite[]) => Promise<T>,
): Promise<{ readonly result: T; readonly echoes: number }> {
  // Set, never added to: a write tried again after a deadlock runs its hooks again, and the last run committed.
  let echoes = 0;
  let reached: readonly ReachedMilestone[] = [];
  const hooks =
    meta === undefined
      ? []
      : writeHooks(
          meta,
          (count) => {
            echoes = count;
          },
          (milestones) => {
            reached = milestones;
          },
        );
  const result = await write(hooks);
  context.wakeRelay();
  sendMilestones(context, reached);
  return { result, echoes };
}

/**
 * What a read of jobs hands the core so a lost wake heals (spec 0008, The
 * wake call): a job found `queued` more than 5 seconds past its time wakes
 * the worker. Here, beside the write path's poke, so no router pokes by hand.
 */
export function wakeIfOverdue(context: Pick<RequestContext, 'wakeOverdue'>): { readonly onOverdue: () => void } {
  return { onOverdue: () => context.wakeOverdue() };
}
