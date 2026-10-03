// Test helpers for the api's own suites: an app wired to a test router, a
// database that is never reached, and a way to read the log lines it writes.
import { ENGINE_REFUSAL_CODES, type EngineRefusal } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { ORPCError, os } from '@orpc/server';
import { vi } from 'vitest';
import * as z from 'zod';
import { createApp } from './app.ts';
import type { ApiEnv } from './env.ts';
import type { RequestContext } from './orpc.ts';

/** The public origin every test app trusts. */
export const APP_URL = 'https://app.test';

/** A database whose address answers nothing: fine for every route that never queries. */
export function unreachableDatabase(): Database {
  return createDatabase({ url: 'postgres://nobody:nothing@127.0.0.1:1/none', applicationName: 'crm-api-test' });
}

/** An api environment, with `overrides` on top. */
export function testEnv(overrides: Partial<ApiEnv> = {}): ApiEnv {
  return {
    APP_ENV: 'local',
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
    PORT: 3000,
    APP_URL,
    ...overrides,
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
  return createApp({ db: unreachableDatabase(), env: testEnv(overrides), router: testRouter });
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
