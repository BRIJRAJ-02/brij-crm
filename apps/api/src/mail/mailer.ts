// The one way the API sends email (spec 0005): a small interface, passed in,
// with a Resend implementation for deployed environments and a Mailpit one
// for a laptop. Feature code never imports a mail SDK.
import type { ApiEnv } from '../env.ts';
import { createMailpitMailer } from './mailpit.ts';
import { createResendMailer } from './resend.ts';

/** A file sent with an email: a booking's calendar file. */
export interface MailAttachment {
  readonly filename: string;
  readonly content: string;
  readonly contentType: string;
}

/** One email, in both an HTML and a plain text part, with any files. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly attachments?: readonly MailAttachment[];
  /** Where a reply goes, when not the sender (a form's owner). */
  readonly replyTo?: string;
  /**
   * Headers of its own: only `List-Unsubscribe` and `List-Unsubscribe-Post`
   * (RFC 8058's one click), which an optional email carries.
   */
  readonly headers?: Readonly<Partial<Record<'List-Unsubscribe' | 'List-Unsubscribe-Post', string>>>;
  /**
   * The send's idempotency key: the mail service sends a key it has seen in
   * the last day no second time, so a retry after a send that went through
   * never sends twice. Ids only (`email/<id>`), never an address.
   */
  readonly idempotencyKey?: string;
}

/** Sends an email, or throws. Callers decide what a failure means (a code email answers the same either way). */
export interface Mailer {
  /** Which service carries the mail, for the startup log. */
  readonly transport: 'resend' | 'mailpit';
  send(message: MailMessage): Promise<void>;
}

/**
 * Why the mail service refused a message: its own error code (never its
 * message, which can quote the address), and whether sending the same
 * message again can't help (a field it refuses, not a limit or an outage).
 */
export interface MailRefusal {
  readonly code: string;
  readonly permanent: boolean;
}

/** The error a mailer throws when its service refuses a message: a plain message, the refusal beside it. */
export function mailRefused(service: string, refusal: MailRefusal): Error & { readonly refusal: MailRefusal } {
  return Object.assign(new Error(`${service} refused the message (${refusal.code}).`), {
    name: 'MailRefused',
    refusal,
  });
}

/** The refusal a send threw, when the service refused it; undefined for a timeout, a network failure or a bug. */
export function refusalOf(error: unknown): MailRefusal | undefined {
  if (!(error instanceof Error) || !('refusal' in error)) return undefined;
  const { refusal } = error;
  return typeof refusal === 'object' && refusal !== null && 'code' in refusal && 'permanent' in refusal
    ? { code: String(refusal.code), permanent: refusal.permanent === true }
    : undefined;
}

/**
 * A mailer that starts one send at a time, each at least `gapMs` after the
 * one before started: Resend takes 2 requests a second for the whole team,
 * the api's sign in codes included, so the worker's runners never burst past
 * it. The wait is passed in for tests.
 */
export function pacedMailer(
  mailer: Mailer,
  gapMs: number,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Mailer {
  let turn: Promise<void> = Promise.resolve();
  return {
    transport: mailer.transport,
    send(message) {
      const start = turn;
      turn = start.then(() => wait(gapMs));
      return start.then(() => mailer.send(message));
    },
  };
}

/** Resend when `RESEND_API_KEY` is set, else Mailpit (the env schema allows that only locally). */
export function createMailer(env: Pick<ApiEnv, 'RESEND_API_KEY' | 'MAIL_FROM' | 'MAILPIT_URL'>): Mailer {
  if (env.RESEND_API_KEY !== undefined) return createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM });
  if (env.MAILPIT_URL !== undefined) return createMailpitMailer({ url: env.MAILPIT_URL, from: env.MAIL_FROM });
  throw new Error('No mail transport: set RESEND_API_KEY, or MAILPIT_URL locally.');
}
