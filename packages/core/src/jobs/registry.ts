// The job kinds (spec 0008, Declaring a kind): a feature declares a kind (its
// params schema, its lane, its actor, and one step that does one batch) and
// the runner does everything else. The registry holds the kinds this process
// runs; the screens know a kind's label and whether it can be cancelled from
// `JOB_KINDS` in `@crm/contracts`, and `defineKind` checks the two agree.
import { JOB_KINDS, type JobKind } from '@crm/contracts';
import type { z } from 'zod';
import type { WriteContext } from '../engine/write.ts';

/** What one batch of a job gets: the job (its params as parsed, its checkpoint, its failed tries), its items, the batch size. */
export interface StepInput<P> {
  readonly job: {
    readonly id: string;
    readonly params: P;
    readonly checkpoint: unknown;
    /** Consecutive failed tries of this batch: 0 the first time. */
    readonly attempts: number;
  };
  /** The batch's pending items, by position (item jobs only). */
  readonly items?: readonly { readonly position: number; readonly itemId: string }[];
  readonly limit: number;
}

/** How one item of a batch ended. */
export interface ItemOutcome {
  readonly position: number;
  readonly state: 'done' | 'refused' | 'skipped';
  readonly code?: string;
  readonly message?: string;
}

/** What one batch did: where the next one starts, whether the work is done, each item's state, the summary. */
export interface StepOutcome {
  /** Where the next batch starts (cursor jobs); item jobs may leave it. */
  readonly checkpoint?: unknown;
  /** Nothing left to do. An item job also ends once no pending item is left. */
  readonly finished: boolean;
  /** Every item of the batch (item jobs). */
  readonly items?: readonly ItemOutcome[];
  /** Counts (cursor jobs). */
  readonly counts?: { readonly done: number; readonly refused?: number; readonly skipped?: number };
  /** Merged into the job's `result` (the kind's summary). */
  readonly result?: Readonly<Record<string, unknown>>;
}

/**
 * One kind. `mode` says whether it works through items (`job_items`, given
 * at start) or a cursor of its own (its checkpoint). Its step works only
 * through the `WriteContext` it gets, never opens a transaction, never
 * sleeps and never calls the network, and is idempotent for its batch.
 * `sample` is a valid params value, for the shared contract test.
 */
export interface KindDefinition<P> {
  readonly kind: string;
  readonly lane: 'heavy' | 'light';
  /** Whose job it is: a member's (run as them), or the system's from any caller's scope (AC-125). */
  readonly actor: 'member' | 'system';
  readonly mode: 'items' | 'cursor';
  /** A strict object: ids and settings, never secrets. */
  readonly params: z.ZodType<P>;
  readonly cancellable: boolean;
  /** 8 for heavy kinds, 5 for light ones, unless the kind says less. */
  readonly maxAttempts: number;
  /** 1 to 5,000; 500 unless the kind says otherwise. */
  readonly batchSize: number;
  readonly sample: P;
  /** A batch size the params choose, within 1 to 5,000 (the test kind's). */
  batchSizeOf?(params: P): number;
  step(context: WriteContext, input: StepInput<P>): Promise<StepOutcome>;
}

/** A kind of any params, as the registry holds it. */
export type AnyKind = KindDefinition<unknown>;

/** The most items one batch takes. */
export const MAX_BATCH_SIZE = 5_000;

/** The attempt limits: a heavy kind tries a failing batch 8 times, a light one 5 (AC-104). */
export const MAX_ATTEMPTS = { heavy: 8, light: 5 } as const;

/**
 * Checks a kind and hands it back: a batch size of 1 to 5,000, an attempt
 * limit of 1 up to its lane's, and, for a kind the screens name, the lane and
 * cancellable `JOB_KINDS` gives it. Throws on a mistake: a programming error.
 */
export function defineKind<P>(definition: KindDefinition<P>): KindDefinition<P> {
  const { kind, lane, batchSize, maxAttempts, cancellable } = definition;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Kind ${kind}: a batch is 1 to ${String(MAX_BATCH_SIZE)} items.`);
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS[lane]) {
    throw new Error(`Kind ${kind}: a ${lane} kind tries at most ${String(MAX_ATTEMPTS[lane])} times.`);
  }
  if (Object.hasOwn(JOB_KINDS, kind)) {
    const listed = JOB_KINDS[kind as JobKind];
    if (listed.lane !== lane || listed.cancellable !== cancellable) {
      throw new Error(`Kind ${kind}: its lane and cancellable must match JOB_KINDS.`);
    }
  }
  return definition;
}

/** The kinds this process runs. */
export interface JobRegistry {
  /** The kind, or undefined for one this process doesn't run (a test kind in production, one from a newer deploy). */
  get(kind: string): AnyKind | undefined;
  /** Every kind's name. */
  kinds(): readonly string[];
}

/** A registry of `kinds`. Two kinds with one name is a programming error. */
export function createRegistry(kinds: readonly AnyKind[]): JobRegistry {
  const byName = new Map<string, AnyKind>();
  for (const kind of kinds) {
    if (byName.has(kind.kind)) throw new Error(`Kind ${kind.kind} is registered twice.`);
    byName.set(kind.kind, kind);
  }
  const names = Object.freeze([...byName.keys()]);
  return {
    get: (kind) => byName.get(kind),
    kinds: () => names,
  };
}

/** A params key that names a secret: a kind's params never hold one (AC-122). */
const SECRET_KEY = /secret|token|password|passwd|api_?key|credential|cookie|session/i;

/**
 * The shared contract every kind passes (AC-122), the parts that need no
 * database: its sample parses, its params schema is strict (an unknown key
 * is refused), and no params key names a secret. Answers the problems found.
 */
export function kindContractProblems(definition: AnyKind): readonly string[] {
  const problems: string[] = [];
  const sample = definition.params.safeParse(definition.sample);
  if (!sample.success) problems.push('its sample params do not parse');
  const extra =
    typeof definition.sample === 'object' && definition.sample !== null
      ? { ...definition.sample, unexpected: true }
      : { unexpected: true };
  if (definition.params.safeParse(extra).success) problems.push('its params schema is not strict');
  if (typeof definition.sample === 'object' && definition.sample !== null) {
    for (const key of Object.keys(definition.sample)) {
      if (SECRET_KEY.test(key)) problems.push(`its params name a secret (${key})`);
    }
  }
  return problems;
}
