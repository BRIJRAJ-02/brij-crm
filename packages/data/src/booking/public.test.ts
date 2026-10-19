// The public booking client (spec 0025) against a fake fetch: the paths it
// calls, its body, and each failure as a DataError with the API's code.
import { describe, expect, it } from 'vitest';
import { createBookingClient, isDataError } from './public.ts';

function fake(answer: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = createBookingClient({
    origin: 'https://app.test',
    now: () => 0,
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      return Promise.resolve(answer(url, init));
    },
  });
  return { client, calls };
}

const KEY = 'abcdefghijklmnop';

describe('createBookingClient', () => {
  it('reads the page and its slots, and books with a JSON body, cookies left out', async () => {
    const { client, calls } = fake((url) =>
      Response.json(
        url.endsWith('/book')
          ? { booking: { start: '2026-11-02T09:00:00.000Z' } }
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
    expect(booked).toEqual({ start: '2026-11-02T09:00:00.000Z' });
    expect(calls[2]?.init).toMatchObject({ method: 'POST', credentials: 'omit' });
    const body = calls[2]?.init?.body;
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toMatchObject({ name: 'Grace' });
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

  it('says offline when the server can’t be reached', async () => {
    const client = createBookingClient({
      origin: 'https://app.test',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(client.page(KEY)).rejects.toMatchObject({ code: 'API_UNAVAILABLE' });
  });
});
