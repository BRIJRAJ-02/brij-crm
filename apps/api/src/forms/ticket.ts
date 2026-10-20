// Fill tickets (spec 0023, AC-584; the spam follow-up): the server's signed
// note of when a public page loaded, so the minimum fill time is measured on
// our clock rather than trusted from the visitor's. A ticket is
// `t1.<issued at, base 36 ms>.<nonce>.<HMAC-SHA256 of subject, time and nonce>`,
// bound to one subject (`form:<public key>` or `booking:<public key>`), good
// for a day and for a few submits (`TICKET_LIMITS.usesPerTicket`, counted in
// the central limiter). Nothing is stored. The key is derived from
// `FORMS_IP_SALT`, so rotating the salt only turns tickets in flight into
// unchecked ones (a weak sign, never spam alone). Never logged.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TicketVerdict } from '@crm/core';
import type { FillTicket } from '@crm/contracts';
import type { Context, Env, Hono } from 'hono';
import { TICKET_LIMITS, type PublicLimiter } from '../limits.ts';

/** How long a ticket stays good. */
export const TICKET_TTL_MS = 86_400_000;

/** How far ahead of our clock a ticket may claim to be (none of ours ever is; a little slack for nothing). */
const FUTURE_SLACK_MS = 1_000;

/** Issues and checks fill tickets. */
export interface TicketBook {
  /** A new ticket for `subject`, issued now. */
  issue(subject: string): string;
  /** What a sent ticket for `subject` says: valid with its age, or why not. Counts one use of a valid one. */
  check(subject: string, ticket: string | undefined): TicketVerdict;
}

/** What a ticket book needs: the salt it derives its key from, the limiter that counts uses, and the clock. */
export interface TicketDeps {
  readonly salt: string;
  readonly limiter: PublicLimiter;
  readonly now?: () => number;
}

/** A ticket book keyed from `salt`. */
export function createTicketBook(deps: TicketDeps): TicketBook {
  const key = createHmac('sha256', deps.salt).update('crm-fill-ticket-v1').digest();
  const now = deps.now ?? Date.now;
  const mac = (subject: string, issued: string, nonce: string) =>
    createHmac('sha256', key).update(`${subject}\n${issued}\n${nonce}`).digest('base64url');
  return {
    issue(subject) {
      const issued = now().toString(36);
      const nonce = randomBytes(16).toString('base64url');
      return `t1.${issued}.${nonce}.${mac(subject, issued, nonce)}`;
    },
    check(subject, ticket) {
      if (ticket === undefined || ticket.trim() === '') return { kind: 'missing' };
      const parts = ticket.split('.');
      if (parts.length !== 4 || parts[0] !== 't1') return { kind: 'invalid' };
      const [, issued = '', nonce = '', given = ''] = parts;
      if (!/^[0-9a-z]{1,12}$/u.test(issued) || !/^[\w-]{22}$/u.test(nonce)) return { kind: 'invalid' };
      const expected = Buffer.from(mac(subject, issued, nonce));
      const actual = Buffer.from(given);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { kind: 'invalid' };
      const elapsedMs = now() - Number.parseInt(issued, 36);
      if (elapsedMs < -FUTURE_SLACK_MS) return { kind: 'invalid' };
      if (elapsedMs > TICKET_TTL_MS) return { kind: 'expired' };
      if (!deps.limiter(`ticket:${nonce}`, TICKET_LIMITS.usesPerTicket).allowed) return { kind: 'reused' };
      return { kind: 'valid', elapsedMs: Math.max(0, elapsedMs) };
    },
  };
}

/**
 * Mounts the two ticket endpoints, never cached: `GET
 * /public/forms/:publicKey/ticket` and `GET /public/booking/:publicKey/ticket`.
 * They read nothing (an unknown key gets a ticket no submit will match), so
 * they say nothing about which forms or pages exist. 30 a minute per address.
 */
export function mountTickets<E extends Env>(
  app: Hono<E>,
  deps: {
    readonly tickets: TicketBook;
    readonly limiter: PublicLimiter;
    /** The salted hash of the request's client address, which the issue limit keys on. */
    readonly addressOf: (c: Context<E>) => string;
  },
): void {
  const handler = (kind: 'form' | 'booking') => (c: Context<E>) => {
    const limit = deps.limiter(`ticket:issue:${deps.addressOf(c)}`, TICKET_LIMITS.issuePerAddress);
    if (!limit.allowed) {
      return c.json({ code: 'RATE_LIMITED', message: 'Too many requests. Wait a moment and try again.' }, 429, {
        'retry-after': String(limit.retryAfterSeconds),
        'cache-control': 'no-store',
      });
    }
    const body: FillTicket = { ticket: deps.tickets.issue(`${kind}:${c.req.param('publicKey') ?? ''}`) };
    return c.json(body, 200, { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  };
  app.get('/public/forms/:publicKey/ticket', handler('form'));
  app.get('/public/booking/:publicKey/ticket', handler('booking'));
}
