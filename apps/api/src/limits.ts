// The one rate limits module for the public endpoints (spec 0023, AC-585;
// spec 0025, AC-643): one limiter, and every public limit in one table per
// surface, so forms, booking and the fill tickets count the same way. Limits
// are fixed windows held in this process's memory, right only while one API
// instance runs (spec 0023 Follow-up: a shared store before scaling out,
// #41). Keys are hashes and ids, never an address or an email in the clear.

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
 * A fixed window limiter in memory, at most `maxKeys` keys: when full, expired
 * windows are swept, then the oldest dropped down to 90%, so memory stays
 * bounded and a flood costs one scan per `maxKeys / 10` new keys. Each
 * surface gets its own (forms, booking, ticket uses), so a flood on one
 * never evicts another's windows. `now` is passed in for tests.
 */
export function createMemoryLimiter(
  options: { readonly now?: () => number; readonly maxKeys?: number } = {},
): PublicLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 100_000;
  const windows = new Map<string, { readonly start: number; readonly windowMs: number; count: number }>();
  return (key, rule) => {
    const at = now();
    const current = windows.get(key);
    if (current === undefined || at - current.start >= rule.windowMs) {
      if (windows.size >= maxKeys) {
        // Full: drop what has expired, then the oldest down to 90%, so the next full scan is maxKeys / 10 inserts away.
        for (const [each, window] of windows) if (at - window.start >= window.windowMs) windows.delete(each);
        const keep = Math.floor(maxKeys * 0.9);
        for (const each of windows.keys()) {
          if (windows.size <= keep) break;
          windows.delete(each);
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

/**
 * The public form limits (spec 0023, AC-585; 0023-experience.md, Bots and
 * abuse, adjusted): 5 a minute per client address, 30 an hour per address
 * within one workspace, 120 an hour per form, 50 a second across the
 * instance: beyond any, 429 with `Retry-After`. 5 an hour per form and
 * normalised email: beyond it, a spam sign (Needs review), never a 429.
 * Reading a hosted form is cheaper but uncached, so it has its own limiter
 * and pair: 60 a minute per address and 300 a second across the instance,
 * never per form, which a few addresses could spend for everyone.
 */
export const FORM_LIMITS = {
  readsPerAddress: { max: 60, windowMs: 60_000 },
  readsPerInstance: { max: 300, windowMs: 1_000 },
  perAddress: { max: 5, windowMs: 60_000 },
  perAddressInWorkspace: { max: 30, windowMs: 3_600_000 },
  perForm: { max: 120, windowMs: 3_600_000 },
  perEmail: { max: 5, windowMs: 3_600_000 },
  perInstance: { max: 50, windowMs: 1_000 },
} as const satisfies Record<string, LimitRule>;

/**
 * Public form file uploads (#32): few and small by address (each is up to 4 MiB through a function), a bounded number
 * in a workspace and per form, and the instance's own ceiling.
 */
export const UPLOAD_LIMITS = {
  perAddress: { max: 6, windowMs: 60_000 },
  perAddressInWorkspace: { max: 30, windowMs: 3_600_000 },
  perForm: { max: 120, windowMs: 3_600_000 },
  perInstance: { max: 10, windowMs: 1_000 },
} as const satisfies Record<string, LimitRule>;

/**
 * A member attaching a file to a record's cell (27 Oct 2026): 30 a minute for
 * one signed in person (a record page attaches one file at a time), and 20 a
 * second across the instance, well under the public form's own ceiling, since
 * these come from people we already know.
 */
export const RECORD_FILE_LIMITS = {
  perMember: { max: 30, windowMs: 60_000 },
  perInstance: { max: 20, windowMs: 1_000 },
} as const satisfies Record<string, LimitRule>;

/**
 * Fill tickets (spec 0023 spam follow-up): 30 a minute per address (a page
 * asks once per load and once per "Send another"), 200 a second across the
 * instance, and 5 submits per ticket
 * in a day, past which a ticket counts as spent.
 */
export const TICKET_LIMITS = {
  issuePerAddress: { max: 30, windowMs: 60_000 },
  issuePerInstance: { max: 200, windowMs: 1_000 },
  usesPerTicket: { max: 5, windowMs: 86_400_000 },
} as const satisfies Record<string, LimitRule>;
