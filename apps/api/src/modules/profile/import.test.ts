// Bringing a link in bio page across (spec 0055, AC-5524, AC-5525, AC-5528): the handler's own rules, which is
// where this feature touches the outside world. The parser and the definer are tested where they live; what is
// proved here is the order of the checks (nothing is fetched for an address we will not read), that a redirect
// out of the allow list is refused by the fetch itself, and that the hourly limit bounds the asks, not just the
// writes. Every outside read is a stub: no test reaches the network or a resolver.
import { isImportableHost, newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.ts';
import { createMailpitMailer } from '../../mail/mailpit.ts';
import { createOutsideFetch, type OutsideFetch } from '../../public/outside.ts';
import { testEnv, testServices, TEST_IMPORT_PAGE } from '../../testing.ts';
import { MAILPIT_URL, testConnections } from '../../../test/sign-in.ts';
import { failure, memberWithWorkspace } from '../../../test/workspace.ts';

const PAGE = 'https://linktr.ee/someone';

let db: Database;
let identity: IdentityStore;

beforeAll(() => {
  ({ db, identity } = testConnections());
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

/** An app whose one outside read is `outsideFetch`, with a member signed in and a handle of their own claimed. */
async function withImport(outsideFetch: OutsideFetch) {
  const env = testEnv();
  // Signing in reads its code back from Mailpit, as every other api test that signs somebody in does.
  const mailer = createMailpitMailer({ url: MAILPIT_URL, from: 'Timefix <noreply@example.com>' });
  const app = createApp({ services: { ...testServices(env, { db, identity, mailer }), outsideFetch }, env });
  const m = await memberWithWorkspace(app);
  await m.client.profile.update({
    workspace: m.slug,
    handle: `i${newId().replaceAll('-', '').slice(0, 20)}`,
    mutationId: newId(),
  });
  return m;
}

describe('profile.importLinks', () => {
  it('reads nothing at all for an address that isn’t one of the services', async () => {
    const read = vi.fn<OutsideFetch>(() => Promise.resolve({ ok: false as const, reason: 'url' as const }));
    const m = await withImport(read);
    for (const url of ['https://evil.example/x', 'not a url', 'http://169.254.169.254/latest/meta-data/']) {
      const refused = await failure(() =>
        m.client.profile.importLinks({ workspace: m.slug, id: newId(), url, mutationId: newId() }),
      );
      expect(refused.code, url).toBe('CONFIG_INVALID');
    }
    // The order is the point: the allow list is checked before anything leaves this process.
    expect(read).not.toHaveBeenCalled();
  }, 60_000);

  it('brings a page’s rows across hidden, and lists what it couldn’t make', async () => {
    const m = await withImport(() =>
      Promise.resolve({ ok: true as const, type: 'text/html', bytes: new TextEncoder().encode(TEST_IMPORT_PAGE) }),
    );
    const answer = await m.client.profile.importLinks({
      workspace: m.slug,
      id: newId(),
      url: PAGE,
      mutationId: newId(),
    });
    expect(answer.import.made).toBe(2);
    expect(answer.import.skipped).toEqual([{ reason: 'no-address', title: 'Nowhere' }]);
    // Hidden, every one: nothing a visitor sees has changed.
    expect(answer.items).toEqual([]);
    expect(answer.archived).toHaveLength(2);
    // In the page's own order: one import archives its rows at one moment, and their ids rise in that order.
    expect(answer.archived.map((item) => (item.kind === 'link' ? item.title : item.kind))).toEqual(['Shop', 'My blog']);
  }, 60_000);

  it('refuses a redirect out of the services, through the fetch’s own rule', async () => {
    // The real fetch over a stub network and resolver: the allow list is what stands between this feature and a
    // request to an address inside our own network, and it has to hold after a redirect as well as before one.
    const hops = ['https://evil.example/x', 'http://169.254.169.254/latest/meta-data/'];
    for (const location of hops) {
      const send = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 302, headers: { location } })),
      ) as unknown as typeof globalThis.fetch;
      const read = createOutsideFetch({ fetch: send, lookup: () => Promise.resolve(['93.184.216.34']) });
      const got = await read(new URL(PAGE), { allow: isImportableHost });
      expect(got, location).toEqual({ ok: false, reason: 'redirect' });
    }
  });

  it('spends an ask whether or not the page answers, so a page that never answers can’t be asked for all day', async () => {
    const read = vi.fn<OutsideFetch>(() => Promise.resolve({ ok: false as const, reason: 'timeout' as const }));
    const m = await withImport(read);
    const ask = () =>
      failure(() => m.client.profile.importLinks({ workspace: m.slug, id: newId(), url: PAGE, mutationId: newId() }));
    expect((await ask()).code).toBe('CONFIG_INVALID');
    expect((await ask()).code).toBe('CONFIG_INVALID');
    expect((await ask()).code).toBe('CONFIG_INVALID');
    // The fourth is past the window's number, and never reaches the network.
    expect((await ask()).code).toBe('LIMIT_REACHED');
    expect(read).toHaveBeenCalledTimes(3);
  }, 60_000);

  it('refuses an address that grows past what the import keeps when it is encoded', async () => {
    const read = vi.fn<OutsideFetch>(() => Promise.resolve({ ok: false as const, reason: 'url' as const }));
    const m = await withImport(read);
    const refused = await failure(() =>
      m.client.profile.importLinks({
        workspace: m.slug,
        id: newId(),
        url: `https://linktr.ee/${'é'.repeat(200)}`,
        mutationId: newId(),
      }),
    );
    expect(refused.code).toBe('CONFIG_INVALID');
    expect(read).not.toHaveBeenCalled();
  }, 60_000);
});
