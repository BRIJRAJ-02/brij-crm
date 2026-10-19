// The public endpoints' rate limits and bot checks (spec 0025, AC-643): two
// small seams spec 0023's forms modules replace at landing. Limits are fixed
// windows held in this process's memory, so they are right only while one API
// instance runs (spec 0023's Follow-up: a shared store before scaling out).

/** One limit: at most `max` hits per `windowMs`. */
export interface LimitRule {
  readonly max: number;
  readonly windowMs: number;
}

/** A limiter's answer: allowed, or how long to wait. */
export type LimitDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

/** Counts a hit on `key` under `rule`. */
export type PublicLimiter = (key: string, rule: LimitRule) => LimitDecision;

/**
 * A fixed window limiter in memory, at most `maxKeys` keys (expired windows
 * swept first, then the oldest). `now` is passed in for tests.
 */
export function createMemoryLimiter(
  options: { readonly now?: () => number; readonly maxKeys?: number } = {},
): PublicLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 50_000;
  const windows = new Map<string, { readonly start: number; readonly windowMs: number; count: number }>();
  return (key, rule) => {
    const at = now();
    const current = windows.get(key);
    if (current === undefined || at - current.start >= rule.windowMs) {
      if (windows.size >= maxKeys) {
        for (const [each, window] of windows) if (at - window.start >= window.windowMs) windows.delete(each);
        while (windows.size >= maxKeys) {
          const oldest = windows.keys().next();
          if (oldest.done === true) break;
          windows.delete(oldest.value);
        }
      }
      windows.delete(key);
      windows.set(key, { start: at, windowMs: rule.windowMs, count: 1 });
      return { allowed: true };
    }
    if (current.count >= rule.max) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.start + rule.windowMs - at) / 1000)) };
    }
    current.count += 1;
    return { allowed: true };
  };
}

/** AC-643: per client address, 60 slot reads and 5 bookings a minute; per page, ten times that. */
export const BOOKING_LIMITS = {
  readsPerAddress: { max: 60, windowMs: 60_000 },
  booksPerAddress: { max: 5, windowMs: 60_000 },
  readsPerPage: { max: 600, windowMs: 60_000 },
  booksPerPage: { max: 50, windowMs: 60_000 },
} as const satisfies Record<string, LimitRule>;

/** The least time a person takes from opening the page to booking. */
export const MIN_FILL_MS = 3_000;

/**
 * The bot checks a booking passes (AC-643): the honeypot left empty, and not
 * sent faster than a person could (when the page said when it loaded).
 * reCAPTCHA v3 joins with spec 0023's module.
 */
export function looksLikeBot(input: { readonly website?: string; readonly startedAt?: number }, now: number): boolean {
  if (input.website !== undefined && input.website !== '') return true;
  return input.startedAt !== undefined && now - input.startedAt < MIN_FILL_MS;
}
