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
import { createMemoryLimiter, FORM_LIMITS } from '../limits.ts';
import { limitEmails, SIGNATURE_HEADER, signatureOf } from './public.ts';
import { CAPTCHA_ACTION, createCaptchaVerifier, VERIFY_IN_FLIGHT } from './recaptcha.ts';
import { createTicketBook, TICKET_TTL_MS } from './ticket.ts';

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
  it('answers the live form, never cached (crm-f7 F1: a resume showed a minute late), noindex, and 404 for a key that names nothing', async () => {
    const { live } = await liveForm();
    const response = await call(`/forms/${live.publicKey}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as { headline: string; status: string };
    expect(body).toMatchObject({ headline: 'Fill this in and we will come back to you', status: 'live' });
    expect(JSON.stringify(body)).not.toContain(live.mainObjectId);
    const missing = await call('/forms/no-such-form');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
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
    const pausedRead = await call(`/forms/${live.publicKey}`);
    expect(pausedRead.headers.get('cache-control')).toBe('no-store');
    const read = (await pausedRead.json()) as { status: string; questions: unknown[] };
    expect(read).toMatchObject({ status: 'paused', questions: [] });
    // Resumed, the very next read says so: nothing kept the paused answer (crm-f7 F1).
    await m.client.forms.setStatus({ workspace: m.slug, formId: live.id, status: 'live', mutationId: newId() });
    expect(await (await call(`/forms/${live.publicKey}`)).json()).toMatchObject({ status: 'live' });
  });

  it('answers 429, never cached, past 60 reads a minute from one address (late trap #69)', async () => {
    const { live } = await liveForm();
    const statuses: number[] = [];
    for (let index = 0; index < 60; index += 1) {
      statuses.push((await call(`/forms/${live.publicKey}`, { ip: '198.51.100.69' })).status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
    const over = await call(`/forms/${live.publicKey}`, { ip: '198.51.100.69' });
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(over.headers.get('cache-control')).toBe('no-store');
    // A key that names nothing counts too: guessing addresses costs the same as reading one.
    expect((await call('/forms/no-such-form', { ip: '198.51.100.69' })).status).toBe(429);
    // Another address still reads it, and the reads spent none of the submissions' own limits.
    expect((await call(`/forms/${live.publicKey}`, { ip: '198.51.100.70' })).status).toBe(200);
    const sent = await call(`/forms/${live.publicKey}/submissions`, {
      method: 'POST',
      ip: '198.51.100.69',
      body: submission(),
    });
    expect(sent.status).toBe(200);
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

  it('takes a site’s own form whose HTML lacks a question added since, and refuses it on our page (late trap #55)', async () => {
    const { m, live } = await liveForm();
    const path = `/forms/${live.publicKey}/submissions`;
    const site = 'https://acme.example';
    await m.client.forms.updateSettings({
      workspace: m.slug,
      formId: live.id,
      allowedOrigins: ['acme.example'],
      mutationId: newId(),
    });
    // The starting form asks Name; the site's copied HTML only ever had Email.
    const onlyEmail = submission({ answers: { email: 'site@example.com' } });
    expect((await call(path, { method: 'POST', body: onlyEmail, origin: site, ip: '192.0.2.21' })).status).toBe(200);
    // Our hosted page sends every question it shows, so there an absent required answer is still refused.
    const ours = await call(path, {
      method: 'POST',
      body: submission({ answers: { email: 'ours@example.com' } }),
      ip: '192.0.2.22',
    });
    expect(ours.status).toBe(422);
    // A site field sent empty was asked, and is held to the question.
    const empty = submission({ answers: { name: '', email: 'site2@example.com' } });
    expect((await call(path, { method: 'POST', body: empty, origin: site, ip: '192.0.2.23' })).status).toBe(422);
    // A site's server, signing its post with no Origin, is a site's own form too.
    const signed = await m.client.forms.updateSettings({
      workspace: m.slug,
      formId: live.id,
      requireSignature: true,
      mutationId: newId(),
    });
    const text = JSON.stringify(submission({ answers: { email: 'server@example.com' } }));
    const server = await call(path, {
      method: 'POST',
      body: text,
      origin: null,
      ip: '192.0.2.24',
      headers: { [SIGNATURE_HEADER]: signatureOf(signed.signingSecret ?? '', text) },
    });
    expect(server.status).toBe(200);
  });
});

describe('the spam checks over HTTP (AC-584, AC-585)', () => {
  const stored = (formId: string) =>
    testQuery<{ state: string; signals: string[] }>(
      ownerUrl,
      `select state, spam->'signals' as signals from form_submissions where form_id = $1 order by received_at`,
      [formId],
    );

  it('hands out a fill ticket, never cached, and judges the fill time on the server’s clock', async () => {
    const { live } = await liveForm();
    const response = await call(`/forms/${live.publicKey}/ticket`, { ip: '198.51.100.40' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const { ticket } = (await response.json()) as { ticket: string };
    expect(ticket).toMatch(/^t1\./);
    // Sent at once, with the page claiming it took a minute: the server's clock says too fast. Same answer as success.
    const fast = await call(`/forms/${live.publicKey}/submissions`, {
      method: 'POST',
      ip: '198.51.100.41',
      body: submission({ ticket, fillMs: 60_000 }),
    });
    expect(fast.status).toBe(200);
    expect(await fast.json()).toEqual({ next: { kind: 'message', text: '', offersMeeting: false } });
    // A ticket for another form doesn't count, and neither timing nor ticket is a weak sign only: received.
    const elsewhere = (await (await call('/forms/another-form/ticket', { ip: '198.51.100.40' })).json()) as {
      ticket: string;
    };
    const forged = await call(`/forms/${live.publicKey}/submissions`, {
      method: 'POST',
      ip: '198.51.100.42',
      body: submission({ ticket: elsewhere.ticket, answers: { ...answers, email: 'grace@example.com' } }),
    });
    expect(forged.status).toBe(200);
    const untimed = await call(`/forms/${live.publicKey}/submissions`, {
      method: 'POST',
      ip: '198.51.100.43',
      body: { ...submission({ answers: { ...answers, email: 'alan@example.com' } }), fillMs: undefined },
    });
    expect(untimed.status).toBe(200);
    expect(await stored(live.id)).toEqual([
      { state: 'spam', signals: ['too_fast'] },
      { state: 'needs_review', signals: ['ticket_invalid'] },
      { state: 'needs_review', signals: ['no_timing'] },
    ]);
  });

  it('holds the sixth in an hour from one email on one form for review, whatever its case or +tag, never a 429', async () => {
    const { live } = await liveForm();
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await call(`/forms/${live.publicKey}/submissions`, {
        method: 'POST',
        ip: `198.51.100.${String(50 + index)}`,
        body: submission({ answers: { name: `Ada ${String(index)}`, email: `ADA+${String(index)}@example.com` } }),
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
    expect((await stored(live.id)).map((row) => row.state)).toEqual([
      'received',
      'received',
      'received',
      'received',
      'received',
      'needs_review',
    ]);
  });

  it('stores link spam as spam and a doubtful one in Needs review, both answered as success, with no job', async () => {
    const { m, live } = await liveForm();
    const spam = await call(`/forms/${live.publicKey}/submissions`, {
      method: 'POST',
      ip: '198.51.100.70',
      body: submission({ answers: { name: '<a href="http://pills.example">Buy now</a>', email: 'x@example.com' } }),
    });
    const doubtful = await call(`/forms/${live.publicKey}/submissions`, {
      method: 'POST',
      ip: '198.51.100.71',
      body: submission({ answers: { name: 'Xkcdqwrt', email: 'someone@mailinator.com' } }),
    });
    expect([spam.status, doubtful.status]).toEqual([200, 200]);
    expect(await stored(live.id)).toEqual([
      { state: 'spam', signals: ['markup_links', 'link_in_name'] },
      { state: 'needs_review', signals: ['gibberish_name', 'disposable_email'] },
    ]);
    const jobs = await testQuery(ownerUrl, `select 1 from jobs where workspace_id = $1 and kind = 'forms.process'`, [
      m.workspace.id,
    ]);
    expect(jobs).toEqual([]);
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
    const limiter = createMemoryLimiter({ now: () => now });
    const limit = FORM_LIMITS.perAddress;
    const results = Array.from({ length: 6 }, () => limiter('k', limit));
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results[5]).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now += limit.windowMs;
    expect(limiter('k', limit)).toEqual({ allowed: true });
  });

  it('normalises the emails it limits: lowercased, trimmed, the +tag dropped, at most three', () => {
    expect(
      limitEmails({ email: ' Ada+news@Example.com ', other: 'ada@example.com', name: 'Ada', n: 3, x: 'no@tld' }),
    ).toEqual(['ada@example.com']);
  });
});

describe('fill tickets', () => {
  const salt = 'a-salt-for-fill-tickets-in-the-tests-only';

  it('says how long ago it was issued, for its own subject only, until spent or a day old', () => {
    let now = 1_000_000;
    const book = createTicketBook({ salt, limiter: createMemoryLimiter({ now: () => now }), now: () => now });
    const ticket = book.issue('form:contact');
    now += 4_000;
    expect(book.check('form:contact', ticket)).toEqual({ kind: 'valid', elapsedMs: 4_000 });
    expect(book.check('form:other', ticket)).toEqual({ kind: 'invalid' });
    expect(book.check('booking:contact', ticket)).toEqual({ kind: 'invalid' });
    expect(book.check('form:contact', undefined)).toEqual({ kind: 'missing' });
    expect(book.check('form:contact', `${ticket.slice(0, -2)}xx`)).toEqual({ kind: 'invalid' });
    expect(book.check('form:contact', 'not a ticket')).toEqual({ kind: 'invalid' });
    const other = createTicketBook({ salt: `${salt}-rotated`, limiter: createMemoryLimiter() });
    expect(other.check('form:contact', ticket)).toEqual({ kind: 'invalid' });
    for (let use = 0; use < 4; use += 1) expect(book.check('form:contact', ticket).kind).toBe('valid');
    expect(book.check('form:contact', ticket)).toEqual({ kind: 'reused' });
    const fresh = book.issue('form:contact');
    now += TICKET_TTL_MS + 1;
    expect(book.check('form:contact', fresh)).toEqual({ kind: 'expired' });
  });
});
