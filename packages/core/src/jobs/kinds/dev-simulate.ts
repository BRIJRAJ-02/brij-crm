// `dev.simulate` (spec 0008, The kinds in this spec): the test kind, run only
// locally and in previews (AC-123), so progress, cancel, resume and fairness
// can be proved by clicking before the first real kinds arrive (#14, #16,
// #22). Its items are synthetic ids; each batch waits `batchMillis` (through
// the injected sleep, so tests don't wait), marks its items done, refuses
// every `refuseEvery`th with SIMULATED_REFUSAL, and throws once when its
// batch holds `failAtPosition` (only on the first try, so the retry passes).
import * as z from 'zod';
import { defineKind, type KindDefinition } from '../registry.ts';

/** How the test kind waits: `setTimeout` by default, a stub in tests. */
export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) =>
  ms <= 0
    ? Promise.resolve()
    : new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

/** The test kind's params: how big a batch is, how long each takes, and the failures to stage. */
export const DevSimulateParams = z.strictObject({
  batchSize: z.number().int().min(1).max(5_000).optional(),
  batchMillis: z.number().int().min(0).max(2_000),
  failAtPosition: z.number().int().min(1).optional(),
  refuseEvery: z.number().int().min(1).optional(),
});
/** The test kind's params. */
export type DevSimulateParams = z.infer<typeof DevSimulateParams>;

/** The code a refused test item carries. */
export const SIMULATED_REFUSAL = 'SIMULATED_REFUSAL';

/** The test kind, waiting with `sleep`. */
export function devSimulate(sleep: Sleep = realSleep): KindDefinition<DevSimulateParams> {
  return defineKind<DevSimulateParams>({
    kind: 'dev.simulate',
    lane: 'heavy',
    actor: 'member',
    mode: 'items',
    params: DevSimulateParams,
    cancellable: true,
    maxAttempts: 8,
    batchSize: 500,
    sample: { batchSize: 100, batchMillis: 0, refuseEvery: 7 },
    batchSizeOf: (params) => params.batchSize ?? 500,
    async step(_context, { job, items = [] }) {
      const { batchMillis, failAtPosition, refuseEvery } = job.params;
      await sleep(batchMillis);
      if (
        failAtPosition !== undefined &&
        job.attempts === 0 &&
        items.some((item) => item.position === failAtPosition)
      ) {
        throw new Error('The test job failed on purpose.');
      }
      return {
        finished: false,
        items: items.map((item) =>
          refuseEvery !== undefined && item.position % refuseEvery === 0
            ? { position: item.position, state: 'refused', code: SIMULATED_REFUSAL, message: 'Refused on purpose.' }
            : { position: item.position, state: 'done' },
        ),
      };
    },
  });
}
