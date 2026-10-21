// The public booking client (spec 0025) against a fake fetch: the paths it
// calls, its body, and each failure as a DataError with the API's code.
import { describe, expect, it } from 'vitest';
import { createManageClient } from './manage.ts';
import { createBookingClient, isDataError, withPreviewDraft, type PublicBookingPage } from './public.ts';

function fake(answer: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const options = {
    origin: 'https://app.test',
    now: () => 0,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      return Promise.resolve(answer(url, init));
    },
  };
  return { client: createBookingClient(options), manage: createManageClient(options), calls };
}

const KEY = 'abcdefghijklmnop';

describe('createBookingClient', () => {
  it('reads the page and its slots, and books with a JSON body, cookies left out', async () => {
    const { client, calls } = fake((url) =>
      Response.json(
        url.endsWith('/book')
          ? { booking: { start: '2026-11-02T09:00:00.000Z' }, manageToken: 't' }
          : url.includes('/slots')
            ? { slots: [] }
            : { title: 'Intro' },
      ),
    );
    expect(await client.page(KEY)).toEqual({ title: 'Intro' });
    expect(
      await client.slots(KEY, {
        from: '2026-11-02T00:00:00.000Z',
        to: '2026-11-09T00:00:00.000Z',
        duration: 30,
        tz: 'Europe/London',
      }),
    ).toEqual({ slots: [] });
    expect(calls[1]?.url).toBe(
      `https://app.test/api/public/booking/${KEY}/slots?from=2026-11-02T00%3A00%3A00.000Z&to=2026-11-09T00%3A00%3A00.000Z&duration=30&tz=Europe%2FLondon`,
    );
    const booked = await client.book(KEY, {
      idempotencyKey: '0192f5a0-0000-7000-8000-000000000000',
      start: '2026-11-02T09:00:00.000Z',
      duration: 30,
      name: 'Grace',
      email: 'grace@example.com',
      timeZone: 'Europe/London',
    });
    expect(booked).toEqual({ booking: { start: '2026-11-02T09:00:00.000Z' }, manageToken: 't' });
    expect(client.icsUrl('t')).toBe('https://app.test/api/public/booking/manage/t/ics');
    expect(calls[2]?.init).toMatchObject({ method: 'POST', credentials: 'omit' });
    const body = calls[2]?.init?.body;
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toMatchObject({ name: 'Grace' });
  });

  it('reads a form’s hand off for the page by its token, cookies left out (AC-1058)', async () => {
    const { client, calls } = fake(() => Response.json({ name: 'Ada', email: 'ada@example.com' }));
    expect(await client.prefill(KEY, 'fb1.a.b')).toEqual({ name: 'Ada', email: 'ada@example.com' });
    expect(calls[0]?.url).toBe(`https://app.test/api/public/booking/${KEY}/prefill?p=fb1.a.b`);
    expect(calls[0]?.init).toMatchObject({ credentials: 'omit' });
  });

  it('sends a chat turn as JSON with no cookies, and a refusal as a DataError with its wait (spec 0042)', async () => {
    const { client, calls } = fake((url) =>
      url.endsWith('/chat')
        ? Response.json({ text: 'Hi', offers: [], suggestions: [], duration: 30 })
        : Response.json({}),
    );
    const input = {
      conversationId: '0192f5a0-0000-7000-8000-000000000000',
      duration: 30 as const,
      timeZone: 'UTC',
      hour12: true,
      messages: [{ role: 'visitor' as const, text: 'tomorrow' }],
    };
    expect(await client.chat(KEY, input)).toEqual({ text: 'Hi', offers: [], suggestions: [], duration: 30 });
    expect(calls[0]).toMatchObject({
      url: `https://app.test/api/public/booking/${KEY}/chat`,
      init: { method: 'POST', credentials: 'omit' },
    });
    const limited = fake(() =>
      Response.json({ code: 'RATE_LIMITED', message: 'Too many.' }, { status: 429, headers: { 'retry-after': '7' } }),
    );
    const error = await limited.client.chat(KEY, input).catch((caught: unknown) => caught);
    expect(isDataError(error) && error.code).toBe('RATE_LIMITED');
    expect(isDataError(error) && error.retryAfterSeconds).toBe(7);
  });

  it('sends cookies only to the viewer, the slots and forgetting, and builds the connect address', async () => {
    const { client, calls } = fake(() => Response.json({}));
    await client.slots(KEY, { from: 'a', to: 'b', duration: 30, tz: 'UTC' });
    expect(calls[0]?.init).toMatchObject({ credentials: 'same-origin' });
    expect(await client.viewer(KEY)).toEqual({});
    expect(calls[1]).toMatchObject({
      url: `https://app.test/api/public/booking/${KEY}/viewer`,
      init: { credentials: 'same-origin' },
    });
    await client.forget();
    expect(calls[2]).toMatchObject({
      url: 'https://app.test/api/public/booking/connect/forget',
      init: { method: 'POST', credentials: 'same-origin' },
    });
    expect(client.connectUrl(KEY, `/b/${KEY}?d=30`)).toBe(
      `https://app.test/api/public/booking/${KEY}/connect?return=%2Fb%2F${KEY}%3Fd%3D30`,
    );
  });

  it('turns an answer with a code into that DataError, with the wait and the issues', async () => {
    const taken = fake(() =>
      Response.json({ code: 'SLOT_TAKEN', message: 'That time was just taken. Pick another.' }, { status: 409 }),
    );
    await expect(taken.client.page(KEY)).rejects.toMatchObject({
      code: 'SLOT_TAKEN',
      message: 'That time was just taken. Pick another.',
    });
    const limited = fake(() =>
      Response.json(
        { code: 'RATE_LIMITED', message: 'Too many requests.' },
        { status: 429, headers: { 'retry-after': '30' } },
      ),
    );
    await expect(limited.client.page(KEY)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 30 });
    const invalid = fake(() =>
      Response.json(
        {
          code: 'INPUT_INVALID',
          message: 'Give your name.',
          data: { issues: [{ path: ['name'], message: 'Give your name.' }] },
        },
        { status: 400 },
      ),
    );
    const error: unknown = await invalid.client.page(KEY).catch((caught: unknown) => caught);
    expect(isDataError(error) && error.data).toEqual({ issues: [{ path: ['name'], message: 'Give your name.' }] });
  });

  it('reads where the booking could move, then moves, invites and cancels it by the token, cookies left out', async () => {
    const { manage: client, calls } = fake((url) =>
      Response.json(url.endsWith('/guests') ? { added: 1, guests: ['ann@example.com'] } : { booking: { state: 'x' } }),
    );
    await client.moveSlots('tok', { from: '2026-11-02T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z', tz: 'UTC' });
    expect(calls[0]?.url).toBe(
      'https://app.test/api/public/booking/manage/tok/slots?from=2026-11-02T00%3A00%3A00.000Z&to=2026-11-03T00%3A00%3A00.000Z&tz=UTC',
    );
    await client.move('tok', '2026-11-02T10:00:00.000Z');
    expect(await client.addGuests('tok', ['ann@example.com'])).toEqual({ added: 1, guests: ['ann@example.com'] });
    await client.cancel('tok', '');
    await client.cancel('tok', 'Ill.');
    expect(
      calls.slice(1).map((call) => [call.url.replace('https://app.test/api/public/booking/', ''), call.init?.body]),
    ).toEqual([
      ['manage/tok/move', JSON.stringify({ start: '2026-11-02T10:00:00.000Z' })],
      ['manage/tok/guests', JSON.stringify({ emails: ['ann@example.com'] })],
      ['manage/tok/cancel', '{}'],
      ['manage/tok/cancel', JSON.stringify({ reason: 'Ill.' })],
    ]);
    expect(calls.every((call) => call.init?.credentials === 'omit')).toBe(true);
  });

  it('says offline when the server can’t be reached', async () => {
    const client = createBookingClient({
      origin: 'https://app.test',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(client.page(KEY)).rejects.toMatchObject({ code: 'API_UNAVAILABLE' });
  });
});

describe('withPreviewDraft', () => {
  const page: PublicBookingPage = {
    publicKey: KEY,
    title: 'Intro',
    description: '',
    hostName: 'Ada',
    durations: [30],
    location: { type: 'video' },
    hostTimeZone: 'Europe/London',
    windowDays: 60,
  };

  it('lays the draft’s title, description, lengths and place over the page', () => {
    const draft = {
      title: 'Quick chat',
      description: 'Hi',
      durations: [15, 60],
      location: { type: 'custom', value: 'Cafe' },
    };
    expect(withPreviewDraft(page, { type: 'crm:preview', draft })).toEqual({
      ...page,
      title: 'Quick chat',
      description: 'Hi',
      durations: [15, 60],
      location: { type: 'custom', value: 'Cafe' },
    });
  });

  it('keeps the page’s own values for anything malformed, and ignores other messages', () => {
    const draft = { title: ' ', durations: [7, '30'], location: { type: 'address' }, hostName: 'Eve' };
    expect(withPreviewDraft(page, { type: 'crm:preview', draft })).toEqual(page);
    expect(withPreviewDraft(page, { type: 'other', draft })).toBeUndefined();
    expect(withPreviewDraft(page, 'crm:preview')).toBeUndefined();
  });
});
