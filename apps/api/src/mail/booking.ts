// A booking's emails (spec 0025, Emails), drawn by `@crm/emails` from the
// words core's `prepareBookingMail` chose: the design system's layout and the
// shared footer, a plain text twin, and the calendar file when there is one.
import { renderBookingEmail } from '@crm/emails';
import type { MailMessage } from './mailer.ts';

/** A booking email's words and parts: core's `BookingMail`, the shape the worker hands over. */
export interface BookingMail {
  readonly to: string;
  readonly subject: string;
  readonly preview: string;
  readonly heading: string;
  readonly intro: string;
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly button?: { readonly label: string; readonly url: string };
  readonly footnote?: string;
  /** Why the reader got it, for the footer. */
  readonly why: string;
  readonly ics?: { readonly filename: string; readonly content: string; readonly method: 'REQUEST' | 'CANCEL' };
}

/** Where the email's links point, and which footer tag it carries: a reminder's, or every other booking email's. */
export interface BookingEmailOptions {
  readonly appOrigin: string;
  readonly medium: 'email_booking' | 'email_reminder';
}

/** A booking email, ready for a `Mailer`: subject, HTML, plain text and the calendar file. */
export async function bookingEmail(mail: BookingMail, options: BookingEmailOptions): Promise<MailMessage> {
  const { subject, html, text } = await renderBookingEmail(mail, options);
  return {
    to: mail.to,
    subject,
    html,
    text,
    ...(mail.ics === undefined
      ? {}
      : {
          attachments: [
            {
              filename: mail.ics.filename,
              content: mail.ics.content,
              contentType: `text/calendar; charset=utf-8; method=${mail.ics.method}`,
            },
          ],
        }),
  };
}
