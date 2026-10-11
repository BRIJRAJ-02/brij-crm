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
import { newEmail } from '../../test/sign-in.ts';
import { APP_URL, createTestApp } from '../testing.ts';
import { flush, type SentryConfig, sentryOptions, startSentry } from './sentry.ts';
import { keepSpan, requestSampleRate, sqlShape, TRACE_RATES } from './tracing.ts';

const run = promisify(execFile);
const TRACED_API = fileURLToPath(new URL('../../test/traced-api.ts', import.meta.url));
const CONFIG: SentryConfig = {
  dsn: 'https://public@o1.ingest.de.sentry.io/1',
  environment: 'preview',
  release: 'abc1234',
  service: 'api',
};

/** The sampling context the SDK hands the sampler for an incoming request to `path`. */
const incoming = (path: string) => ({ attributes: { 'sentry.op': 'http.server', 'url.path': path } });

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
      normalizedRequest: { url: 'http://x/api/rpc/a?b=c' },
    };
    expect(requestSampleRate('production', context)).toBe(0.2);
  });
});

describe('the options (AC-170)', () => {
  it('samples the api by request, and the worker at 0', () => {
    const api = sentryOptions(CONFIG);
    expect(api.tracesSampler).toBeTypeOf('function');
    expect(api.tracesSampleRate).toBeUndefined();
    const worker = sentryOptions({ ...CONFIG, service: 'worker' });
    expect(worker.tracesSampleRate).toBe(0);
    expect(worker.tracesSampler).toBeUndefined();
  });

  it('sends trace headers to no outgoing call, and continues only our own traces', () => {
    for (const service of ['api', 'worker'] as const) {
      const options = sentryOptions({ ...CONFIG, service });
      expect(options.tracePropagationTargets).toEqual([]);
      expect(options.strictTraceContinuation).toBe(true);
    }
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
        'http.response.status_code': 200,
      },
    };
    const kept = keepSpan(span);
    expect(kept.attributes).toEqual({
      'sentry.op': 'http.server',
      'url.full': { value: 'https://app.test/api/rpc/records/query', type: 'string' },
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
        headers: { origin: APP_URL, 'content-type': 'application/json', 'user-agent': 'TraceTestBrowser/1.0' },
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
    const { stdout } = await run(process.execPath, [TRACED_API], {
      env: {
        PATH: process.env.PATH ?? '',
        TRACE_DATABASE_URL: appUrl,
        TRACE_IDENTITY_URL: identityUrl,
        TRACE_EMAIL: email,
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
    for (const secret of [email, 'TraceTestBrowser', '203.0.113.77', 'search=ada', 'better-auth.session_token']) {
      expect(sent).not.toContain(secret);
    }
  });
});
