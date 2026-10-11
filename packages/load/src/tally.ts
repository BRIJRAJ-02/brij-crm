// One measured thing's requests (spec 0011, AC-203): each call gets the 10
// second timeout (and the harness's own abort, when it has one), and the
// tally keeps how many requests it took, the worst outcome among them with
// its reason, and the API's pool wait and handler time from each answer's
// `Server-Timing`. The user model and the live client both measure through it.
import { outcomeOfError, REQUEST_TIMEOUT_MS, type Outcome } from './outcome.ts';

/** One call's extras: the signal that aborts it, and where the client notes the API's pool wait. */
export interface Call {
  readonly signal: AbortSignal;
  readonly poolMs: number[];
  readonly appMs: number[];
}

/** A call's answer: its value, or how it failed. */
export type Answer<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly outcome: Outcome; readonly reason: string };

/** What a tally holds once its calls answered: when, how, and what the API said of its own time. */
export interface Answered {
  readonly answeredAt: number;
  readonly outcome: Outcome;
  readonly reason?: string;
  readonly requests: number;
  readonly poolMs: readonly number[];
  readonly appMs: readonly number[];
}

/** The worse of two outcomes for one action: unexpected, then expected, then ok. */
export function worse(left: Outcome, right: Outcome): Outcome {
  const rank: Record<Outcome, number> = { ok: 0, aborted: 1, expected: 2, unexpected: 3 };
  return rank[right] > rank[left] ? right : left;
}

/** A fresh tally on `now`, the clock every thread shares. */
export function createTally(now: () => number) {
  let requests = 0;
  let outcome: Outcome = 'ok';
  let reason: string | undefined;
  const poolMs: number[] = [];
  const appMs: number[] = [];
  /** Runs one request, noting its outcome; it never rejects. */
  async function call<T>(run: (call: Call) => Promise<T>, abort?: AbortSignal): Promise<Answer<T>> {
    requests += 1;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = abort === undefined ? timeout : AbortSignal.any([timeout, abort]);
    try {
      return { ok: true, value: await run({ signal, poolMs, appMs }) };
    } catch (error) {
      const failed = outcomeOfError(error, abort?.aborted === true && !timeout.aborted);
      if (worse(outcome, failed.outcome) !== outcome) {
        outcome = failed.outcome;
        reason = failed.reason;
      }
      return { ok: false, ...failed };
    }
  }
  /** The tally as it stands, stamped now. */
  const answered = (): Answered => ({
    answeredAt: now(),
    outcome,
    ...(reason === undefined ? {} : { reason }),
    requests,
    poolMs,
    appMs,
  });
  return { call, answered };
}

/** One tally's `call`. */
export type TallyCall = ReturnType<typeof createTally>['call'];
