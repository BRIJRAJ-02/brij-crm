// The one way the API sends email (spec 0005): a small interface, passed in,
// with a Resend implementation for deployed environments and a Mailpit one
// for a laptop. Feature code never imports a mail SDK.
import type { ApiEnv } from '../env.ts';
import { createMailpitMailer } from './mailpit.ts';
import { createResendMailer } from './resend.ts';

/** One email, in both an HTML and a plain text part. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Sends an email, or throws. Callers decide what a failure means (a code email answers the same either way). */
export interface Mailer {
  /** Which service carries the mail, for the startup log. */
  readonly transport: 'resend' | 'mailpit';
  send(message: MailMessage): Promise<void>;
}

/** Resend when `RESEND_API_KEY` is set, else Mailpit (the env schema allows that only locally). */
export function createMailer(env: Pick<ApiEnv, 'RESEND_API_KEY' | 'MAIL_FROM' | 'MAILPIT_URL'>): Mailer {
  if (env.RESEND_API_KEY !== undefined) return createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM });
  if (env.MAILPIT_URL !== undefined) return createMailpitMailer({ url: env.MAILPIT_URL, from: env.MAIL_FROM });
  throw new Error('No mail transport: set RESEND_API_KEY, or MAILPIT_URL locally.');
}
