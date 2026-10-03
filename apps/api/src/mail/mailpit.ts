// Mail on a laptop: Mailpit (docker-compose.yml) catches every email, and its
// HTTP API both takes a message (`POST /api/v1/send`) and lets tests read it.
import type { Mailer } from './mailer.ts';

/** Where Mailpit listens, who the mail is from, and (for tests) the fetch to use. */
export interface MailpitOptions {
  readonly url: string;
  readonly from: string;
  readonly fetch?: typeof fetch;
}

/** Splits `Name <address>` into its parts; a bare address has no name. */
export function parseSender(from: string): { readonly name: string | undefined; readonly email: string } {
  const named = /^(.+?)\s*<([^<>]+)>$/.exec(from.trim());
  return named?.[1] !== undefined && named[2] !== undefined
    ? { name: named[1], email: named[2] }
    : { name: undefined, email: from.trim() };
}

/** A mailer that hands each message to Mailpit's send API. */
export function createMailpitMailer(options: MailpitOptions): Mailer {
  const post = options.fetch ?? fetch;
  const endpoint = new URL('/api/v1/send', options.url);
  const sender = parseSender(options.from);
  return {
    transport: 'mailpit',
    async send(message) {
      const response = await post(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: { Email: sender.email, Name: sender.name ?? '' },
          To: [{ Email: message.to }],
          Subject: message.subject,
          HTML: message.html,
          Text: message.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Mailpit refused the message with ${response.status}.`);
    },
  };
}
