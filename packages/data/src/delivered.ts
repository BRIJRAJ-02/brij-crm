// Writes sent again when they never reached the server, or their answer was
// lost on the way back (spec 0006; spec 0022, AC-540): only `API_UNAVAILABLE`
// (offline, the API down, a dropped connection) is tried again, twice at
// most, after the answer's Retry-After or a second. Every such write carries
// ids minted once (its mutation id, a batch or job id), so a repeat changes
// nothing twice and a job start answers the job it already made. In the first
// load: tiny, with no runtime imports beyond the errors.
import { toDataError } from './errors.ts';

/** How many times a write that never reached the server is sent again. */
export const OFFLINE_TRIES = 2;

/** The wait before sending it again when the answer named none, in seconds. */
export const DEFAULT_RESEND_SECONDS = 1;

/** Sends a write, and sends it again (the same ids) when it never reached the server; `wait` waits `ms`. */
export async function delivered<T>(run: () => Promise<T>, wait: (ms: number) => Promise<void>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const failure = toDataError(error);
      if (failure.code !== 'API_UNAVAILABLE' || attempt > OFFLINE_TRIES) throw failure;
      await wait((failure.retryAfterSeconds ?? DEFAULT_RESEND_SECONDS) * 1000);
    }
  }
}
