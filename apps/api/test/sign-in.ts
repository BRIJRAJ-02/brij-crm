// Test helpers for signing in for real: the app on a test database, codes
// sent to Mailpit and read back through its API (`GET /api/v1/messages`, then
// `GET /api/v1/message/{id}`), and an oRPC client carrying the session cookie.
import { randomInt, randomUUID } from 'node:crypto';
import type { RuleSource } from '@crm/core';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { AnyRouter, RouterClient } from '@orpc/server';
import { inject } from 'vitest';
import * as z from 'zod';
import { createApp } from '../src/app.ts';
import type { ApiEnv } from '../src/env.ts';
import { createMailpitMailer } from '../src/mail/mailpit.ts';
import type { Mailer } from '../src/mail/mailer.ts';
import type { WakeRelay } from '../src/realtime/wake.ts';
import type { router } from '../src/router.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../src/edge.ts';
import { APP_URL, TEST_EDGE_SECRET, testEnv, testServices } from '../src/testing.ts';

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
  options: { mailer?: Mailer; router?: AnyRouter; wakeRelay?: WakeRelay; rules?: RuleSource } = {},
) {
  const env = testEnv(overrides);
  const mailer = options.mailer ?? createMailpitMailer({ url: MAILPIT_URL, from: env.MAIL_FROM });
  const services = testServices(env, {
    ...connections,
    mailer,
    ...(options.wakeRelay ? { wakeRelay: options.wakeRelay } : {}),
    ...(options.rules ? { rules: options.rules } : {}),
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
