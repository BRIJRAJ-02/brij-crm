// The email preferences store against a fake API: the first read with the
// token in a header, a refused link, a change shown at once and the server's
// answer put in place, a refused change put back with its refusal, an older
// answer never undoing a newer change, one topic's answer never undoing
// another's change on its way, and a read again keeping changes on their way.
// Then the one click's page: nothing sent until the reader says yes, done
// once, and a refusal tried again.
import { describe, expect, it } from 'vitest';
import { createEmailPreferences, createEmailUnsubscribe, type EmailPreferencesView } from './email-preferences.ts';

const VIEW: EmailPreferencesView = {
  workspaceName: 'Acme',
  topic: 'mentions',
  preferences: [
    { topic: 'form_submissions', subscribed: true },
    { topic: 'mentions', subscribed: true },
  ],
};

/** A fake API: each call takes the next answer, and is remembered with its body and its link header. */
function fakeApi(answers: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; method: string; body: unknown; link: string | null; credentials?: string }[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      link: new Headers(init?.headers).get('x-crm-email-link'),
      ...(init?.credentials === undefined ? {} : { credentials: init.credentials }),
    });
    const next = answers.shift();
    return Promise.resolve(next === undefined ? new Response(null, { status: 500 }) : next());
  };
  return { calls, fetch };
}

const ok = (view: EmailPreferencesView) => () => Response.json(view);
const subscribedOf = (store: ReturnType<typeof createEmailPreferences>) => {
  const state = store.getSnapshot();
  return state.status === 'ready' ? state.view.preferences.map((each) => each.subscribed) : state.status;
};

describe('the email preferences store', () => {
  it('reads the page with the link’s token in a header, never the address, and no cookies', async () => {
    const api = fakeApi([ok(VIEW)]);
    const store = createEmailPreferences({ origin: 'https://app.test', fetch: api.fetch }, 'ep1.tok.en');
    expect(store.getSnapshot()).toEqual({ status: 'loading' });
    await store.load();
    expect(api.calls[0]).toEqual({
      url: 'https://app.test/api/public/email-preferences',
      method: 'GET',
      body: undefined,
      link: 'ep1.tok.en',
      credentials: 'omit',
    });
    expect(store.getSnapshot()).toEqual({ status: 'ready', view: VIEW, saving: new Set() });
  });

  it('answers a link that opens nothing with the API’s refusal', async () => {
    const api = fakeApi([
      () =>
        Response.json(
          { code: 'NOT_FOUND', message: 'This link doesn’t open email preferences any more.' },
          { status: 404 },
        ),
    ]);
    const store = createEmailPreferences({ origin: 'https://app.test', fetch: api.fetch }, 'x');
    await expect(store.load()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'NOT_FOUND' } });
  });

  it('shows a change at once, then the server’s answer', async () => {
    let answer: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const api = fakeApi([ok(VIEW), () => pending]);
    const store = createEmailPreferences({ origin: 'https://app.test', fetch: api.fetch }, 't');
    await store.load();
    const setting = store.set('mentions', false);
    expect(subscribedOf(store)).toEqual([true, false]);
    expect(store.getSnapshot()).toMatchObject({ saving: new Set(['mentions']) });
    answer(Response.json({ ...VIEW, preferences: [VIEW.preferences[0], { topic: 'mentions', subscribed: false }] }));
    await setting;
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', saving: new Set() });
    expect(subscribedOf(store)).toEqual([true, false]);
    expect(api.calls[1]).toMatchObject({ method: 'POST', body: { topic: 'mentions', subscribed: false }, link: 't' });
  });

  it('puts a refused change back, with the refusal, until the next change', async () => {
    const api = fakeApi([
      ok(VIEW),
      () => Response.json({ code: 'RATE_LIMITED', message: 'Too many requests.' }, { status: 429 }),
      ok(VIEW),
    ]);
    const store = createEmailPreferences({ origin: 'https://app.test', fetch: api.fetch }, 't');
    await store.load();
    await store.set('form_submissions', false);
    expect(subscribedOf(store)).toEqual([true, true]);
    expect(store.getSnapshot()).toMatchObject({ refused: { code: 'RATE_LIMITED' } });
    await store.set('mentions', true);
    expect(store.getSnapshot()).not.toHaveProperty('refused');
  });

  it('never lets an older answer undo a newer change to the same topic', async () => {
    const resolvers: ((response: Response) => void)[] = [];
    const later = () =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve);
      });
    const api = fakeApi([ok(VIEW), later, later]);
    const store = createEmailPreferences({ origin: 'https://app.test', fetch: api.fetch }, 't');
    await store.load();
    const off = store.set('mentions', false);
    const on = store.set('mentions', true);
    const offView = { ...VIEW, preferences: [VIEW.preferences[0], { topic: 'mentions', subscribed: false }] };
    resolvers[1]?.(Response.json(VIEW));
    await on;
    resolvers[0]?.(Response.json(offView));
    await off;
    expect(subscribedOf(store)).toEqual([true, true]);
  });

  it('never lets one topic’s answer undo another topic’s change on its way', async () => {
    const resolvers: ((response: Response) => void)[] = [];
    const later = () =>
      new Promise<Response>((resolve) => {
        resolvers.push(resolve);
      });
    const api = fakeApi([ok(VIEW), later, later]);
    const store = createEmailPreferences({ origin: 'https://app.test', fetch: api.fetch }, 't');
    await store.load();
    const mentions = store.set('mentions', false);
    const forms = store.set('form_submissions', false);
    expect(subscribedOf(store)).toEqual([false, false]);
    // The mentions answer was read before the forms change reached the server: forms still on there.
    resolvers[0]?.(
      Response.json({ ...VIEW, preferences: [VIEW.preferences[0], { topic: 'mentions', subscribed: false }] }),
    );
    await mentions;
    expect(subscribedOf(store)).toEqual([false, false]);
    expect(store.getSnapshot()).toMatchObject({ saving: new Set(['form_submissions']) });
    resolvers[1]?.(
      Response.json({
        ...VIEW,
        preferences: [
          { topic: 'form_submissions', subscribed: false },
          { topic: 'mentions', subscribed: false },
        ],
      }),
    );
    await forms;
    expect(subscribedOf(store)).toEqual([false, false]);
    expect(store.getSnapshot()).toMatchObject({ saving: new Set() });
  });

  it('keeps a refusal shown while another topic’s change lands', async () => {
    let answer: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const api = fakeApi([
      ok(VIEW),
      () => pending,
      () => Response.json({ code: 'RATE_LIMITED', message: 'Too many requests.' }, { status: 429 }),
    ]);
    const store = createEmailPreferences({ origin: 'https://app.test', fetch: api.fetch }, 't');
    await store.load();
    const mentions = store.set('mentions', false);
    await store.set('form_submissions', false);
    expect(store.getSnapshot()).toMatchObject({ refused: { code: 'RATE_LIMITED' } });
    answer(Response.json({ ...VIEW, preferences: [VIEW.preferences[0], { topic: 'mentions', subscribed: false }] }));
    await mentions;
    expect(store.getSnapshot()).toMatchObject({ refused: { code: 'RATE_LIMITED' }, saving: new Set() });
    expect(subscribedOf(store)).toEqual([true, false]);
  });

  it('reads again without losing a change on its way', async () => {
    let answer: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const api = fakeApi([ok(VIEW), () => pending, ok(VIEW)]);
    const store = createEmailPreferences({ origin: 'https://app.test', fetch: api.fetch }, 't');
    await store.load();
    const mentions = store.set('mentions', false);
    await store.load();
    expect(store.getSnapshot()).toMatchObject({ saving: new Set(['mentions']) });
    expect(subscribedOf(store)).toEqual([true, false]);
    answer(Response.json({ ...VIEW, preferences: [VIEW.preferences[0], { topic: 'mentions', subscribed: false }] }));
    await mentions;
    expect(subscribedOf(store)).toEqual([true, false]);
  });
});

describe('the one click unsubscribe’s store', () => {
  const DONE = { unsubscribed: true, workspaceName: 'Acme', topic: 'mentions' } as const;

  it('sends nothing until the reader says yes, then posts the token in a header once', async () => {
    const api = fakeApi([() => Response.json(DONE)]);
    const store = createEmailUnsubscribe({ origin: 'https://app.test', fetch: api.fetch }, 'eu1.tok.en');
    expect(store.getSnapshot()).toEqual({ status: 'asking' });
    expect(api.calls).toEqual([]);
    const confirming = store.confirm();
    expect(store.getSnapshot()).toEqual({ status: 'saving' });
    await confirming;
    expect(store.getSnapshot()).toEqual({ status: 'done', answer: DONE });
    expect(api.calls).toEqual([
      {
        url: 'https://app.test/api/public/email-preferences/unsubscribe',
        method: 'POST',
        body: undefined,
        link: 'eu1.tok.en',
        credentials: 'omit',
      },
    ]);
    await store.confirm();
    expect(api.calls).toHaveLength(1);
  });

  it('shows a refusal, and tries again on the next yes', async () => {
    const api = fakeApi([
      () => Response.json({ code: 'RATE_LIMITED', message: 'Too many requests.' }, { status: 429 }),
      () => Response.json(DONE),
    ]);
    const store = createEmailUnsubscribe({ origin: 'https://app.test', fetch: api.fetch }, 'x');
    await store.confirm();
    expect(store.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'RATE_LIMITED' } });
    await store.confirm();
    expect(store.getSnapshot()).toEqual({ status: 'done', answer: DONE });
  });
});
