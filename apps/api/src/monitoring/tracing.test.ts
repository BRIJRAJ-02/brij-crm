// Request time (spec 0010, milestone 2, AC-170): each procedure and sign in
// route is a trace with its database queries as child spans, sampled by
// environment and never for a health check; the worker traces nothing; and no
// span carries anything personal (AC-165). Sentry is a fake transport.
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serve } from '@hono/node-server';
import { describe, expect, inject, it } from 'vitest';
import { memoryTransport, type SentSpan, spansIn } from '../../test/sentry.ts';
import { newEmail, newIp } from '../../test/sign-in.ts';
import { APP_URL, createTestApp } from '../testing.ts';
import { flush, type SentryConfig, sentryOptions, startSentry } from './sentry.ts';
import { keepSpan, keepSpanOrBlank, requestSampleRate, sqlShape, TRACE_RATES } from './tracing.ts';

const run = promisify(execFile);
const TRACED_API = fileURLToPath(new URL('../../test/traced-api.ts', import.meta.url));
const CONFIG: SentryConfig = {
  dsn: 'https://public@o1.ingest.de.sentry.io/1',
  environment: 'preview',
  release: 'abc1234',
  service: 'api',
};

/** The sampling context the SDK hands the sampler for a request to `path` through Vercel's middleware (`headers` more). */
const incoming = (path: string, headers: Record<string, string> = {}) => ({
  attributes: { 'sentry.op': 'http.server', 'url.path': path },
  normalizedRequest: { headers: { 'x-crm-edge': 'secret', ...headers } },
});

const segments = (spans: readonly SentSpan[]) => spans.filter((span) => span.is_segment);
const attribute = (span: SentSpan | undefined, key: string) => span?.attributes[key]?.value;

describe('the sampler (AC-170)', () => {
  it('traces procedures and sign in routes at the environment’s rate', () => {
    expect(TRACE_RATES).toEqual({ local: 0, preview: 1, production: 0.2 });
    for (const environment of ['local', 'preview', 'production'] as const) {
      expect(requestSampleRate(environment, incoming('/api/rpc/records/query'))).toBe(TRACE_RATES[environment]);
      expect(requestSampleRate(environment, incoming('/api/auth/sign-in/email-otp'))).toBe(TRACE_RATES[environment]);
    }
  });

  it('never traces a health check, another path, or work outside a request', () => {
    for (const path of ['/api/health', '/api/health/ready', '//api/health', '/api/nothing', '/']) {
      expect(requestSampleRate('preview', incoming(path))).toBe(0);
    }
    expect(requestSampleRate('preview', { attributes: { 'sentry.op': 'http.client', 'url.path': '/api/rpc/x' } })).toBe(
      0,
    );
    expect(requestSampleRate('preview', { attributes: { 'sentry.op': 'db', 'url.path': '/api/rpc/x' } })).toBe(0);
    expect(requestSampleRate('preview', { attributes: {} })).toBe(0);
  });

  it('reads the path from the request when the span has none', () => {
    const context = {
      attributes: { 'sentry.op': 'http.server' },
      normalizedRequest: { url: 'http://x/api/rpc/a?b=c', headers: { 'x-crm-edge': 'secret' } },
    };
    expect(requestSampleRate('production', context)).toBe(0.2);
  });

  it('never traces a request that brings its own trace, so no caller picks the rate or the trace id', () => {
    for (const header of ['sentry-trace', 'baggage', 'traceparent']) {
      expect(requestSampleRate('preview', incoming('/api/rpc/records/query', { [header]: 'x' }))).toBe(0);
      const asAttribute = {
        attributes: { 'sentry.op': 'http.server', 'url.path': '/api/rpc/a', [`http.request.header.${header}`]: ['x'] },
        normalizedRequest: { headers: { 'x-crm-edge': 'secret' } },
      };
      expect(requestSampleRate('preview', asAttribute)).toBe(0);
    }
  });

  it('never traces a request that skipped the edge, outside a laptop', () => {
    const direct = { attributes: { 'sentry.op': 'http.server', 'url.path': '/api/rpc/records/query' } };
    expect(requestSampleRate('production', direct)).toBe(0);
    expect(requestSampleRate('preview', direct)).toBe(0);
  });

  it('never traces an overlong path, and never throws', () => {
    expect(requestSampleRate('preview', incoming(`/api/rpc/${'a'.repeat(500)}`))).toBe(0);
    const hostile = {
      get attributes(): Record<string, unknown> {
        throw new Error('unreadable');
      },
    };
    expect(requestSampleRate('preview', hostile)).toBe(0);
  });
});

describe('the options (AC-170)', () => {
  it('samples the api by request, and leaves tracing off in the worker', () => {
    const api = sentryOptions(CONFIG);
    expect(api.tracesSampler).toBeTypeOf('function');
    expect(api.tracesSampleRate).toBeUndefined();
    const worker = sentryOptions({ ...CONFIG, service: 'worker' });
    // Neither set: the SDK records no span at all.
    expect(worker.tracesSampleRate).toBeUndefined();
    expect(worker.tracesSampler).toBeUndefined();
  });

  it('streams spans, so each passes beforeSendSpan, and sends trace headers to no outgoing call', () => {
    for (const service of ['api', 'worker'] as const) {
      const options = sentryOptions({ ...CONFIG, service });
      expect(options.traceLifecycle).toBe('stream');
      expect(options.tracePropagationTargets).toEqual([]);
      expect(options.strictTraceContinuation).toBe(true);
    }
  });

  it('sends a whole transaction, should spans ever stop streaming, scrubbed and without its spans', async () => {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the backstop is the point: it runs only if spans stop streaming.
    const { beforeSendTransaction } = sentryOptions(CONFIG);
    if (beforeSendTransaction === undefined) throw new Error('No beforeSendTransaction.');
    const transaction = {
      type: 'transaction',
      transaction: 'rpc me.get',
      request: { url: '/api/rpc/me/get?email=ada@example.com', cookies: { session: 'secret' } },
      user: { id: 'user-1', email: 'ada@example.com' },
      contexts: { trace: { trace_id: 't', span_id: 's', data: { 'client.address': '203.0.113.9' } } },
      spans: [{ data: { 'db.query.parameter.0': 'Ada Lovelace', 'sentry.status.message': 'Ada Lovelace' } }],
    } as unknown as Parameters<typeof beforeSendTransaction>[0];
    const sent = await beforeSendTransaction(transaction, {});
    const text = JSON.stringify(sent);
    for (const secret of ['ada@example.com', 'secret', 'Ada Lovelace', '203.0.113.9'])
      expect(text).not.toContain(secret);
    expect(sent).toMatchObject({ transaction: 'rpc me.get', contexts: { trace: { trace_id: 't', span_id: 's' } } });
    expect(sent).not.toHaveProperty('spans');
  });

  it('sends a span it can’t read as a blank, never as it came', () => {
    const { beforeSendSpan } = sentryOptions(CONFIG);
    if (beforeSendSpan === undefined) throw new Error('No beforeSendSpan.');
    const span = {
      trace_id: 't',
      span_id: 's',
      name: 'select ada@example.com',
      start_timestamp: 0,
      status: 'ok',
      is_segment: false,
      get attributes(): Record<string, unknown> {
        throw new Error('unreadable');
      },
    } as unknown as Parameters<typeof beforeSendSpan>[0];
    expect(beforeSendSpan(span)).toEqual({
      trace_id: 't',
      span_id: 's',
      start_timestamp: 0,
      status: 'ok',
      is_segment: false,
      name: 'span',
      attributes: {},
    });
    // A field outside the ones that place a span in its trace never passes, known or not.
    const extra = {
      ...{ trace_id: 't', name: 'x', note: 'ada@example.com' },
      get attributes(): never {
        throw new Error('unreadable');
      },
    };
    expect(JSON.stringify(keepSpanOrBlank(extra))).not.toContain('ada@example.com');
    expect(keepSpanOrBlank).toBeTypeOf('function');
  });
});

describe('keepSpan (AC-165)', () => {
  it('drops the person’s machine, headers, queries and parameters, and keeps the rest', () => {
    const span = {
      name: 'POST',
      attributes: {
        'sentry.op': 'http.server',
        'url.full': { value: 'https://app.test/api/rpc/records/query?search=ada@example.com', type: 'string' },
        'url.query': 'search=ada',
        'url.fragment': 'token=secret',
        'user_agent.original': 'Firefox',
        'client.address': '203.0.113.9',
        'network.peer.address': '203.0.113.9',
        'http.request.header.cookie': ['secret'],
        'http.request.header.x-request-id': ['req-1'],
        'http.request.header.content-type': ['application/json'],
        'user.id': 'user-1',
        'user.email': 'ada@example.com',
        'db.query.parameter.0': 'ada@example.com',
        'db.connection_string': 'postgresql://neon.host:5432/crm',
        'db.user': 'crm_app_login',
        'db.namespace': 'crm',
        'server.address': 'api.railway.internal',
        'server.port': 3000,
        'network.local.address': '10.0.0.2',
        'sentry.status.message': 'invalid input syntax for type integer: "Ada Lovelace"',
        'url.path': '/api/rpc/records/query',
        'http.response.status_code': 200,
      },
      links: [{ trace_id: 'other', span_id: 'x', attributes: { 'user.email': 'ada@example.com' } }],
    };
    const kept = keepSpan({ ...span, trace_id: 't', is_segment: true, note: 'ada@example.com' });
    expect(kept).not.toHaveProperty('links');
    // Top level, only the fields that place a span in its trace pass.
    expect(kept).toMatchObject({ trace_id: 't', is_segment: true });
    expect(kept).not.toHaveProperty('note');
    expect(kept.attributes).toEqual({
      'sentry.op': 'http.server',
      'url.path': '/api/rpc/records/query',
      'http.request.header.x-request-id': ['req-1'],
      'http.request.header.content-type': ['application/json'],
      'user.id': 'user-1',
      'http.response.status_code': 200,
    });
    // The argument is never changed.
    expect(span.attributes['user.email']).toBe('ada@example.com');
  });

  it('sends a statement’s shape: every literal a ?, every placeholder kept', () => {
    expect(sqlShape(`select * from people where email = 'ada@example.com' and age > 41 and id = $1 limit 50`)).toBe(
      'select * from people where email = ? and age > ? and id = $1 limit ?',
    );
    expect(sqlShape(`select 'it''s', E'x\\'y', $tag$body$tag$, t1.c2 from t1`)).toBe('select ?, ?, ?, t1.c2 from t1');
    // Cut inside a literal: none of it stays.
    expect(sqlShape(`select * from people where email = 'ada@exam`)).toBe('select * from people where email = ?');
    const kept = keepSpan({
      name: `select set_config('app.workspace_id', '0f0e…', true)`,
      attributes: { 'sentry.op': 'db', 'db.query.text': `insert into x values ('ada@example.com', 7)` },
    });
    expect(kept.name).toBe('select set_config(?, ?, true)');
    expect(kept.attributes['db.query.text']).toBe('insert into x values (?, ?)');
    const summary = keepSpan({ name: 'q', attributes: { 'sentry.op': 'db', 'db.query.summary': `select 'Ada'` } });
    expect(summary.attributes['db.query.summary']).toBe('select ?');
  });

  it('never leaves part of an email the cut splits', () => {
    for (const at of [1000, 1015, 1020, 1024]) {
      const path = `/${'p'.repeat(at)}/ada@example.com/more`;
      const kept = keepSpan({ name: path, attributes: { 'url.path': path } });
      for (const sent of [kept.name, kept.attributes['url.path']]) {
        expect(sent).not.toMatch(/ada@|@example/);
        expect(sent.length).toBeLessThanOrEqual(1024 + '[cut]'.length);
      }
    }
    const sql = `select 1 /* ${'x'.repeat(2030)} ada@example.com */`;
    const shaped = keepSpan({ name: 'q', attributes: { 'sentry.op': 'db', 'db.query.text': sql } });
    expect(shaped.attributes['db.query.text']).not.toMatch(/ada@|@example/);
  });

  it('costs well under a millisecond for a root span with 9 KB in its path and headers (AC-166)', () => {
    const long = 'a'.repeat(9 * 1024);
    const span = {
      name: 'POST',
      attributes: {
        'sentry.op': 'http.server',
        'url.path': `/api/rpc/${long}`,
        'url.full': `https://app.test/api/rpc/${long}`,
        'http.request.header.content-type': [long],
      },
    };
    keepSpan(span);
    const started = performance.now();
    for (let round = 0; round < 20; round += 1) keepSpan(span);
    expect((performance.now() - started) / 20).toBeLessThan(1);
    expect(keepSpan(span).attributes['url.path'].length).toBeLessThanOrEqual(1024);
  });
});

describe('a traced request, in this process', () => {
  it('is one trace named after its procedure; a health check is none; no header leaves for another host', async () => {
    const transport = memoryTransport();
    startSentry({ ...CONFIG, deliver: transport.deliver });
    // Another host, to see what an outgoing call carries.
    const seen: string[] = [];
    const elsewhere = createServer((request, response) => {
      seen.push(...Object.keys(request.headers));
      response.end('ok');
    });
    const api = serve({ port: 0, hostname: '127.0.0.1', fetch: createTestApp().fetch });
    await Promise.all([
      new Promise((resolve) => elsewhere.listen(0, '127.0.0.1', () => resolve(undefined))),
      new Promise((resolve) => api.once('listening', resolve)),
    ]);
    try {
      const apiPort = (api.address() as AddressInfo).port;
      const answer = await fetch(`http://127.0.0.1:${String(apiPort)}/api/rpc/echo?q=ada@example.com`, {
        method: 'POST',
        headers: {
          origin: APP_URL,
          'content-type': 'application/json',
          'user-agent': 'TraceTestBrowser/1.0',
          'x-crm-edge': 'present',
        },
        body: JSON.stringify({ json: { name: 'Ada', tags: [] } }),
      });
      expect(answer.status).toBe(200);
      await fetch(`http://127.0.0.1:${String(apiPort)}/api/health`);
      await fetch(`http://127.0.0.1:${String((elsewhere.address() as AddressInfo).port)}/`);
    } finally {
      await Promise.all([
        new Promise((resolve) => api.close(resolve)),
        new Promise((resolve) => elsewhere.close(resolve)),
      ]);
    }
    await flush(2000);

    const traced = segments(transport.spans());
    expect(traced.map((span) => span.name)).toEqual(['rpc echo']);
    expect(attribute(traced[0], 'sentry.op')).toBe('http.server');
    expect(attribute(traced[0], 'sentry.environment')).toBe('preview');
    expect(seen).not.toContain('sentry-trace');
    expect(seen).not.toContain('baggage');
    const sent = transport.envelopes.join('\n');
    expect(sent).not.toContain('TraceTestBrowser');
    expect(sent).not.toContain('example.com');
  });
});

describe('a traced api process, on a real Postgres', () => {
  it('names sign in routes and procedures, with database queries as child spans, and nothing personal', async () => {
    const { appUrl, identityUrl } = inject('testDatabase');
    const email = newEmail();
    const ip = newIp();
    const { stdout } = await run(process.execPath, [TRACED_API], {
      env: {
        PATH: process.env.PATH ?? '',
        TRACE_DATABASE_URL: appUrl,
        TRACE_IDENTITY_URL: identityUrl,
        TRACE_EMAIL: email,
        TRACE_IP: ip,
        TRACE_ENVIRONMENT: 'preview',
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    const envelopes = stdout
      .split('\n')
      .filter((line) => line.startsWith('ENVELOPE '))
      .map((line) => JSON.parse(line.slice('ENVELOPE '.length)) as string);
    const spans = envelopes.flatMap(spansIn);
    const roots = segments(spans);

    expect(roots.map((span) => span.name).sort()).toEqual([
      'auth /email-otp/send-verification-otp',
      'auth /sign-in/email-otp',
      'rpc me.get',
      'rpc trace.failingQuery',
    ]);
    // Each has its database queries beneath it.
    for (const root of roots) {
      const queries = spans.filter(
        (span) => span.trace_id === root.trace_id && String(attribute(span, 'sentry.op')).startsWith('db'),
      );
      expect(queries.length, root.name).toBeGreaterThan(0);
    }
    expect(spans.filter((span) => 'db.connection_string' in span.attributes || 'db.user' in span.attributes)).toEqual(
      [],
    );
    const sent = envelopes.join('\n');
    // The failing query's bound value, which Postgres quotes in its message (the span's status message).
    for (const secret of [email, 'TraceTestBrowser', ip, 'search=ada', 'better-auth.session_token', 'Ada Lovelace']) {
      expect(sent).not.toContain(secret);
    }
  });
});
