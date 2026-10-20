// A booking's emails (spec 0025, Emails), drawn with React Email from the
// words core's `prepareBookingMail` chose: a heading, a short line, a table of
// label and value rows, one button, a quiet footnote, and the calendar file
// when there is one. Like the sign in code email, the elements are made with
// createElement (Node runs this file with no build step), styles are inline
// (email clients ignore stylesheets), and colours are literals that follow the
// design tokens' light theme, since an inbox can't read the app's CSS. Every
// message has a plain text twin.
import { createElement as h } from 'react';
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  render,
  Row,
  Section,
  Text,
} from 'react-email';
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
  readonly ics?: { readonly filename: string; readonly content: string; readonly method: 'REQUEST' | 'CANCEL' };
}

// The design tokens' light values (packages/tokens): ground, card, ink, muted ink, hairline and the one blue.
const GROUND = '#f6f6f4';
const CARD = '#ffffff';
const INK = '#1b1b18';
const MUTED = '#6b6b63';
const HAIRLINE = '#e6e6e1';
const ACCENT = '#1f5fd6';

const font = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const page = { backgroundColor: GROUND, fontFamily: font, margin: '0', padding: '0' };
const card = { backgroundColor: CARD, borderRadius: '12px', margin: '32px auto', padding: '32px', maxWidth: '520px' };
const heading = { color: INK, fontSize: '20px', fontWeight: 600, lineHeight: '28px', margin: '0 0 8px' };
const intro = { color: INK, fontSize: '14px', lineHeight: '22px', margin: '0 0 20px' };
const label = { color: MUTED, fontSize: '12px', lineHeight: '20px', width: '72px', verticalAlign: 'top' };
const value = { color: INK, fontSize: '14px', lineHeight: '20px', wordBreak: 'break-word' as const };
const rowGap = { padding: '6px 0' };
const button = {
  backgroundColor: ACCENT,
  borderRadius: '8px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '14px',
  fontWeight: 600,
  padding: '10px 18px',
  textDecoration: 'none',
};
const rule = { borderColor: HAIRLINE, margin: '24px 0 16px' };
const foot = { color: MUTED, fontSize: '12px', lineHeight: '18px', margin: '0' };

function BookingEmail({ mail }: { readonly mail: BookingMail }) {
  return h(
    Html,
    { lang: 'en' },
    h(Head, null),
    h(
      Body,
      { style: page },
      h(Preview, null, mail.preview),
      h(
        Container,
        { style: card },
        h(Heading, { as: 'h1', style: heading }, mail.heading),
        h(Text, { style: intro }, mail.intro),
        h(
          Section,
          null,
          ...mail.rows.map((row, index) =>
            h(Row, {
              key: String(index),
              style: rowGap,
              children: [
                h(Column, { key: 'label', style: label }, row.label),
                h(Column, { key: 'value', style: value }, row.value),
              ],
            }),
          ),
        ),
        mail.button === undefined
          ? null
          : h(
              Section,
              { style: { marginTop: '24px' } },
              h(Button, { href: mail.button.url, style: button }, mail.button.label),
            ),
        mail.footnote === undefined ? null : h(Hr, { style: rule }),
        mail.footnote === undefined ? null : h(Text, { style: foot }, mail.footnote),
      ),
    ),
  );
}

/** The plain text twin: every row and link written out, for a client with HTML off and for screen readers. */
export function bookingEmailText(mail: BookingMail): string {
  return [
    mail.heading,
    '',
    mail.intro,
    '',
    ...mail.rows.map((row) => `${row.label}: ${row.value}`),
    ...(mail.button === undefined ? [] : ['', `${mail.button.label}: ${mail.button.url}`]),
    ...(mail.footnote === undefined ? [] : ['', mail.footnote]),
  ].join('\n');
}

/** A booking email, ready for a `Mailer`: subject, HTML, plain text and the calendar file. */
export async function bookingEmail(mail: BookingMail): Promise<MailMessage> {
  const html = await render(h(BookingEmail, { mail }));
  return {
    to: mail.to,
    subject: mail.subject,
    html,
    text: bookingEmailText(mail),
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
