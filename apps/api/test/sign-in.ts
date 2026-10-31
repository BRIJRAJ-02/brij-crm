// Test helpers for signing in for real: the app on a test database, codes
// sent to Mailpit and read back through its API (`GET /api/v1/messages`, then
// `GET /api/v1/message/{id}`), and an oRPC client carrying the session cookie.
import type { FileStore } from '../src/storage/blob.ts';
import { randomInt, randomUUID } from 'node:crypto';
import type { JobRegistry, RuleSource } from '@crm/core';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { AnyRouter, RouterClient } from '@orpc/server';
import { inject } from 'vitest';
import * as z from 'zod';
import { createApp } from '../src/app.ts';
import type { CalendarServices } from '../src/calendar/services.ts';
import type { ApiEnv } from '../src/env.ts';
import { createMailpitMailer } from '../src/mail/mailpit.ts';
import type { Mailer } from '../src/mail/mailer.ts';
import type { Analytics } from '../src/monitoring/posthog.ts';
import type { SignedOutNotice } from '../src/realtime/signed-out.ts';
import type { WakeRelay } from '../src/realtime/wake.ts';
import type { router } from '../src/router.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../src/edge.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../src/testing.ts';
import { totpCode } from '../src/auth/two-factor.ts';
import type { WebhookSender } from '../src/jobs/webhook-deliver.ts';

/** What Vercel's middleware adds to every request it proxies (outside local; ignored locally). */
const THROUGH_THE_EDGE = { [EDGE_HEADER]: TEST_EDGE_SECRET, [ORIGIN_HEADER]: APP_URL };

/** Mailpit's API, from docker-compose.yml. */
export const MAILPIT_URL = process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025';

/** A fresh address nobody has used. */
export const newEmail = (): string => `${randomUUID().slice(0, 12)}@example.com`;

/**
 * A fresh client IP, random over 10.0.0.0/8 (16 million addresses), so per IP limits never collide between
 * tests. (A /16 gave CI a collision across a few hundred tests; IPv6 is stored compressed, so tests compare
 * addresses as IPv4.)
 */
export const newIp = (): string => `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;

/** The test database as the app sees it: the tenant pool (app login) and the identity store (identity login). */
export function testConnections(): { db: Database; identity: IdentityStore } {
  const { appUrl, identityUrl } = inject('testDatabase');
  return {
    db: createDatabase({ url: appUrl, applicationName: 'crm-api-tests' }),
    identity: createIdentityStore({ url: identityUrl, applicationName: 'crm-api-tests' }),
  };
}

/** The real app on the test database, sending code emails to Mailpit unless `mailer` says otherwise. */
export function signInApp(
  connections: { db: Database; identity: IdentityStore },
  overrides: Partial<ApiEnv> = {},
  options: {
    mailer?: Mailer;
    router?: AnyRouter;
    wakeRelay?: WakeRelay;
    wakeOnUse?: WakeRelay;
    wakeOverdue?: WakeRelay;
    rules?: RuleSource;
    analytics?: Analytics;
    jobs?: JobRegistry;
    calendar?: CalendarServices;
    signedOut?: SignedOutNotice;
    files?: FileStore;
    webhookSender?: WebhookSender;
  } = {},
) {
  const env = testEnv(overrides);
  const mailer = options.mailer ?? createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM });
  const services = testServices(env, {
    ...connections,
    mailer,
    ...(options.wakeRelay ? { wakeRelay: options.wakeRelay } : {}),
    ...(options.wakeOnUse ? { wakeOnUse: options.wakeOnUse } : {}),
    ...(options.wakeOverdue ? { wakeOverdue: options.wakeOverdue } : {}),
    ...(options.rules ? { rules: options.rules } : {}),
    ...(options.analytics ? { analytics: options.analytics } : {}),
    ...(options.jobs ? { jobs: options.jobs } : {}),
    ...(options.calendar ? { calendar: options.calendar } : {}),
    ...(options.signedOut ? { signedOut: options.signedOut } : {}),
    ...(options.files ? { files: options.files } : {}),
    ...(options.webhookSender ? { webhookSender: options.webhookSender } : {}),
  });
  return { app: createApp({ services, env, ...(options.router ? { router: options.router } : {}) }), services };
}

type App = ReturnType<typeof signInApp>['app'];

/** A POST to one of Better Auth's routes, as the web app sends it through the edge. */
export function authPost(
  app: App,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`${APP_URL}/api/auth${path}`, {
        method: 'POST',
        headers: { origin: APP_URL, 'content-type': 'application/json', ...THROUGH_THE_EDGE, ...headers },
        body: JSON.stringify(body),
      }),
    ),
  );
}

/** Asks for a sign in code for `email`, from `ip`. */
export function sendCode(app: App, email: string, ip: string, headers: Record<string, string> = {}) {
  return authPost(
    app,
    '/email-otp/send-verification-otp',
    { email, type: 'sign-in' },
    {
      'x-forwarded-for': ip,
      ...headers,
    },
  );
}

/** Signs in with a code, from `ip`. */
export function verifyCode(app: App, email: string, otp: string, ip: string, headers: Record<string, string> = {}) {
  return authPost(app, '/sign-in/email-otp', { email, otp }, { 'x-forwarded-for': ip, ...headers });
}

const MessageList = z.object({
  messages: z.array(z.object({ ID: z.string(), To: z.array(z.object({ Address: z.string() })).nullable() })),
});
const Message = z.object({ Subject: z.string(), Text: z.string(), HTML: z.string() });

/** The emails Mailpit holds for `email`, newest first. */
export async function mailTo(email: string): Promise<z.infer<typeof Message>[]> {
  const list = MessageList.parse(await (await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`)).json());
  const ids = list.messages
    .filter((message) => (message.To ?? []).some((to) => to.Address.toLowerCase() === email.toLowerCase()))
    .map((message) => message.ID);
  return Promise.all(
    ids.map(async (id) => Message.parse(await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json())),
  );
}

/** The newest code Mailpit holds for `email`. Fails if none arrives. */
export async function codeFor(email: string): Promise<string> {
  const [latest] = await mailTo(email);
  const code = latest === undefined ? undefined : /\b(\d{6})\b/.exec(latest.Text)?.[1];
  if (code === undefined) throw new Error(`No sign in code reached Mailpit for ${email}.`);
  return code;
}

/** The cookie header a browser would send back after this response. */
export function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((cookie) => !cookie.endsWith('='))
    .join('; ');
}

/** Signs `email` in by a code read from Mailpit, and returns the session cookie. */
export async function signIn(app: App, email = newEmail(), ip = newIp()): Promise<{ email: string; cookie: string }> {
  const sent = await sendCode(app, email, ip);
  if (sent.status !== 200) throw new Error(`Sending a code answered ${sent.status}: ${await sent.text()}`);
  const signedIn = await verifyCode(app, email, await codeFor(email), ip);
  if (signedIn.status !== 200) throw new Error(`Signing in answered ${signedIn.status}: ${await signedIn.text()}`);
  return { email, cookie: cookieFrom(signedIn) };
}

/**
 * A POST to one procedure with a body written by hand (`{"json": …}`, oRPC's
 * RPC body), as a browser signed in with `cookie` would send it: for inputs
 * the typed client can't serialize, such as JSON nested thousands deep.
 */
export function rpcPost(app: App, cookie: string, procedure: string, jsonText: string): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request(`${APP_URL}/api/rpc/${procedure}`, {
        method: 'POST',
        headers: { origin: APP_URL, 'content-type': 'application/json', ...THROUGH_THE_EDGE, cookie },
        body: `{"json":${jsonText}}`,
      }),
    ),
  );
}

/** A typed client for the app's contract, sending `cookie` like a signed in browser. */
export function rpcClient(app: App, cookie?: string): RouterClient<typeof router> {
  return createORPCClient(
    new RPCLink({
      url: `${APP_URL}/api/rpc`,
      headers: { origin: APP_URL, ...THROUGH_THE_EDGE, ...(cookie === undefined ? {} : { cookie }) },
      fetch: async (request) => app.fetch(request),
    }),
  );
}

/** The secret an otpauth URI carries (base32), as the plugin keys its codes: the text it encoded. */
export function secretOf(uri: string): string {
  const encoded = new URL(uri).searchParams.get('secret') ?? '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of encoded.toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let at = 0; at + 8 <= bits.length; at += 8) bytes.push(Number.parseInt(bits.slice(at, at + 8), 2));
  return Buffer.from(bytes).toString('utf8');
}

/** Merges cookie headers, later ones winning (a renewed session replaces the old). */
export function withCookies(...cookies: string[]): string {
  const jar = new Map<string, string>();
  for (const header of cookies) {
    for (const pair of header.split('; ').filter((each) => each !== '')) {
      const [name = ''] = pair.split('=');
      jar.set(name, pair);
    }
  }
  return [...jar.values()].join('; ');
}

/**
 * Turns two factor on for the session `cookie` names (just signed in, so
 * fresh): sets the app up and confirms it with a code (spec 0033). Answers
 * the renewed cookie, the app's secret and the backup codes.
 */
export async function turnOnTwoFactor(
  app: App,
  cookie: string,
): Promise<{ cookie: string; secret: string; backupCodes: string[] }> {
  const enabled = await authPost(app, '/two-factor/enable', {}, { cookie });
  if (enabled.status !== 200)
    throw new Error(`Enabling two factor answered ${enabled.status}: ${await enabled.text()}`);
  const setup = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
  const secret = secretOf(setup.totpURI);
  const confirmed = await authPost(app, '/two-factor/verify-totp', { code: totpCode(secret) }, { cookie });
  if (confirmed.status !== 200) throw new Error(`Confirming the app answered ${confirmed.status}`);
  return { cookie: withCookies(cookie, cookieFrom(confirmed)), secret, backupCodes: setup.backupCodes };
}
