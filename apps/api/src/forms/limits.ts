// The public form rate limits (spec 0023, AC-585, 0023-public-surface.md),
// held in this process's memory: right while the API runs one instance; a
// shared store comes with #41. Each limit is a fixed window counter, which
// is enough at these sizes: 5 a minute per client address, 120 an hour per
// form (0023-experience.md, Bots and abuse, adjusted), and 50 a second across
// the whole instance; beyond one, 429 with `Retry-After`. Keys are hashes and
// ids, never an address in the clear.

/** One limit: how many in how long. */
export interface Limit {
  readonly max: number;
  readonly windowMs: number;
}

/** The limits of spec 0023. */
export const FORM_LIMITS = {
  perAddress: { max: 5, windowMs: 60_000 },
  perForm: { max: 120, windowMs: 3_600_000 },
  perInstance: { max: 50, windowMs: 1_000 },
} as const satisfies Record<string, Limit>;

/** Counts hits per key in fixed windows. */
export interface RateLimiter {
  /** Counts a hit on `key` under `limit`: `true` within it, else the seconds until its window ends. */
  hit(key: string, limit: Limit): true | { readonly retryAfterSeconds: number };
}

/** The most keys held before the oldest windows are dropped, so memory stays bounded under a flood. */
const MAX_KEYS = 100_000;

/** A limiter in memory, on the clock given (tests move theirs). */
export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, limit) {
      const at = now();
      const held = windows.get(key);
      if (held === undefined || at - held.start >= limit.windowMs) {
        if (windows.size >= MAX_KEYS) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
        windows.delete(key);
        windows.set(key, { start: at, count: 1 });
        return true;
      }
      held.count += 1;
      if (held.count <= limit.max) return true;
      return { retryAfterSeconds: Math.max(1, Math.ceil((held.start + limit.windowMs - at) / 1000)) };
    },
  };
}
