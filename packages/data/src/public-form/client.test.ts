import { describe, expect, it } from 'vitest';
import { createPublicFormClient } from './client.ts';

const form = {
  key: 'contact-us',
  status: 'live',
  versionNumber: 1,
  headline: 'Talk to us',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  questions: [],
  offersMeeting: false,
};

/** A fake endpoint answering `status` and `body` to every call, and keeping what it was sent. */
function endpoint(status: number, body: unknown) {
  const sent: { url: string; init?: RequestInit }[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: input instanceof Request ? input.url : input.toString(),
      ...(init === undefined ? {} : { init }),
    });
    return Promise.resolve(Response.json(body, { status }));
  };
  return { fetch, sent };
}

const submission = { idempotencyKey: crypto.randomUUID(), versionNumber: 1, answers: {}, hidden: {} };

describe('the hosted page’s client (spec 0023)', () => {
  it('asks for a fill ticket, never cached, and gives up quietly when it can’t have one', async () => {
    const ok = endpoint(200, { ticket: 't1.abc' });
    expect(await createPublicFormClient({ fetch: ok.fetch }).ticket(form.key)).toBe('t1.abc');
    expect(ok.sent[0]?.url).toBe(`/api/public/forms/${form.key}/ticket`);
    expect(ok.sent[0]?.init).toMatchObject({ cache: 'no-store' });
    expect(await createPublicFormClient({ fetch: endpoint(429, {}).fetch }).ticket(form.key)).toBeUndefined();
    expect(await createPublicFormClient({ fetch: endpoint(200, { nope: 1 }).fetch }).ticket(form.key)).toBeUndefined();
    const offline = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await createPublicFormClient({ fetch: offline }).ticket(form.key)).toBeUndefined();
  });

  it('reads a live form, and says missing for a 404 and a 410', async () => {
    const ok = endpoint(200, form);
    expect(await createPublicFormClient({ fetch: ok.fetch }).load(form.key)).toEqual({ kind: 'form', form });
    expect(ok.sent[0]?.url).toBe(`/api/public/forms/${form.key}`);
    for (const status of [404, 410]) {
      const gone = endpoint(status, { code: 'NOT_FOUND', message: 'x' });
      expect(await createPublicFormClient({ fetch: gone.fetch }).load(form.key)).toEqual({ kind: 'missing' });
    }
    const broken = endpoint(200, { nonsense: true });
    expect(await createPublicFormClient({ fetch: broken.fetch }).load(form.key)).toEqual({ kind: 'failed' });
  });

  it('turns each submit answer into what the page does next', async () => {
    const cases: [number, unknown, unknown][] = [
      [
        200,
        { next: { kind: 'message', text: 'Thanks.' } },
        { kind: 'done', next: { kind: 'message', text: 'Thanks.' } },
      ],
      [
        422,
        { code: 'ATTRIBUTE_VALUE_INVALID', message: 'x', fields: { email: 'Bad.' } },
        { kind: 'invalid', fields: { email: 'Bad.' } },
      ],
      [410, { code: 'FORM_CLOSED', message: 'x' }, { kind: 'closed' }],
      [429, { code: 'RATE_LIMITED', message: 'x' }, { kind: 'limited' }],
      [500, { code: 'INTERNAL', message: 'x' }, { kind: 'failed' }],
    ];
    for (const [status, body, expected] of cases) {
      const answer = endpoint(status, body);
      expect(await createPublicFormClient({ fetch: answer.fetch }).submit(form.key, submission)).toEqual(expected);
    }
    const offline = createPublicFormClient({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    expect(await offline.submit(form.key, submission)).toEqual({ kind: 'offline' });
  });

  it('says a form with no file store can’t take files, never to try again (forms fix b8)', async () => {
    const file = new File(['cv'], 'cv.pdf', { type: 'application/pdf' });
    const none = endpoint(503, { code: 'API_UNAVAILABLE', message: 'File uploads are not available right now.' });
    expect(await createPublicFormClient({ fetch: none.fetch }).upload(form.key, file, () => undefined)).toEqual({
      kind: 'unavailable',
    });
    const broken = endpoint(500, { code: 'INTERNAL', message: 'x' });
    expect(await createPublicFormClient({ fetch: broken.fetch }).upload(form.key, file, () => undefined)).toEqual({
      kind: 'failed',
    });
  });

  it('sends a count as a beacon, and falls back to a keepalive post when there is none (AC-6320)', () => {
    const taken: { url: string; body: Blob }[] = [];
    const navigatorWas = globalThis.navigator;
    const fake = (accepts: boolean) => ({
      sendBeacon: (url: string, body: Blob) => {
        taken.push({ url, body });
        return accepts;
      },
    });

    // Where the browser takes the beacon, nothing else is sent: it outlives the page, and `fetch` would not.
    Object.defineProperty(globalThis, 'navigator', { value: fake(true), configurable: true });
    const ok = endpoint(204, {});
    createPublicFormClient({ fetch: ok.fetch }).event(form.key, { kind: 'view' });
    expect(taken.map((one) => one.url)).toEqual(['/api/public/forms/contact-us/events']);
    expect(ok.sent).toEqual([]);

    // A browser that refuses it (its own queue is full) is not a lost count: the post says the same thing,
    // as `text/plain`, which asks for no preflight — the same request the beacon would have made.
    Object.defineProperty(globalThis, 'navigator', { value: fake(false), configurable: true });
    const after = endpoint(204, {});
    createPublicFormClient({ fetch: after.fetch }).event(form.key, { kind: 'reach', questionId: 'q-1' });
    expect(after.sent).toHaveLength(1);
    expect(after.sent[0]?.init?.method).toBe('POST');
    expect(after.sent[0]?.init?.keepalive).toBe(true);
    expect(after.sent[0]?.init?.body).toBe('{"kind":"reach","questionId":"q-1"}');

    // A beacon that throws is swallowed whole: a count is never worth an error on a visitor's page.
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        sendBeacon: () => {
          throw new Error('blocked');
        },
      },
      configurable: true,
    });
    expect(() => createPublicFormClient({ fetch: ok.fetch }).event(form.key, { kind: 'start' })).not.toThrow();

    Object.defineProperty(globalThis, 'navigator', { value: navigatorWas, configurable: true });
  });
});
