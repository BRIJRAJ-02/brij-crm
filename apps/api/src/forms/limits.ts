// The public form rate limits (spec 0023, AC-585, 0023-public-surface.md),
// held in this process's memory: right while the API runs one instance; a
// shared store comes with #41. Each limit is a fixed window counter, which
// is enough at these sizes: 10 a minute per form and client address, 30 an
// hour per client address across the workspace, 5 an hour per form and
// email, and 50 a second across the whole instance. Keys are hashes and ids,
// never an address or an email in the clear.

/** One limit: how many in how long. */
export interface Limit {
  readonly max: number;
  readonly windowMs: number;
}

/** The limits of spec 0023. */
export const FORM_LIMITS = {
  perFormAddress: { max: 10, windowMs: 60_000 },
  perWorkspaceAddress: { max: 30, windowMs: 3_600_000 },
  perFormEmail: { max: 5, windowMs: 3_600_000 },
  perInstance: { max: 50, windowMs: 1_000 },
} as const satisfies Record<string, Limit>;

/** Counts hits per key in fixed windows. */
export interface RateLimiter {
  /** Counts a hit on `key` under `limit`, and answers whether it is within it. */
  hit(key: string, limit: Limit): boolean;
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
      return held.count <= limit.max;
    },
  };
}

/**
 * An email as the per email limit counts it (spec 0023, abuse rules):
 * trimmed, lowercased, with any `+tag` in its local part dropped.
 */
export function limitEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return trimmed;
  const local = trimmed.slice(0, at).replace(/\+.*$/, '');
  return `${local}${trimmed.slice(at)}`;
}

/** The answers that look like emails, as the per email limit counts them. */
export function emailsIn(answers: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.values(answers).flatMap((value) =>
    typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value.trim()) ? [limitEmail(value)] : [],
  );
}
