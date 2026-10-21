// Test helpers for the api's own suites: an app wired to a test router, a
// database that is never reached, and a way to read the log lines it writes.
import { ENGINE_REFUSAL_CODES, type EngineRefusal } from '@crm/contracts';
import { isInvitedEmail, NO_RULE_SOURCE, type JobRegistry, type RuleSource } from '@crm/core';
import { createDatabase, createIdentityStore, type Database, type IdentityStore } from '@crm/db';
import { ORPCError, os } from '@orpc/server';
import { vi } from 'vitest';
import * as z from 'zod';
import { type AppServices, createApp } from './app.ts';
import { createAuth } from './auth/auth.ts';
import type { CalendarServices } from './calendar/services.ts';
import type { ApiEnv } from './env.ts';
import type { MailMessage, Mailer } from './mail/mailer.ts';
import type { Analytics } from './monitoring/posthog.ts';
import type { SignedOutNotice } from './realtime/signed-out.ts';
import { NO_WAKE, type WakeRelay } from './realtime/wake.ts';
import type { RequestContext } from './orpc.ts';

/** The public origin every test app trusts. */
export const APP_URL = 'https://app.test';

const NOWHERE = 'postgres://nobody:nothing@127.0.0.1:1/none';

/** A database whose address answers nothing: fine for every route that never queries. */
export function unreachableDatabase(): Database {
  return createDatabase({ url: NOWHERE, applicationName: 'crm-api-test' });
}

/** The edge secret every test app holds (ignored locally), and that the sign in helpers send. */
export const TEST_EDGE_SECRET = 'a-test-edge-secret-of-at-least-32-characters';

/** An api environment, with `overrides` on top. */
export function testEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    APP_ENV: 'local',
    NODE_ENV: 'test',
    DATABASE_URL: NOWHERE,
    IDENTITY_DATABASE_URL: NOWHERE,
    PORT: 3000,
    APP_URL,
    BETTER_AUTH_SECRET: 'local-only-test-secret-that-is-long-enough',
    BETTER_AUTH_URL: APP_URL,
    MAIL_FROM: 'Timefix <sign-in@crm.localhost>',
    MAILPIT_URL: 'http://127.0.0.1:1',
    EDGE_SECRET: TEST_EDGE_SECRET,
    // The guest link key's secret, so a test app in any APP_ENV can derive the key (outside local, booking-link.ts
    // refuses to without one, as a deployed api would never start without the wake secret it falls back to).
    BOOKING_LINK_SECRET: 'a-test-booking-link-secret-of-32-plus-characters',
    calendar: undefined,
    ...overrides,
  };
}

/** A mailer that keeps what it was asked to send, for tests that read the code without Mailpit. */
export function memoryMailer(): Mailer & { readonly sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    transport: 'mailpit',
    sent,
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

/**
 * The app's services on `db` and `identity` (both unreachable unless given), with sign in on `mailer`, a
 * relay poke that does nothing unless `wakeRelay` is given, and product events to `analytics` (none unless given).
 */
export function testServices(
  env: ApiEnv,
  options: {
    db?: Database;
    identity?: IdentityStore;
    mailer?: Mailer;
    wakeRelay?: WakeRelay;
    /** The once a minute wake every signed in request sends: none unless given, so `wakeRelay` counts writes only. */
    wakeOnUse?: WakeRelay;
    /** The overdue read's wake: none unless given. */
    wakeOverdue?: WakeRelay;
    rules?: RuleSource;
    analytics?: Analytics;
    jobs?: JobRegistry;
    /** Calendar sync's services (spec 0024): none (off) unless given, the fake provider in tests. */
    calendar?: CalendarServices;
    /** The signed out notice (spec 0033): none unless given. */
    signedOut?: SignedOutNotice;
  } = {},
): AppServices {
  const db = options.db ?? unreachableDatabase();
  const identity =
    options.identity ?? createIdentityStore({ url: env.IDENTITY_DATABASE_URL, applicationName: 'crm-api-test' });
  const mailer = options.mailer ?? memoryMailer();
  return {
    db,
    identity,
    mailer,
    auth: createAuth({
      env,
      identity,
      mailer,
      invited: (email) => isInvitedEmail({ db }, email),
      ...(options.analytics === undefined ? {} : { analytics: options.analytics }),
    }),
    wakeRelay: options.wakeRelay ?? NO_WAKE,
    wakeOnUse: options.wakeOnUse ?? NO_WAKE,
    wakeOverdue: options.wakeOverdue ?? NO_WAKE,
    // No rules unless a test injects some, named as production names its own (rules.ts).
    rules: options.rules ?? NO_RULE_SOURCE,
    ...(options.analytics === undefined ? {} : { analytics: options.analytics }),
    ...(options.jobs === undefined ? {} : { jobs: options.jobs }),
    ...(options.calendar === undefined ? {} : { calendar: options.calendar }),
    ...(options.signedOut === undefined ? {} : { signedOut: options.signedOut }),
  };
}

// Built like the engine builds them (packages/core's refusals.ts), which
// isRefusal recognises by shape.
function refusalError(refusals: readonly [EngineRefusal, ...EngineRefusal[]]): Error {
  return Object.assign(new Error(refusals[0].message), { refusal: refusals[0], refusals });
}

const t = os.$context<RequestContext>();

/** Procedures that fail on purpose, one way each. */
export const testRouter = {
  refuse: t.input(z.object({ codes: z.array(z.enum(ENGINE_REFUSAL_CODES)).min(1) })).handler(({ input }) => {
    const [first, ...rest] = input.codes.map((code, index) => ({
      code,
      message: `Refused with ${code}.`,
      attributeId: `attribute-${index}`,
    }));
    if (first === undefined) return 'nothing refused';
    throw refusalError([first, ...rest]);
  }),
  echo: t.input(z.object({ name: z.string().min(1), tags: z.array(z.string()) })).handler(({ input }) => input.name),
  crash: t.handler(() => {
    throw new Error('connection to 10.0.0.7:5432 refused, password=hunter2');
  }),
  leakyInternal: t.handler(() => {
    throw new ORPCError('INTERNAL', { status: 500, message: 'select * from secrets failed' });
  }),
  foreignCode: t.handler(() => {
    throw new ORPCError('TEAPOT', { status: 418, message: 'I am a teapot.' });
  }),
  // Shaped like a refusal, with a code the map doesn't know.
  fakeRefusal: t.handler(() => {
    const refusal = { code: 'NOT_A_CODE', message: 'Not really a refusal.' };
    throw Object.assign(new Error(refusal.message), { refusal, refusals: [refusal] });
  }),
  context: t.handler(({ context }) => ({ requestId: context.requestId, clientIp: context.clientIp ?? null })),
};

/** The test app, wired to `testRouter` and an unreachable database. */
export function createTestApp(overrides: Partial<ApiEnv> = {}) {
  const env = testEnv(overrides);
  return createApp({ services: testServices(env), env, router: testRouter });
}

/** One JSON log line. */
export interface LogLine {
  readonly level: string;
  readonly message: string;
  readonly requestId?: string;
  readonly [field: string]: unknown;
}

/** Captures what the logger writes to stdout and stderr until `restore()`. */
export function captureLogs(): { lines: () => LogLine[]; restore: () => void } {
  const written: string[] = [];
  const capture = (chunk: string | Uint8Array): boolean => {
    written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  const out = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  const err = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
  return {
    lines: () =>
      written
        .join('')
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as LogLine),
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}
