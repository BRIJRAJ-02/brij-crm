// The social links store (booking socials, 25 Oct 2026): confirmed by the profile's read, a change of the whole set
// shown at once and put back with a toast and Try again when refused, changes sent in order, an older read never
// undoing a newer change, and Settings › Profile's own Save landing over what is held.
import type { MyProfile, SocialLink } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import { refusalSummary } from '../refusals.ts';
import type { Notice } from '../notice.ts';
import { createSocialLinksStore, SOCIAL_LINKS_FRESH_MS } from './socials.ts';

const ADA: SocialLink = { network: 'linkedin', href: 'https://linkedin.com/in/ada' };
const SITE: SocialLink = { network: 'website', href: 'https://ada.dev' };
const PROFILE: MyProfile = {
  memberId: '0199a2c4-0000-7000-8000-000000000001',
  name: 'Ada',
  email: 'ada@example.com',
  workspaceTimeZone: 'UTC',
  bio: '',
  socials: [ADA],
};
const withLinks = (socials: readonly SocialLink[]): MyProfile => ({ ...PROFILE, socials: [...socials] });

/** A hand answered API: each call waits until the test settles it. */
function setup() {
  const calls: {
    readonly kind: 'read' | 'update';
    readonly input: unknown;
    readonly settle: (ok: boolean, value?: MyProfile) => void;
  }[] = [];
  const pending = (kind: 'read' | 'update', input: unknown) =>
    new Promise<MyProfile>((resolve, reject) => {
      calls.push({
        kind,
        input,
        settle: (ok, value) => {
          if (ok && value !== undefined) resolve(value);
          else reject(dataError('CONFIG_INVALID', 'That isn’t a link to a LinkedIn profile.'));
        },
      });
    });
  const notices: Notice[] = [];
  let ids = 0;
  const clock = { at: 0 };
  const store = createSocialLinksStore({
    read: (workspace) => pending('read', workspace),
    update: (input) => pending('update', input),
    mintId: () => `m${String((ids += 1))}`,
    notify: (notice) => notices.push(notice),
    refusals: { refusalSummary },
    now: () => clock.at,
  });
  return { calls, notices, store, clock };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A store read with Ada's one link, held by a screen. */
async function ready() {
  const made = setup();
  const held = made.store.of('acme');
  held.retain();
  made.calls[0]?.settle(true, PROFILE);
  await tick();
  return { ...made, held };
}

describe('the social links store', () => {
  it('serves a screen held right after the profile loader’s read from that read', async () => {
    const { calls, store, clock } = setup();
    const loaded = store.read('acme');
    calls[0]?.settle(true, PROFILE);
    expect(await loaded).toEqual(PROFILE);
    const held = store.of('acme');
    held.retain();
    expect(calls).toHaveLength(1);
    expect(held.getSnapshot()).toEqual({ status: 'ready', links: [ADA], isSaving: false, canChange: true });
    // Held again later, it reads again behind what it shows.
    clock.at = SOCIAL_LINKS_FRESH_MS;
    held.retain();
    expect(calls.map((call) => call.kind)).toEqual(['read', 'read']);
  });

  it('never lets the loader’s read, sent before a change landed, put the older set back', async () => {
    const { calls, store, held } = await ready();
    const loader = store.read('acme');
    void store.change('acme', [SITE]);
    await tick();
    const update = calls.find((call) => call.kind === 'update');
    update?.settle(true, withLinks([SITE]));
    await tick();
    // The loader's read answers late, with the set as it was.
    calls[1]?.settle(true, PROFILE);
    await loader;
    expect(held.getSnapshot()).toMatchObject({ links: [SITE] });
  });

  it('shows a change at once, sends the whole set, and keeps the answer', async () => {
    const { calls, store, held } = await ready();
    const landing = store.change('acme', [SITE, ADA]);
    expect(held.getSnapshot()).toEqual({ status: 'ready', links: [SITE, ADA], isSaving: true, canChange: true });
    await tick();
    expect(calls[1]?.input).toEqual({ workspace: 'acme', socials: [SITE, ADA], mutationId: 'm1' });
    calls[1]?.settle(true, withLinks([SITE, ADA]));
    expect(await landing).toBe(true);
    expect(held.getSnapshot()).toEqual({ status: 'ready', links: [SITE, ADA], isSaving: false, canChange: true });
  });

  it('puts a refused change back and says why, with Try again sending it once more', async () => {
    const { calls, notices, store, held } = await ready();
    const landing = store.change('acme', [SITE]);
    await tick();
    calls[1]?.settle(false);
    expect(await landing).toBe(false);
    expect(held.getSnapshot()).toMatchObject({ links: [ADA], isSaving: false });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ tone: 'danger', action: { label: 'Try again' } });
    expect(notices[0]?.message).toMatch(/^Your social links weren’t saved\./);
    notices[0]?.action?.onAction();
    expect(held.getSnapshot()).toMatchObject({ links: [SITE], isSaving: true });
    await tick();
    expect(calls[2]?.input).toMatchObject({ socials: [SITE] });
  });

  it('lets Try again do nothing once a newer change was made', async () => {
    const { calls, notices, store, held } = await ready();
    void store.change('acme', [SITE]);
    await tick();
    calls[1]?.settle(false);
    await tick();
    void store.change('acme', []);
    await tick();
    notices[0]?.action?.onAction();
    expect(held.getSnapshot()).toMatchObject({ links: [] });
    expect(calls.filter((call) => call.kind === 'update')).toHaveLength(2);
  });

  it('sends changes one after another, showing the latest, and an older read never undoes them', async () => {
    const { calls, store, held, clock } = await ready();
    void store.change('acme', [SITE]);
    void store.change('acme', []);
    expect(held.getSnapshot()).toMatchObject({ links: [], isSaving: true });
    // A read sent before the changes land answers the old set: dropped.
    clock.at = SOCIAL_LINKS_FRESH_MS;
    held.retain();
    await tick();
    const read = calls.find((call, index) => index > 0 && call.kind === 'read');
    const firstUpdate = calls.find((call) => call.kind === 'update');
    firstUpdate?.settle(true, withLinks([SITE]));
    await tick();
    read?.settle(true, PROFILE);
    await tick();
    expect(calls.filter((call) => call.kind === 'update')).toHaveLength(2);
    calls.filter((call) => call.kind === 'update')[1]?.settle(true, withLinks([]));
    await tick();
    expect(held.getSnapshot()).toEqual({ status: 'ready', links: [], isSaving: false, canChange: true });
  });

  it('takes Settings › Profile’s own saved answer, and sends nothing for a member who has no links', async () => {
    const { calls, store, held } = await ready();
    store.landed('acme', withLinks([SITE]));
    expect(held.getSnapshot()).toMatchObject({ links: [SITE] });
    const { socials: _none, ...unsigned } = PROFILE;
    store.landed('acme', unsigned);
    expect(held.getSnapshot()).toMatchObject({ links: [], canChange: false });
    expect(await store.change('acme', [ADA])).toBe(false);
    expect(calls.filter((call) => call.kind === 'update')).toHaveLength(0);
  });

  it('says a failed first read, and reads again on Try again', async () => {
    const { calls, store } = setup();
    const held = store.of('acme');
    held.retain();
    calls[0]?.settle(false);
    await tick();
    expect(held.getSnapshot()).toMatchObject({ status: 'error' });
    held.retry();
    expect(held.getSnapshot()).toEqual({ status: 'loading' });
    calls[1]?.settle(true, PROFILE);
    await tick();
    expect(held.getSnapshot()).toMatchObject({ status: 'ready', links: [ADA] });
  });
});
