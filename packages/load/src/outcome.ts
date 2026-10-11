// How the harness classes each answer (spec 0011, AC-203, status codes): 2xx
// is a success; 409 and 422 are expected refusals, counted apart; a request
// the harness aborted itself (a count a newer view replaced) is neither; and
// everything else is unexpected: any 401, a 429, a 400, every 5xx, a 10
// second timeout and a dropped connection.

/** One answer's class. */
export type Outcome = 'ok' | 'expected' | 'unexpected' | 'aborted';

/** How long a request may take before it counts as a timeout. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** The class of an HTTP status. */
export function outcomeOfStatus(status: number): Outcome {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 409 || status === 422) return 'expected';
  return 'unexpected';
}

/** A failed call's class and a short reason for the report (its code, `timeout` or `dropped`). */
export function outcomeOfError(error: unknown, abortedByHarness: boolean): { outcome: Outcome; reason: string } {
  if (abortedByHarness) return { outcome: 'aborted', reason: 'aborted' };
  if (typeof error === 'object' && error !== null) {
    const name = 'name' in error ? String(error.name) : '';
    if (name === 'TimeoutError') return { outcome: 'unexpected', reason: 'timeout' };
    if ('status' in error && typeof error.status === 'number' && error.status > 0) {
      const code = 'code' in error ? String(error.code) : String(error.status);
      return { outcome: outcomeOfStatus(error.status), reason: `${String(error.status)} ${code}` };
    }
    // The cause oRPC wraps a failed fetch in.
    if ('cause' in error && error.cause !== undefined && error.cause !== error) {
      return outcomeOfError(error.cause, false);
    }
  }
  return { outcome: 'unexpected', reason: 'dropped' };
}
