// Mail in deployed environments: Resend. The only module that imports its SDK.
import { Resend } from 'resend';
import type { Mailer } from './mailer.ts';

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
      const { error } = await resend.emails.send({
        from: options.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      // Only the error's name: its message can quote the recipient.
      if (error) throw new Error(`Resend refused the message (${error.name}).`);
    },
  };
}
