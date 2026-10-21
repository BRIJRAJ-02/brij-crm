// `pnpm --filter @crm/emails preview -- --port 6060`: every email with its
// sample params, in a browser. The index lists each with its subject and
// preview line; each opens light, dark (its dark stylesheet applied whatever
// the system's setting) or as its plain text part. It serves the footer's
// logo from apps/web/public/brand, as the app does, so the emails draw
// exactly as they will arrive. A local tool: it binds to 127.0.0.1 only.
import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import {
  renderBookingEmail,
  renderMemberInvite,
  renderSignInCode,
  type BookingWords,
  type RenderedEmail,
} from '../src/index.ts';

const BRAND = path.resolve(import.meta.dirname, '../../../apps/web/public/brand');

/** A booking confirmation's words, as core writes them for the visitor. */
const BOOKING_CONFIRMATION: BookingWords = {
  subject: 'Booked: Intro call with Ada Lovelace',
  preview: 'Monday 2 November 2026, 9:00 AM to 9:30 AM (Europe/London)',
  heading: 'You’re booked',
  intro: 'Ada Lovelace has been told. Here are the details.',
  rows: [
    { label: 'What', value: 'Intro call' },
    { label: 'When', value: 'Monday 2 November 2026, 9:00 AM to 9:30 AM (Europe/London)' },
    { label: 'With', value: 'Ada Lovelace' },
    { label: 'Where', value: 'https://meet.google.com/abc-defg-hij' },
  ],
  button: { label: 'View your booking', url: '/b/intro-call/manage?t=preview' },
  footnote: 'Need to change it? Move it to another time or cancel it from your booking page.',
  why: 'You got this email because this address was used to book Intro call with Ada Lovelace.',
};

/** Every email the preview shows. */
export const PREVIEW_KINDS: readonly string[] = [
  'sign_in_code',
  'booking_confirmation',
  'booking_reminder',
  'member_invite',
];

/** One email drawn with its sample params, its links on `origin`. */
export function drawSample(kind: string, origin: string): Promise<RenderedEmail> {
  const onOrigin = (words: BookingWords): BookingWords =>
    words.button === undefined ? words : { ...words, button: { ...words.button, url: `${origin}${words.button.url}` } };
  switch (kind) {
    case 'sign_in_code':
      return renderSignInCode('482913', { appOrigin: origin });
    case 'booking_confirmation':
      return renderBookingEmail(onOrigin(BOOKING_CONFIRMATION), { appOrigin: origin, medium: 'email_booking' });
    case 'booking_reminder':
      return renderBookingEmail(
        {
          ...BOOKING_CONFIRMATION,
          subject: 'Tomorrow: Intro call with Ada Lovelace',
          heading: 'Your booking is tomorrow',
          intro: 'A reminder of your time with Ada Lovelace.',
          button: { label: 'Join the call', url: 'https://meet.google.com/abc-defg-hij' },
          footnote: `Need to change it? Your booking page: ${origin}/b/intro-call/manage?t=preview`,
        },
        { appOrigin: origin, medium: 'email_reminder' },
      );
    case 'member_invite':
      return renderMemberInvite(
        {
          inviterName: 'Ada Lovelace',
          role: 'member',
          acceptPath: '/invite/sample-token-for-the-preview',
          expiresAt: '2026-10-28T13:05:00.000Z',
        },
        { appOrigin: origin, workspaceName: 'Acme' },
      );
    default:
      return Promise.reject(new Error(`No email called ${kind}.`));
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
  return /<div[^>]*data-skip-in-text="true"[^>]*>([^<]*)/.exec(html)?.[1] ?? '';
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
