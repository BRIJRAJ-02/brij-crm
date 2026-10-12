// `dev.simulate` (spec 0008, The kinds in this spec): the test kind, run only
// locally and in previews (AC-123), so progress, cancel, resume and fairness
// can be proved by clicking before the first real kinds arrive (#14, #16,
// #22). Its items are synthetic ids; each batch waits `batchMillis` (through
// the injected sleep, so tests don't wait), marks its items done, refuses
// every `refuseEvery`th with SIMULATED_REFUSAL, and throws once when its
// batch holds `failAtPosition` (only on the first try, so the retry passes).
// Started with a confirm, its snapshot makes `snapshotItems` synthetic ids,
// the same ones in the same order on every read, so it goes through
// `preparing` and `ready` first (AC-109).
import * as z from 'zod';
import { defineKind, MAX_ATTEMPTS, type KindDefinition } from '../registry.ts';

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
  /** How many synthetic ids the snapshot makes (a start with a confirm). */
  snapshotItems: z.number().int().min(1).max(200_000).optional(),
});
/** The test kind's params. */
export type DevSimulateParams = z.infer<typeof DevSimulateParams>;

/** The code a refused test item carries. */
export const SIMULATED_REFUSAL = 'SIMULATED_REFUSAL';

/** The `n`th synthetic id a snapshot makes (1 based): a uuid v7 shape whose last 12 digits count. */
export function syntheticId(n: number): string {
  return `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
}

/** Which synthetic id `id` is, or 0 for any other id. */
function syntheticNumber(id: string | undefined): number {
  if (id === undefined || !id.startsWith('00000000-0000-7000-8000-')) return 0;
  return Number.parseInt(id.slice(-12), 16) || 0;
}

/**
 * The test kind, waiting with `sleep`: `dev.simulate` on the heavy lane, or
 * `dev.simulate_light` on the light one (the fairness measurement's light job,
 * AC-108), the same in every other way.
 */
export function devSimulate(
  sleep: Sleep = realSleep,
  lane: 'heavy' | 'light' = 'heavy',
): KindDefinition<DevSimulateParams> {
  return defineKind<DevSimulateParams>({
    kind: lane === 'heavy' ? 'dev.simulate' : 'dev.simulate_light',
    lane,
    actor: 'member',
    mode: 'items',
    params: DevSimulateParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS[lane],
    batchSize: 500,
    sample: { batchSize: 100, batchMillis: 0, refuseEvery: 7 },
    batchSizeOf: (params) => params.batchSize ?? 500,
    snapshot(_tx, params, after, limit) {
      const from = syntheticNumber(after) + 1;
      const to = Math.min(params.snapshotItems ?? 0, from + limit - 1);
      return Promise.resolve(
        Array.from({ length: Math.max(to - from + 1, 0) }, (_, index) => syntheticId(from + index)),
      );
    },
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
