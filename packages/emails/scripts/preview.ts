// `pnpm --filter @crm/emails preview -- --port 6060`: every email with its
// sample params, in a browser. The index lists each with its subject and
// preview line; each opens light, dark (its dark stylesheet applied whatever
// the system's setting) or as its plain text part. It serves the footer's
// logo from apps/web/public/brand, as the app does, so the emails draw
// exactly as they will arrive. A local tool: it binds to 127.0.0.1 only.
import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { EmailKind } from '@crm/contracts/emails';
import {
  CATALOG,
  renderBookingEmail,
  renderEmail,
  renderMemberInvite,
  renderNotificationsEmail,
  renderSignInCode,
  topicOf,
  type BookingWords,
  type RenderedEmail,
} from '../src/index.ts';

const BRAND = path.resolve(import.meta.dirname, '../../../apps/web/public/brand');

/** The visitor's booking page: the app path its links take (the origin is added when drawn). */
const MANAGE = '/b/intro-call/manage?t=preview';
const WHEN = { line: 'Monday, 2 November 2026, 09:00 to 09:30', zone: 'London time (GMT)' } as const;
const VISITOR_WHY = 'You got this email because this address was used to book Intro call with Ada Lovelace.';

/** A booking confirmation's words, as core writes them for the visitor of a meeting with a video call. */
const BOOKING_CONFIRMATION: BookingWords = {
  subject: 'Booked: Intro call with Ada Lovelace',
  preview: 'Monday, 2 November 2026, 09:00 to 09:30, London time (GMT)',
  heading: 'You’re booked with Ada Lovelace',
  intro: '',
  when: WHEN,
  rows: [
    { label: 'What', value: 'Intro call, 30 min' },
    { label: 'With', value: 'Ada Lovelace' },
    { label: 'Where', value: 'Google Meet' },
  ],
  button: { label: 'Join Google Meet', url: 'https://meet.google.com/abc-defg-hij' },
  calendarUrl: '/api/public/booking/manage/preview/ics',
  change: { url: MANAGE },
  why: VISITOR_WHY,
  reply: 'Reply to reach Ada Lovelace',
};

/** Each booking email the preview shows, as core writes it: the visitor's, a guest's and the host's. */
const BOOKING_SAMPLES: Readonly<Record<string, { readonly words: BookingWords; readonly reminder?: boolean }>> = {
  booking_confirmation: { words: BOOKING_CONFIRMATION },
  booking_confirmation_place: {
    words: {
      ...BOOKING_CONFIRMATION,
      rows: [
        { label: 'What', value: 'Intro call, 30 min' },
        { label: 'With', value: 'Ada Lovelace' },
        { label: 'Where', value: '12 Hanover Square, London W1S 1JD' },
      ],
      button: { label: 'View your booking', url: MANAGE },
    },
  },
  booking_reminder: {
    reminder: true,
    words: {
      ...BOOKING_CONFIRMATION,
      subject: 'Tomorrow: Intro call with Ada Lovelace',
      heading: 'Your booking is tomorrow',
      intro: 'A reminder of your time with Ada Lovelace.',
    },
  },
  booking_moved: {
    words: {
      ...BOOKING_CONFIRMATION,
      subject: 'Moved: Intro call with Ada Lovelace',
      heading: 'Ada Lovelace moved your booking',
      intro: 'Ada Lovelace picked a new time. If it doesn’t suit you, move it again or cancel it.',
      rows: [
        { label: 'What', value: 'Intro call, 30 min' },
        { label: 'Was', value: 'Friday, 30 October 2026, 14:00 to 14:30, London time (GMT)' },
        { label: 'Where', value: 'Google Meet' },
      ],
    },
  },
  booking_cancelled: {
    words: {
      subject: 'Cancelled: Intro call with Ada Lovelace',
      preview: 'Monday, 2 November 2026, 09:00 to 09:30, London time (GMT)',
      heading: 'Ada Lovelace cancelled your booking',
      intro: 'Ada Lovelace cancelled Intro call. It comes off your calendar.',
      when: { ...WHEN, struck: true },
      rows: [{ label: 'What', value: 'Intro call, 30 min' }],
      quote: '“Something came up at work. Sorry, please pick another time.”',
      button: { label: 'Book another time', url: '/ada/intro-call' },
      why: VISITOR_WHY,
      reply: 'Reply to reach Ada Lovelace',
    },
  },
  booking_request: {
    words: {
      subject: 'Request received: Intro call with Ada Lovelace',
      preview: 'Monday, 2 November 2026, 09:00 to 09:30, London time (GMT)',
      heading: 'Request received',
      intro: 'Ada Lovelace will confirm or decline it. You’ll get an email either way.',
      when: WHEN,
      rows: [
        { label: 'What', value: 'Intro call, 30 min' },
        { label: 'With', value: 'Ada Lovelace' },
      ],
      button: { label: 'View your request', url: MANAGE },
      why: VISITOR_WHY,
    },
  },
  booking_invitation: {
    words: {
      subject: 'Invitation: Intro call with Ada Lovelace',
      preview: 'Grace Hopper added you to Intro call.',
      heading: 'You’re invited',
      intro: 'Grace Hopper invited you to Intro call, hosted by Ada Lovelace.',
      when: WHEN,
      rows: [
        { label: 'What', value: 'Intro call, 30 min' },
        { label: 'Where', value: 'Google Meet' },
      ],
      button: { label: 'Join Google Meet', url: 'https://meet.google.com/abc-defg-hij' },
      why: 'You got this email because Grace Hopper added this address to Intro call.',
    },
  },
  booking_new: {
    words: {
      subject: 'New booking: Intro call with Grace Hopper',
      preview: 'Monday, 2 November 2026, 09:00 to 09:30, London time (GMT)',
      heading: 'New booking',
      intro: 'Grace Hopper booked Intro call.',
      when: WHEN,
      rows: [
        { label: 'Their time', value: 'Monday, November 2, 2026, 4:00 AM to 4:30 AM, New York time (GMT-5)' },
        { label: 'Who', value: 'Grace Hopper (grace@navy.example)' },
        { label: 'Where', value: 'https://meet.google.com/abc-defg-hij' },
        { label: 'Note', value: 'About the compiler.' },
      ],
      button: { label: 'Open booking', url: '/w/acme/bookings/list?open=preview' },
      why: 'You got this email because you host Intro call.',
    },
  },
};

/** Every email the preview shows: the sign in code, each booking email, then each kind with a template. */
export const PREVIEW_KINDS: readonly string[] = [
  'sign_in_code',
  ...Object.keys(BOOKING_SAMPLES),
  ...Object.keys(CATALOG),
  'notifications',
];

/** One email drawn with its sample params, its links on `origin`. */
export function drawSample(kind: string, origin: string): Promise<RenderedEmail> {
  // A path becomes an address on the preview's origin; a call's own address stays as it is.
  const onOrigin = (link: string) => (link.startsWith('/') ? `${origin}${link}` : link);
  const sample = BOOKING_SAMPLES[kind];
  if (sample !== undefined) {
    const { words } = sample;
    return renderBookingEmail(
      {
        ...words,
        ...(words.button === undefined ? {} : { button: { ...words.button, url: onOrigin(words.button.url) } }),
        ...(words.calendarUrl === undefined ? {} : { calendarUrl: onOrigin(words.calendarUrl) }),
        ...(words.change === undefined ? {} : { change: { url: onOrigin(words.change.url) } }),
      },
      { appOrigin: origin, medium: sample.reminder === true ? 'email_reminder' : 'email_booking' },
    );
  }
  switch (kind) {
    case 'sign_in_code':
      return renderSignInCode('482913', { appOrigin: origin });
    case 'member_invite':
      return renderMemberInvite(CATALOG.member_invite.sample, { appOrigin: origin, workspaceName: 'Acme' });
    case 'notifications':
      return renderNotificationsEmail(
        {
          items: [
            {
              sentence: 'Ada Lovelace mentioned you',
              recordName: 'Acme Corp',
              excerpt: 'Over to @Grace Hopper for the contract. Can you send it by Friday?',
              path: '/w/acme/objects/companies/0199a6f2-0000-7000-8000-0000000000a1/comments?thread=0199a6f2-0000-7000-8000-0000000000b1',
            },
            {
              sentence: 'Alan Turing assigned you a task',
              excerpt: 'Send the renewal quote',
              path: '/w/acme/inbox?task=0199a6f2-0000-7000-8000-0000000000c1',
            },
          ],
          more: 0,
          inboxPath: '/w/acme/inbox',
          settingsPath: '/w/acme/settings/account/notifications',
        },
        { appOrigin: origin, workspaceName: 'Acme' },
      );
    default: {
      if (!(kind in CATALOG)) return Promise.reject(new Error(`No email called ${kind}.`));
      const templated = kind as EmailKind;
      return renderEmail(templated, CATALOG[templated].sample, {
        appOrigin: origin,
        workspaceName: 'Acme',
        ...(topicOf(templated) === undefined ? {} : { preferencesUrl: `${origin}/email-preferences#t=preview` }),
      });
    }
  }
}

/** The email as a dark reader sees it: its dark rules applied whatever the browser's setting. */
export function forceDark(html: string): string {
  return html.replaceAll('@media (prefers-color-scheme: dark)', '@media all');
}

/** Escapes text for the index page. */
function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Pulls the preview line out of the drawn HTML (React Email's hidden preheader). */
function preheaderOf(html: string): string {
  return /<div style="display:none;overflow:hidden;line-height:1px[^"]*">([^<]*)/.exec(html)?.[1] ?? '';
}

async function index(origin: string): Promise<string> {
  const rows = await Promise.all(
    PREVIEW_KINDS.map(async (kind) => {
      const email = await drawSample(kind, origin);
      return `<tr><td><code>${escape(kind)}</code></td><td>${escape(email.subject)}<br><small>${escape(
        preheaderOf(email.html),
      )}</small></td><td><a href="/email/${kind}">Light</a> · <a href="/email/${kind}?scheme=dark">Dark</a> · <a href="/email/${kind}.txt">Text</a></td></tr>`;
    }),
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Timefix emails</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:14px/1.5 system-ui,sans-serif;margin:32px;color-scheme:light dark}td{padding:8px 16px 8px 0;vertical-align:top}small{opacity:.7}</style></head><body><h1>Timefix emails</h1><p>Each email with sample params. Dark applies the email's own dark stylesheet.</p><table>${rows.join('')}</table></body></html>`;
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

/** What the preview answers for one request. */
interface Answer {
  readonly status: number;
  readonly type: string;
  readonly body: string | Buffer;
}

/** The answer for a request: the index, one email (HTML or text), a logo file, or not found. */
async function answer(target: string, origin: string): Promise<Answer> {
  const html = 'text/html; charset=utf-8';
  const plain = 'text/plain; charset=utf-8';
  let url: URL;
  try {
    url = new URL(target, origin);
  } catch {
    return { status: 400, type: plain, body: 'Bad request' };
  }
  if (url.pathname === '/') return { status: 200, type: html, body: await index(origin) };
  const text = /^\/email\/([a-z_]+)\.txt$/.exec(url.pathname)?.[1];
  if (text !== undefined && PREVIEW_KINDS.includes(text)) {
    return { status: 200, type: plain, body: (await drawSample(text, origin)).text };
  }
  const page = /^\/email\/([a-z_]+)$/.exec(url.pathname)?.[1];
  if (page !== undefined && PREVIEW_KINDS.includes(page)) {
    const drawn = (await drawSample(page, origin)).html;
    return { status: 200, type: html, body: url.searchParams.get('scheme') === 'dark' ? forceDark(drawn) : drawn };
  }
  const file = /^\/brand\/([a-z0-9/-]+\.png)$/.exec(url.pathname)?.[1];
  if (file !== undefined && !file.includes('..')) {
    return { status: 200, type: 'image/png', body: await readFile(path.join(BRAND, file)) };
  }
  return { status: 404, type: plain, body: 'Not found' };
}

/** Starts the preview server on 127.0.0.1. A failure is told on the console, never in the answer. */
export function startPreview(port: number): ReturnType<typeof createServer> {
  const origin = `http://127.0.0.1:${String(port)}`;
  const server = createServer((request, response) => {
    void answer(request.url ?? '/', origin)
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        return { status: 500, type: 'text/plain; charset=utf-8', body: 'Failed' };
      })
      .then(({ status, type, body }) => {
        send(response, status, type, body);
      });
  });
  server.listen(port, '127.0.0.1');
  return server;
}

if (import.meta.main) {
  const flag = process.argv.indexOf('--port');
  const port = flag === -1 ? 6060 : Number(process.argv[flag + 1]);
  if (!Number.isInteger(port) || port <= 0) throw new Error('--port takes a port number.');
  startPreview(port);
  console.log(`Email preview on http://127.0.0.1:${String(port)}`);
}
