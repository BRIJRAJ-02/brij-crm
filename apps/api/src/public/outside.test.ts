// The one outside fetch (spec 0055, AC-5520): every bound it puts on an address somebody typed, with the
// resolver and the network passed in, so the refusals are tested rather than described.
import { describe, expect, it, vi } from 'vitest';
import { createOutsideFetch, OUTSIDE_AGENT } from './outside.ts';

const PUBLIC = ['93.184.216.34'];

/** A fetch that answers one thing, and remembers what it was asked. */
const answers = (parts: { status?: number; type?: string; body?: string; location?: string; length?: string } = {}) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = vi.fn((input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const headers = new Headers();
    if (parts.type !== undefined) headers.set('content-type', parts.type);
    if (parts.location !== undefined) headers.set('location', parts.location);
    if (parts.length !== undefined) headers.set('content-length', parts.length);
    return Promise.resolve(new Response(parts.body ?? 'hello', { status: parts.status ?? 200, headers }));
  });
  return { send: send as unknown as typeof globalThis.fetch, calls };
};

const lookupOf = (map: Record<string, readonly string[]>) => (host: string) => Promise.resolve(map[host] ?? PUBLIC);

describe('createOutsideFetch', () => {
  it('reads a public https address, and says who we are', async () => {
    const { send, calls } = answers({ type: 'text/html' });
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({}) });
    const got = await read(new URL('https://linktr.ee/ada'));
    expect(got.ok).toBe(true);
    expect(calls[0]?.url).toBe('https://linktr.ee/ada');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['user-agent']).toBe(OUTSIDE_AGENT);
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.referrerPolicy).toBe('no-referrer');
    expect(calls[0]?.init.redirect).toBe('manual');
  });

  it.each([
    ['http://example.com/', 'plain http'],
    ['https://127.0.0.1/', 'a literal address'],
    ['https://169.254.169.254/latest/meta-data/', 'the metadata address written out'],
    ['https://user:pass@example.com/', 'credentials in the address'],
  ])('never opens %s (%s), and asks nothing', async (href) => {
    const { send } = answers({});
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({}) });
    const got = await read(new URL(href));
    expect(got).toEqual({ ok: false, reason: 'url' });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves inward, without opening it', async () => {
    const { send } = answers({});
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({ 'inside.example.com': ['10.0.0.5'] }) });
    expect(await read(new URL('https://inside.example.com/'))).toEqual({ ok: false, reason: 'url' });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a name where only one answer is inward: an attacker chooses which we get', async () => {
    const { send } = answers({});
    const read = createOutsideFetch({
      fetch: send,
      lookup: lookupOf({ 'both.example.com': ['93.184.216.34', '127.0.0.1'] }),
    });
    expect(await read(new URL('https://both.example.com/'))).toEqual({ ok: false, reason: 'url' });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a name that resolves to nothing', async () => {
    const { send } = answers({});
    const read = createOutsideFetch({ fetch: send, lookup: () => Promise.resolve([]) });
    expect(await read(new URL('https://nowhere.example.com/'))).toEqual({ ok: false, reason: 'url' });
  });

  it('checks a redirect before following it: inward is refused after the first hop', async () => {
    const { send } = answers({ status: 302, location: 'https://inside.example.com/' });
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({ 'inside.example.com': ['169.254.169.254'] }) });
    expect(await read(new URL('https://linktr.ee/ada'))).toEqual({ ok: false, reason: 'redirect' });
  });

  it('refuses a redirect to another scheme', async () => {
    const { send } = answers({ status: 301, location: 'http://linktr.ee/ada' });
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({}) });
    expect(await read(new URL('https://linktr.ee/ada'))).toEqual({ ok: false, reason: 'redirect' });
  });

  it('follows at most two redirects', async () => {
    const { send, calls } = answers({ status: 302, location: 'https://linktr.ee/again' });
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({}) });
    expect(await read(new URL('https://linktr.ee/ada'))).toEqual({ ok: false, reason: 'redirect' });
    expect(calls).toHaveLength(3);
  });

  it('refuses a body past the cap, by what it says and by what it sends', async () => {
    const declared = answers({ type: 'text/html', length: '999999' });
    const readDeclared = createOutsideFetch({ fetch: declared.send, lookup: lookupOf({}), maxBytes: 10 });
    expect(await readDeclared(new URL('https://linktr.ee/ada'))).toEqual({ ok: false, reason: 'size' });

    const sent = answers({ type: 'text/html', body: 'x'.repeat(500) });
    const readSent = createOutsideFetch({ fetch: sent.send, lookup: lookupOf({}), maxBytes: 10 });
    expect(await readSent(new URL('https://linktr.ee/ada'))).toEqual({ ok: false, reason: 'size' });
  });

  it('takes only the types the caller asked for', async () => {
    const { send } = answers({ type: 'image/svg+xml' });
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({}) });
    const got = await read(new URL('https://linktr.ee/icon'), { accept: ['image/png'] });
    expect(got).toEqual({ ok: false, reason: 'type' });
  });

  it('answers a status that is not 200 as a miss, never as a body', async () => {
    const { send } = answers({ status: 404 });
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({}) });
    expect(await read(new URL('https://linktr.ee/ada'))).toEqual({ ok: false, reason: 'status' });
  });

  it('obeys a caller’s own rule as well as its own, and asks nothing when it fails', async () => {
    const { send } = answers({ type: 'text/html' });
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({}) });
    const onlyLinktree = (url: URL) => url.hostname === 'linktr.ee';
    expect(await read(new URL('https://example.com/ada'), { allow: onlyLinktree })).toEqual({
      ok: false,
      reason: 'url',
    });
    expect(send).not.toHaveBeenCalled();
    expect((await read(new URL('https://linktr.ee/ada'), { allow: onlyLinktree })).ok).toBe(true);
  });

  it('answers a network failure as a miss rather than throwing', async () => {
    const send = (() => Promise.reject(new Error('refused'))) as unknown as typeof globalThis.fetch;
    const read = createOutsideFetch({ fetch: send, lookup: lookupOf({}) });
    expect(await read(new URL('https://linktr.ee/ada'))).toEqual({ ok: false, reason: 'network' });
  });
});
