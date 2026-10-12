// The restart tests' kinds (spec 0008, AC-103): `test.effects` writes one row
// per item it marks done to `test_job_effects`, in the batch's own
// transaction, so a test counts every item's effect exactly once however the
// worker was stopped. Each batch waits `batchMillis` first, so a stop lands
// mid batch. `test.effects_light` is the same on the light lane, where a job
// has no queue of its own and only the lease keeps two rows of it apart.
import { defineKind, jobKinds, type AnyKind, type JobRegistry, type KindDefinition } from '@crm/core';
import { sql } from 'drizzle-orm';
import * as z from 'zod';

/** The effects kinds' params: a batch's size and how long it takes. */
export const EffectsParams = z.strictObject({
  batchSize: z.number().int().min(1).max(5_000),
  batchMillis: z.number().int().min(0).max(2_000),
});
/** The effects kinds' params. */
export type EffectsParams = z.infer<typeof EffectsParams>;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function effects(kind: string, lane: 'heavy' | 'light'): KindDefinition<EffectsParams> {
  return defineKind<EffectsParams>({
    kind,
    lane,
    actor: 'member',
    mode: 'items',
    params: EffectsParams,
    cancellable: true,
    maxAttempts: lane === 'heavy' ? 8 : 5,
    batchSize: 500,
    sample: { batchSize: 10, batchMillis: 0 },
    batchSizeOf: (params) => params.batchSize,
    async step(context, { job, items = [] }) {
      await wait(job.params.batchMillis);
      await context.tx.execute(sql`
        insert into test_job_effects (workspace_id, job_id, item_id)
        select ${context.scope.workspaceId}::uuid, ${job.id}::uuid, unnest(${`{${items.map((item) => item.itemId).join(',')}}`}::uuid[])
      `);
      return { finished: false, items: items.map((item) => ({ position: item.position, state: 'done' as const })) };
    },
  });
}

/** The test kinds: heavy and light. */
export const effectsKinds: readonly AnyKind[] = [
  effects('test.effects', 'heavy'),
  effects('test.effects_light', 'light'),
];

/** The registry the restart tests and their workers share: the local kinds and the effects kinds. */
export function restartRegistry(): JobRegistry {
  return jobKinds({ environment: 'local', extra: effectsKinds });
}
