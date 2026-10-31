// The handle address's Vercel Function entry (`api/handle.mjs`): a cache tag is never allowed to fail the answer. On
// 31 Oct 2026 the runtime's `addCacheTag` answered no promise, the entry chained `.catch` on it, and every link page
// answered 500. Whatever the tag call does (a promise, nothing, a rejection, a throw), the shell still answers 200.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addCacheTag = vi.hoisted(() => vi.fn<(tags: readonly string[]) => unknown>());

vi.mock('@vercel/functions', () => ({ addCacheTag }));

// What the shell decides is `handle-shell.ts`'s, tested beside it; here it answers one tagged link page.
vi.mock('./handle-shell.ts', () => ({
  shellFor: () =>
    Promise.resolve({
      body: '<!doctype html><title>Ada</title>',
      status: 200,
      outcome: 'profile',
      tags: ['handle:ada'],
    }),
  cacheControlFor: () => 'public, max-age=0, s-maxage=60',
}));

// The built shell is written by the build and never committed, so the test stands in for it. Vite names a file that
// isn't there by its path from the app's root, so that is the name it is mocked by.
vi.mock('/api/shell.generated.mjs', () => ({ BOOKING_SHELL: '<!doctype html>', PACK_FONTS: {} }));

/** The entry's one export this test calls, read without a declaration file for the plain `.mjs`. */
interface HandleEntry {
  readonly GET: (request: Request) => Promise<Response>;
}

const ENTRY = './api/handle.mjs';

async function answer(): Promise<Response> {
  const entry = (await import(/* @vite-ignore */ ENTRY)) as HandleEntry;
  return await entry.GET(new Request('https://timefix.com/ada'));
}

describe('api/handle.mjs and its cache tag', () => {
  beforeEach(() => {
    addCacheTag.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers 200 and files the page under its tags when the tag call answers a promise', async () => {
    addCacheTag.mockResolvedValue(undefined);
    const response = await answer();
    expect(response.status).toBe(200);
    expect(addCacheTag).toHaveBeenCalledWith(['handle:ada']);
    expect(await response.text()).toContain('Ada');
  });

  it('answers 200 when the tag call answers no promise at all', async () => {
    addCacheTag.mockReturnValue(undefined);
    const response = await answer();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-crm-shell')).toBe('profile');
  });

  it('answers 200 when the tag call throws', async () => {
    addCacheTag.mockImplementation(() => {
      throw new Error('no cache in this runtime');
    });
    const response = await answer();
    expect(response.status).toBe(200);
  });

  it('answers 200 when the tag call rejects', async () => {
    addCacheTag.mockRejectedValue(new Error('tag refused'));
    const response = await answer();
    expect(response.status).toBe(200);
  });
});
