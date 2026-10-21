// Mail in deployed environments: Resend. The only module that imports its SDK.
import { Resend } from 'resend';
import { mailRefused, type Mailer } from './mailer.ts';

/**
 * Resend's codes for a message it will refuse however often it is sent: a
 * field it can't take. A limit, an outage, a key or a sender that isn't set
 * up yet (the owner can fix those while tries remain) is tried again.
 */
const PERMANENT: ReadonlySet<string> = new Set([
  'invalid_attachment',
  'invalid_idempotency_key',
  'invalid_parameter',
  'missing_required_field',
]);

/** How long one send may take before it counts as failed (and is tried again). */
const SEND_TIMEOUT_MS = 10_000;

/** The API key and the sender (`onboarding@resend.dev` until a domain is verified). */
export interface ResendOptions {
  readonly apiKey: string;
  readonly from: string;
}

/** A mailer that sends through Resend. Its SDK answers `{ data, error }` rather than throwing; this throws. */
export function createResendMailer(options: ResendOptions): Mailer {
  const resend = new Resend(options.apiKey);
  return {
    transport: 'resend',
    async send(message) {
      const { error } = await resend.emails.send(
        {
          from: options.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
          ...(message.headers === undefined ? {} : { headers: { ...message.headers } }),
          ...(message.attachments === undefined || message.attachments.length === 0
            ? {}
            : {
                attachments: message.attachments.map((file) => ({
                  filename: file.filename,
                  content: Buffer.from(file.content, 'utf8'),
                  contentType: file.contentType,
                })),
              }),
        },
        {
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          ...(message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey }),
        },
      );
      if (error === null) return;
      // Only the error's code: its message can quote the recipient. A 400 `validation_error` is a field it refuses;
      // its 403 is a sender or domain not set up yet. The key used before with another message (an email drawn
      // differently since) can't be resent under it, and whether the first went is unknown: the caller decides.
      const permanent =
        PERMANENT.has(error.name) ||
        error.name === 'invalid_idempotent_request' ||
        (error.name === 'validation_error' && error.statusCode !== 403);
      throw mailRefused('Resend', { code: error.name, permanent });
    },
  };
}
