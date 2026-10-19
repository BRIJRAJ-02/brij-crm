// Spec 0023, milestone 1: the public form endpoints over HTTP, against a real
// Postgres, with a fake reCAPTCHA and the limits in memory: the hosted read,
// a submit stored once with its job queued and the worker poked, field
// errors, a paused form, a wrong origin, the limits' 429 and an unknown key.
// Then the verifier and the limiter on their own.
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace } from '../../test/workspace.ts';
import { EDGE_HEADER, ORIGIN_HEADER } from '../edge.ts';
import { APP_URL, TEST_EDGE_SECRET } from '../testing.ts';
import { createRateLimiter, FORM_LIMITS } from './limits.ts';
import { SIGNATURE_HEADER, signatureOf } from './public.ts';
import { CAPTCHA_ACTION, createCaptchaVerifier, VERIFY_IN_FLIGHT } from './recaptcha.ts';

const { ownerUrl } = inject('testDatabase');

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
let pokes = 0;

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, {}, { wakeRelay: () => (pokes += 1) }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** A request to the public endpoints as Vercel's middleware sends it from the hosted page. */
function call(
  path: string,
  init: { method?: string; body?: unknown; origin?: string | null; ip?: string; headers?: Record<string, string> } = {},
) {
  return Promise.resolve(
    app.fetch(
      new Request(`${APP_URL}/api/public${path}`, {
        method: init.method ?? 'GET',
        headers: {
          [EDGE_HEADER]: TEST_EDGE_SECRET,
          ...(init.origin === null ? {} : { [ORIGIN_HEADER]: init.origin ?? APP_URL, origin: init.origin ?? APP_URL }),
          'x-forwarded-for': init.ip ?? '203.0.113.7',
          'content-type': 'application/json',
          ...init.headers,
        },
        ...(init.body === undefined
          ? {}
          : { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) }),
      }),
    ),
  );
}

async function liveForm() {
  const m = await memberWithWorkspace(app);
  const form = await m.client.forms.create({
    workspace: m.slug,
    id: newId(),
    name: 'Contact us',
    mainObjectId: m.people.id,
    mutationId: newId(),
  });
  const live = await m.client.forms.publish({
    workspace: m.slug,
    formId: form.id,
    expectedRevision: form.revision,
    mutationId: newId(),
  });
  return { m, live };
}

const answers = { name: 'Ada Lovelace', email: 'ada@example.com' };
const submission = (extra: Record<string, unknown> = {}) => ({
  idempotencyKey: newId(),
  versionNumber: 1,
  answers,
  hidden: { utm_source: 'newsletter' },
  fillMs: 8_000,
  ...extra,
});

describe('GET /api/public/forms/:publicKey', () => {
  it('answers the live form, cacheable, noindex, and 404 for a key that names nothing', async () => {
    const { live } = await liveForm();
    const response = await call(`/forms/${live.publicKey}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    const body = (await response.json()) as { headline: string; status: string };
    expect(body).toMatchObject({ headline: 'Fill this in and we will come back to you', status: 'live' });
    expect(JSON.stringify(body)).not.toContain(live.mainObjectId);
    const missing = await call('/forms/no-such-form');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      code: 'NOT_FOUND',
      message: 'This form doesn’t exist, or its address changed.',
    });
  });
});

describe('POST /api/public/forms/:publicKey/submissions', () => {
  it('stores a submission once per attempt, queues its job and pokes the worker', async () => {
    const { m, live } = await liveForm();
    const body = submission();
    const before = pokes;
    const first = await call(`/forms/${live.publicKey}/submissions`, { method: 'POST', body });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ next: { kind: 'message', text: '', offersMeeting: false } });
    expect(pokes - before).toBe(1);
    const again = await call(`/forms/${live.publicKey}/submissions`, { method: 'POST', body });
    expect(again.status).toBe(200);
    const stored = await testQuery<{ state: string; hidden: unknown; ip_hash: string | null; verdict: string }>(
      ownerUrl,
      `select state, hidden, ip_hash, spam->>'verdict' as verdict from form_submissions where form_id = $1`,
      [live.id],
    );
    // reCAPTCHA is off in tests: the honeypot, timing and limits decided, and it passed.
    expect(stored).toEqual([
      {
        state: 'received',
        hidden: { utm_source: 'newsletter' },
        ip_hash: expect.stringMatching(/^[0-9a-f]{32}$/) as string,
        verdict: 'passed',
      },
    ]);
    expect(stored[0]?.ip_hash).not.toContain('203.0.113.7');
    const jobs = await testQuery(ownerUrl, `select 1 from jobs where workspace_id = $1 and kind = 'forms.process'`, [
      m.workspace.id,
    ]);
    expect(jobs).toHaveLength(1);
  });

  it('answers 422 with each question’s message, and stores nothing', async () => {
    const { live } = await liveForm();
    const response = await call(`/forms/${live.publicKey}/submissions`, {
      method: 'POST',
      body: submission({ answers: { email: 'nope' } }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; fields: Record<string, string> };
    expect(body.code).toBe('ATTRIBUTE_VALUE_INVALID');
    expect(Object.keys(body.fields).sort()).toEqual(['email', 'name']);
    expect(await testQuery(ownerUrl, `select 1 from form_submissions where form_id = $1`, [live.id])).toEqual([]);
  });

  it('refuses another origin, a paused form (410) and a body that isn’t a submission', async () => {
    const { m, live } = await liveForm();
    const path = `/forms/${live.publicKey}/submissions`;
    expect((await call(path, { method: 'POST', body: submission(), origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(path, { method: 'POST', body: { answers } })).status).toBe(400);
    await m.client.forms.setStatus({ workspace: m.slug, formId: live.id, status: 'paused', mutationId: newId() });
    const paused = await call(path, { method: 'POST', body: submission() });
    expect(paused.status).toBe(410);
    expect(await paused.json()).toMatchObject({ code: 'FORM_CLOSED' });
    const read = (await (await call(`/forms/${live.publicKey}`)).json()) as { status: string; questions: unknown[] };
    expect(read).toMatchObject({ status: 'paused', questions: [] });
  });

  it('answers 429 with Retry-After past 5 a minute from one address', async () => {
    const { live } = await liveForm();
    const path = `/forms/${live.publicKey}/submissions`;
    const statuses: number[] = [];
    let retryAfter: string | null = null;
    for (let index = 0; index < 6; index += 1) {
      const response = await call(path, {
        method: 'POST',
        ip: '198.51.100.9',
        body: submission({ answers: { ...answers, email: `person${String(index)}@example.com` } }),
      });
      statuses.push(response.status);
      retryAfter = response.headers.get('retry-after');
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('takes a listed site’s post with CORS, refuses an unlisted one, and needs a signature when the form says so', async () => {
    const { m, live } = await liveForm();
    const path = `/forms/${live.publicKey}/submissions`;
    const site = 'https://acme.example';
    expect((await call(path, { method: 'POST', body: submission(), origin: site, ip: '192.0.2.1' })).status).toBe(403);
    const listed = await m.client.forms.updateSettings({
      workspace: m.slug,
      formId: live.id,
      allowedOrigins: ['acme.example'],
      mutationId: newId(),
    });
    expect(listed.allowedOrigins).toEqual([site]);
    const preflight = await call(path, { method: 'OPTIONS', origin: site, ip: '192.0.2.1' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(site);
    const posted = await call(path, { method: 'POST', body: submission(), origin: site, ip: '192.0.2.2' });
    expect(posted.status).toBe(200);
    expect(posted.headers.get('access-control-allow-origin')).toBe(site);
    const signed = await m.client.forms.updateSettings({
      workspace: m.slug,
      formId: live.id,
      requireSignature: true,
      mutationId: newId(),
    });
    expect((await call(path, { method: 'POST', body: submission(), origin: site, ip: '192.0.2.3' })).status).toBe(403);
    const text = JSON.stringify(submission());
    const server = await call(path, {
      method: 'POST',
      body: text,
      origin: null,
      ip: '192.0.2.4',
      headers: { [SIGNATURE_HEADER]: signatureOf(signed.signingSecret ?? '', text) },
    });
    expect(server.status).toBe(200);
  });
});

describe('the reCAPTCHA verifier (AC-583)', () => {
  const hosts = new Set(['app.test']);
  const google = (answer: unknown, status = 200) =>
    (() => Promise.resolve(Response.json(answer, { status }))) as unknown as typeof fetch;

  it('is off with no secret, and judges a token by its action, host and score', async () => {
    expect(await createCaptchaVerifier({}).verify('token', hosts)).toEqual({ kind: 'off' });
    const secret = 'a-test-secret-for-recaptcha-of-length';
    const ok = createCaptchaVerifier({
      secret,
      fetch: google({ success: true, score: 0.8, action: CAPTCHA_ACTION, hostname: 'app.test' }),
    });
    expect(await ok.verify('token', hosts)).toEqual({ kind: 'score', score: 0.8 });
    expect(await ok.verify(undefined, hosts)).toEqual({ kind: 'missing' });
    const elsewhere = createCaptchaVerifier({
      secret,
      fetch: google({ success: true, score: 0.9, action: CAPTCHA_ACTION, hostname: 'evil.example' }),
    });
    expect(await elsewhere.verify('token', hosts)).toEqual({ kind: 'invalid' });
    const failing = createCaptchaVerifier({ secret, fetch: google({}, 500) });
    expect(await failing.verify('token', hosts)).toEqual({ kind: 'unavailable' });
    const slow = createCaptchaVerifier({
      secret,
      timeoutMs: 20,
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch,
    });
    expect(await slow.verify('token', hosts)).toEqual({ kind: 'unavailable' });
  });

  it('says unavailable past the checks it lets run at once', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verifier = createCaptchaVerifier({
      secret: 'a-test-secret-for-recaptcha-of-length',
      fetch: async () => {
        await held;
        return Response.json({ success: true, score: 0.9, action: CAPTCHA_ACTION, hostname: 'app.test' });
      },
    });
    const running = Array.from({ length: VERIFY_IN_FLIGHT }, () => verifier.verify('t', hosts));
    expect(await verifier.verify('t', hosts)).toEqual({ kind: 'unavailable' });
    release();
    expect((await Promise.all(running)).every((verdict) => verdict.kind === 'score')).toBe(true);
  });
});

describe('the rate limiter (AC-585)', () => {
  it('counts per key in fixed windows, and says when the window ends', () => {
    let now = 0;
    const limiter = createRateLimiter(() => now);
    const limit = FORM_LIMITS.perAddress;
    const results = Array.from({ length: 6 }, () => limiter.hit('k', limit));
    expect(results.filter((result) => result === true)).toHaveLength(5);
    expect(results[5]).toEqual({ retryAfterSeconds: 60 });
    now += limit.windowMs;
    expect(limiter.hit('k', limit)).toBe(true);
  });
});
