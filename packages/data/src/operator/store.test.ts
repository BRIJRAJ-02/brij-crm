// The operator console's held reads (spec 0047): one read per question, a refusal held (never thrown) and tried
// again when asked, a minute old answer read again behind the shown one, and the users list growing by pages.
import type { OperatorUserPage, OperatorUserRow } from '@crm/contracts';
import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';
import { createOperatorStore, OPERATOR_FRESH_MS, type OperatorApi } from './store.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const row = (n: number): OperatorUserRow => ({
  id: `0199a6f2-0000-7000-8000-${String(n).padStart(12, '0')}`,
  name: `User ${String(n)}`,
  email: `user${String(n)}@example.com`,
  createdAt: '2026-10-01T00:00:00.000Z',
  activeDays: 0,
  workspaces: 0,
  recordsMade: 0,
  bookingsHosted: 0,
  pages: 0,
  twoFactor: false,
});

const range = { period: '30d', from: '2026-09-24', to: '2026-10-23' } as const;

function fakeApi(overrides: Partial<OperatorApi> = {}): OperatorApi & { readonly calls: string[] } {
  const calls: string[] = [];
  const never = () => Promise.reject(new Error('Not used here.'));
  return {
    calls,
    overview: (period) => {
      calls.push(`overview:${period}`);
      return Promise.resolve({ ...range, period } as never);
    },
    users: ({ after }): Promise<OperatorUserPage> => {
      calls.push(`users:${after ?? 'first'}`);
      return Promise.resolve(
        after === undefined
          ? { ...range, total: 3, users: [row(1), row(2)], next: 'next' }
          : { ...range, total: 3, users: [row(3)] },
      );
    },
    user: never,
    pages: never,
    page: never,
    site: never,
    ...overrides,
  };
}

describe('the operator store', () => {
  it('reads a question once, and again behind the shown answer once it is a minute old', async () => {
    let now = 0;
    const api = fakeApi();
    const store = createOperatorStore(api, () => now);
    const held = store.overview('30d');
    expect(held.getSnapshot()).toEqual({ status: 'loading' });
    await held.ready();
    expect(held.getSnapshot()).toMatchObject({ status: 'ready', value: { period: '30d' } });
    store.overview('30d');
    expect(api.calls).toEqual(['overview:30d']);
    now = OPERATOR_FRESH_MS + 1;
    const again = store.overview('30d');
    expect(again.getSnapshot().status).toBe('ready');
    await flush();
    expect(api.calls).toEqual(['overview:30d', 'overview:30d']);
  });

  it('holds a refusal, and reads again on Retry', async () => {
    let fail = true;
    const api = fakeApi({
      overview: () =>
        fail
          ? Promise.reject(new ORPCError('TWO_FACTOR_REQUIRED', { status: 403, message: 'Turn on two factor.' }))
          : Promise.resolve({ ...range } as never),
    });
    const store = createOperatorStore(api);
    const held = store.overview('7d');
    await held.ready();
    expect(held.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'TWO_FACTOR_REQUIRED' } });
    fail = false;
    // Asked again, the refusal stays until Retry.
    expect(store.overview('7d').getSnapshot().status).toBe('error');
    held.retry();
    expect(held.getSnapshot()).toEqual({ status: 'loading' });
    await flush();
    expect(held.getSnapshot().status).toBe('ready');
  });

  it('grows the users list a page at a time, one page in flight', async () => {
    const api = fakeApi();
    const store = createOperatorStore(api);
    const list = store.users('30d', '');
    await list.ready();
    expect(list.getSnapshot()).toMatchObject({ status: 'ready', total: 3, hasMore: true });
    list.more();
    list.more();
    expect(list.getSnapshot().isLoadingMore).toBe(true);
    await flush();
    expect(list.getSnapshot().users.map((user) => user.name)).toEqual(['User 1', 'User 2', 'User 3']);
    expect(list.getSnapshot()).toMatchObject({ hasMore: false, isLoadingMore: false });
    expect(api.calls).toEqual(['users:first', 'users:next']);
    // Asked again, the same list with its pages.
    expect(store.users('30d', '').getSnapshot().users).toHaveLength(3);
  });
});
