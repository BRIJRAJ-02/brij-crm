// Save and resume (spec 0063, AC-6319, AC-6330): the shapes the hosted page
// and the server share for a partly filled form. A partial is never a
// submission: it is never filed, never notified, never counted and never in
// Submissions, and it is deleted on submit or after 30 days.
//
// The link a visitor is given carries one opaque token and nothing else, no
// answer, no email and no name (AC-6330). The token is 32 random bytes the
// server mints; only its SHA-256 is stored, so a stolen database row opens no
// one's answers.
import * as z from 'zod';
import { FILL_TICKET_MAX } from './ticket.ts';

/** How many random bytes a resume token holds: 256 bits, so it can't be guessed. */
export const RESUME_TOKEN_BYTES = 32;

/** How long a partial lives before the daily cleanup removes it (AC-6319). */
export const PARTIAL_KEPT_DAYS = 30;

/** The most partials one form keeps for one address, so a saver can't fill the table. */
export const PARTIALS_PER_ADDRESS = 20;

/**
 * A resume token as it travels: 32 random bytes in base64url, so 43
 * characters of `A-Za-z0-9_-` and nothing else. Anything else is refused
 * before a database row is ever looked for.
 */
export const ResumeToken = z
  .string()
  .regex(/^[\w-]{43}$/u, { error: 'That resume link isn’t one of ours.' });
/** A resume token as it travels. */
export type ResumeToken = z.infer<typeof ResumeToken>;

/**
 * Saving a visitor's progress (`PUT /api/public/forms/:publicKey/partials`).
 * It carries the same bot checks a submit does (AC-6330): the honeypot
 * (`company_url`), the signed fill ticket, and the body's own size cap at the
 * route. `resumeToken` is absent on the first save and given back by the
 * server; later saves send the one they were given.
 */
export const PartialBody = z.object({
  /** The answers so far, unchecked here and checked question by question on the server exactly as a submit is. */
  answers: z.record(z.string().max(40), z.unknown()),
  /** Which step the visitor was on, so the link reopens where they left off. */
  stepId: z.string().max(40).optional(),
  resumeToken: ResumeToken.optional(),
  /** The version the page was drawn from, so a resume can tell a newer one apart. */
  versionNumber: z.number().int().min(1).optional(),
  ticket: z.string().max(FILL_TICKET_MAX).optional(),
  /** The honeypot: a real visitor never fills it, and a filled one is dropped without a row. */
  company_url: z.string().max(1_000).optional(),
});
/** Saving a visitor's progress. */
export type PartialBody = z.input<typeof PartialBody>;

/** What a save answers: the token the visitor's link carries, and when it stops working. */
export const PartialSaved = z.object({
  resumeToken: ResumeToken,
  /** ISO 8601 UTC. */
  expiresAt: z.string(),
});
/** What a save answers. */
export type PartialSaved = z.infer<typeof PartialSaved>;

/**
 * Emailing the resume link to the address the visitor already gave
 * (`POST /api/public/forms/:publicKey/partials/email`). It names only the
 * token: the address comes from the saved answers on the server, so no
 * address a visitor never typed can be mailed from here.
 */
export const PartialEmailBody = z.object({
  resumeToken: ResumeToken,
  ticket: z.string().max(FILL_TICKET_MAX).optional(),
  company_url: z.string().max(1_000).optional(),
});
/** Emailing the resume link. */
export type PartialEmailBody = z.input<typeof PartialEmailBody>;

/**
 * What a valid `?resume=` token adds to the public form read: the answers and
 * the step kept for this visitor. Answers to questions the live version no
 * longer has are already dropped by the server, so the page can trust every
 * key it sees.
 */
export const ResumedFill = z.object({
  answers: z.record(z.string().max(40), z.unknown()),
  stepId: z.string().max(40).optional(),
  /** ISO 8601 UTC: when the link stops working, so the page can say so. */
  expiresAt: z.string(),
});
/** What a valid resume token adds to the public form read. */
export type ResumedFill = z.infer<typeof ResumedFill>;
