import { describe, expect, it } from 'vitest';
import { browserPattern, createPublicFormClient } from './client.ts';

const form = {
  key: 'abcdefghijklmnopqrstuvwx',
  status: 'live',
  versionNumber: 1,
  title: 'Contact us',
  buttonText: 'Send',
  language: 'en',
  steps: [{ id: 'main', blocks: [] }],
  indexing: false,
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
      [409, { code: 'FORM_CHANGED', message: 'x' }, { kind: 'changed' }],
      [429, { code: 'RATE_LIMITED', message: 'x' }, { kind: 'limited' }],
      [500, { code: 'INTERNAL', message: 'x' }, { kind: 'failed' }],
    ];
    for (const [status, body, expected] of cases) {
      const answer = endpoint(status, body);
      expect(await createPublicFormClient({ fetch: answer.fetch }).submit(form.key, submission)).toEqual(expected);
    }
    const offline = createPublicFormClient({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    expect(await offline.submit(form.key, submission)).toEqual({ kind: 'failed' });
  });

  it('checks patterns with the browser’s engine, passing one it can’t compile', () => {
    expect(browserPattern('^(?:[A-Z]{3})$', false).test('ABC')).toBe(true);
    expect(browserPattern('^(?:[A-Z]{3})$', true).test('abc')).toBe(true);
    expect(browserPattern('(', false).test('anything')).toBe(true);
  });
});
