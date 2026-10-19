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
import { createRateLimiter, emailsIn, FORM_LIMITS, limitEmail } from './limits.ts';
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
function call(path: string, init: { method?: string; body?: unknown; origin?: string; ip?: string } = {}) {
  return Promise.resolve(
    app.fetch(
      new Request(`${APP_URL}/api/public${path}`, {
        method: init.method ?? 'GET',
        headers: {
          [EDGE_HEADER]: TEST_EDGE_SECRET,
          [ORIGIN_HEADER]: init.origin ?? APP_URL,
          origin: init.origin ?? APP_URL,
          'x-forwarded-for': init.ip ?? '203.0.113.7',
          'content-type': 'application/json',
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
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

const answers = { name: { firstName: 'Ada', lastName: 'Lovelace' }, email: 'ada@example.com' };
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
    const body = (await response.json()) as { title: string; status: string; steps: { blocks: unknown[] }[] };
    expect(body).toMatchObject({ title: 'Contact us', status: 'live' });
    expect(JSON.stringify(body)).not.toContain(live.mainObjectId);
    const missing = await call('/forms/AAAAAAAAAAAAAAAAAAAAAAAA');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: 'NOT_FOUND', message: 'This form does not exist.' });
  });
});

describe('POST /api/public/forms/:publicKey/submissions', () => {
  it('stores a submission once per attempt, queues its job and pokes the worker', async () => {
    const { m, live } = await liveForm();
    const body = submission();
    const before = pokes;
    const first = await call(`/forms/${live.publicKey}/submissions`, { method: 'POST', body });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ next: { kind: 'message', text: 'Thanks, we got your message.' } });
    expect(pokes - before).toBe(1);
    const again = await call(`/forms/${live.publicKey}/submissions`, { method: 'POST', body });
    expect(again.status).toBe(200);
    const stored = await testQuery<{ state: string; hidden: unknown; ip_hash: string | null; verdict: string }>(
      ownerUrl,
      `select state, hidden, ip_hash, spam->>'verdict' as verdict from form_submissions where form_id = $1`,
      [live.id],
    );
    // No reCAPTCHA secret in tests: stored unchecked, still processed.
    expect(stored).toEqual([
      {
        state: 'received',
        hidden: { utm_source: 'newsletter' },
        ip_hash: expect.stringMatching(/^[0-9a-f]{32}$/) as string,
        verdict: 'unchecked',
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
    const read = (await (await call(`/forms/${live.publicKey}`)).json()) as { status: string; closedMessage: string };
    expect(read).toMatchObject({ status: 'paused', closedMessage: 'This form is not taking responses right now.' });
  });

  it('answers 429 past 10 a minute from one address, and past 5 an hour for one email', async () => {
    const { live } = await liveForm();
    const path = `/forms/${live.publicKey}/submissions`;
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await call(path, {
        method: 'POST',
        ip: '198.51.100.9',
        body: submission({ answers: { ...answers, email: `person${String(index)}@example.com` } }),
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    const emails: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await call(path, {
        method: 'POST',
        ip: `192.0.2.${String(index + 10)}`,
        body: submission({ answers: { ...answers, email: `same+${String(index)}@example.com` } }),
      });
      emails.push(response.status);
    }
    expect(emails).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe('the reCAPTCHA verifier (AC-583)', () => {
  const hosts = new Set(['app.test']);
  const google = (answer: unknown, status = 200) =>
    (() => Promise.resolve(Response.json(answer, { status }))) as unknown as typeof fetch;

  it('is unavailable with no secret, and judges a token by its action, host and score', async () => {
    expect(await createCaptchaVerifier({}).verify('token', hosts)).toEqual({ kind: 'unavailable' });
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
  it('counts per key in fixed windows', () => {
    let now = 0;
    const limiter = createRateLimiter(() => now);
    const limit = FORM_LIMITS.perFormAddress;
    const results = Array.from({ length: 11 }, () => limiter.hit('k', limit));
    expect(results.filter(Boolean)).toHaveLength(10);
    now += limit.windowMs;
    expect(limiter.hit('k', limit)).toBe(true);
  });

  it('counts an email lowercased, trimmed and without its +tag', () => {
    expect(limitEmail(' Ada+news@Example.com ')).toBe('ada@example.com');
    expect(emailsIn({ a: 'x@y.co', b: 3, c: 'not one', d: { e: 'z@w.co' } })).toEqual(['x@y.co']);
  });
});
