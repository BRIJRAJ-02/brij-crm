// A failed query never leaves with its values (spec 0010, AC-165): drizzle
// puts the bound parameters in its error message, so a real failing query on
// a real Postgres must reach neither a log line nor Sentry with them.
import { randomUUID } from 'node:crypto';
import type { Database } from '@crm/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryTransport } from '../test/sentry.ts';
import { testConnections } from '../test/sign-in.ts';
import { errorFields, log } from './log.ts';
import { captureFault, flush, sentryOptions, startSentry } from './monitoring/sentry.ts';
import { queryFailure, safeError } from './query-errors.ts';
import { captureLogs } from './testing.ts';

/** A session token, as a failed query on the sessions table would bind it: nothing scrub would mark on its own. */
const SECRET = `tok_${randomUUID().replaceAll('-', '')}`;

let db: Database;
let failed: unknown;

beforeAll(async () => {
  const connections = testConnections();
  db = connections.db;
  await connections.identity.close();
  // A bound value Postgres refuses: drizzle's error message quotes it after `params:`.
  failed = await db
    .withWorkspace(randomUUID(), (tx) => tx.execute(sql`select ${SECRET}::uuid as id`))
    .then(
      () => undefined,
      (error: unknown) => error,
    );
});
afterAll(async () => {
  await flush(2000);
  await db.close();
});

describe('a failed query', () => {
  it('really carries its bound value, which is why this exists', () => {
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toContain(SECRET);
  });

  it('is known by its SQLSTATE, and turned into an error that names only that', () => {
    expect(queryFailure(failed)).toEqual({ code: '22P02' });
    const safe = safeError(failed);
    expect(safe).toBeInstanceOf(Error);
    expect((safe as Error).message).toBe('Query failed (22P02)');
    expect((safe as Error).cause).toBeUndefined();
    expect((safe as Error).stack).toMatch(/^\w+: Query failed \(22P02\)\n\s+at /);
    expect(JSON.stringify({ stack: (safe as Error).stack })).not.toContain(SECRET);
  });

  it('reaches a log line without its value', () => {
    const logs = captureLogs();
    try {
      log.error('Unhandled error', errorFields(failed));
    } finally {
      logs.restore();
    }
    const [line] = logs.lines();
    expect(line?.error).toMatchObject({ message: 'Query failed (22P02)' });
    expect(JSON.stringify(line)).not.toContain(SECRET);
  });

  it('reaches Sentry without its value, nor its cause', async () => {
    const transport = memoryTransport();
    startSentry({
      dsn: 'https://public@o1.ingest.de.sentry.io/1',
      environment: 'production',
      release: 'abc1234',
      service: 'api',
      deliver: transport.deliver,
    });
    captureFault(failed, { requestId: 'req-1', procedure: 'records.query' });
    await flush(2000);
    const [event] = transport.events();
    expect(event?.exception?.values?.map((value) => value.value)).toEqual(['Query failed (22P02)']);
    expect(transport.envelopes.join('\n')).not.toContain(SECRET);
  });

  it('leaves through beforeSend without its values when the SDK caught it itself, causes and all', async () => {
    const { beforeSend } = sentryOptions({
      dsn: 'https://public@o1.ingest.de.sentry.io/1',
      environment: 'production',
      release: 'abc1234',
      service: 'worker',
    });
    if (beforeSend === undefined) throw new Error('No beforeSend.');
    const raw = (failed as Error).message;
    // As the SDK builds an uncaught failed query: its cause first (linked errors), the thrown error last.
    const event = {
      type: undefined,
      message: raw,
      exception: {
        values: [
          { type: 'error', value: `invalid input syntax for type uuid: "${SECRET}"` },
          { type: 'DrizzleQueryError', value: raw, stacktrace: { frames: [{ function: 'query', lineno: 7 }] } },
        ],
      },
    } as unknown as Parameters<typeof beforeSend>[0];
    const sent = await beforeSend(event, { originalException: failed });
    expect(sent?.exception?.values).toEqual([
      {
        type: 'DrizzleQueryError',
        value: 'Query failed (22P02)',
        stacktrace: { frames: [{ function: 'query', lineno: 7 }] },
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain(SECRET);
  });

  it('leaves any other error as it was', () => {
    const plain = new Error('connect ECONNREFUSED');
    expect(safeError(plain)).toBe(plain);
    expect(queryFailure(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBeUndefined();
  });
});
