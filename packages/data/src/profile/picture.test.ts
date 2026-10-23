// The picture choice store (owner ask A124): one read shared by the loader and the screen, a change shown at once
// and put back with a toast and Try again when refused, changes sent in order, and an older answer never undoing
// a newer change.
import type { MyProfile } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { createPictureChoiceStore, PICTURE_CHOICE_FRESH_MS } from './picture.ts';

const PROFILE: MyProfile = {
  memberId: '0199a2c4-0000-7000-8000-000000000001',
  name: 'Ada',
  email: 'ada@example.com',
  workspaceTimeZone: 'UTC',
  bio: '',
  pictureHidden: false,
};
const hidden = (isHidden: boolean): MyProfile => ({ ...PROFILE, pictureHidden: isHidden });

/** A hand answered API: each call waits until the test settles it. */
function fakeApi() {
  const calls: {
    readonly kind: 'get' | 'update';
    readonly input: unknown;
    readonly settle: (ok: boolean, value?: MyProfile) => void;
  }[] = [];
  const pending = (kind: 'get' | 'update', input: unknown) =>
    new Promise<MyProfile>((resolve, reject) => {
      calls.push({
        kind,
        input,
        settle: (ok, value) => {
          if (ok && value !== undefined) resolve(value);
          else reject(dataError('FORBIDDEN', 'That didn’t save.'));
        },
      });
    });
  return {
    calls,
    api: { get: (input: unknown) => pending('get', input), update: (input: unknown) => pending('update', input) },
  };
}

function setup() {
  const fake = fakeApi();
  const notices: Notice[] = [];
  let ids = 0;
  const clock = { at: 0 };
  const store = createPictureChoiceStore({
    api: fake.api,
    mintId: () => `m${String((ids += 1))}`,
    notify: (notice) => notices.push(notice),
    now: () => clock.at,
  });
  return { ...fake, notices, store, clock };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A store whose choice was read as shown, ready for changes. */
async function ready() {
  const made = setup();
  const loaded = made.store.read('acme');
  made.calls[0]?.settle(true, PROFILE);
  await loaded;
  return made;
}

describe('the picture choice store', () => {
  it('reads with the profile for the loader, and serves the screen held right after from that read', async () => {
    const { calls, store, clock } = setup();
    const held = store.of('acme');
    expect(held.getSnapshot()).toEqual({ status: 'loading' });
    const loaded = store.read('acme');
    held.retain();
    // The screen held it while the loader's read was out: one read for both.
    expect(calls).toHaveLength(1);
    calls[0]?.settle(true, PROFILE);
    expect(await loaded).toEqual(PROFILE);
    expect(held.getSnapshot()).toEqual({ status: 'ready', isHidden: false, isSaving: false, canChange: true });
    held.retain();
    expect(calls).toHaveLength(1);
    // A later visit reads again, so another device's change shows.
    clock.at += PICTURE_CHOICE_FRESH_MS;
    held.retain();
    expect(calls).toHaveLength(2);
  });

  it('shows a change at once, sends it, and keeps what the server said', async () => {
    const { calls, store } = await ready();
    const landing = store.change('acme', true);
    expect(store.of('acme').getSnapshot()).toEqual({
      status: 'ready',
      isHidden: true,
      isSaving: true,
      canChange: true,
    });
    await tick();
    expect(calls[1]).toMatchObject({
      kind: 'update',
      input: { workspace: 'acme', pictureHidden: true, mutationId: 'm1' },
    });
    calls[1]?.settle(true, hidden(true));
    expect(await landing).toBe(true);
    expect(store.of('acme').getSnapshot()).toEqual({
      status: 'ready',
      isHidden: true,
      isSaving: false,
      canChange: true,
    });
  });

  it('puts a refused change back, says why with Try again, which sends it once more', async () => {
    const { calls, notices, store } = await ready();
    const refused = store.change('acme', true);
    await tick();
    calls[1]?.settle(false);
    expect(await refused).toBe(false);
    expect(store.of('acme').getSnapshot()).toMatchObject({ isHidden: false, isSaving: false });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ tone: 'danger', message: 'That didn’t save.', action: { label: 'Try again' } });
    expect(typeof notices[0]?.action?.onAction).toBe('function');
    notices[0]?.action?.onAction();
    expect(store.of('acme').getSnapshot()).toMatchObject({ isHidden: true, isSaving: true });
    await tick();
    expect(calls[2]).toMatchObject({ kind: 'update', input: { pictureHidden: true } });
    calls[2]?.settle(true, hidden(true));
    await tick();
    expect(store.of('acme').getSnapshot()).toMatchObject({ isHidden: true, isSaving: false });
  });

  it('sends changes one after another, and a refusal drops only its own', async () => {
    const { calls, store } = await ready();
    const first = store.change('acme', true);
    const second = store.change('acme', false);
    expect(store.of('acme').getSnapshot()).toMatchObject({ isHidden: false, isSaving: true });
    // The second waits for the first's answer.
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]?.settle(false);
    expect(await first).toBe(false);
    await tick();
    expect(store.of('acme').getSnapshot()).toMatchObject({ isHidden: false, isSaving: true });
    expect(calls[2]).toMatchObject({ input: { pictureHidden: false } });
    calls[2]?.settle(true, hidden(false));
    expect(await second).toBe(true);
    expect(store.of('acme').getSnapshot()).toMatchObject({ isHidden: false, isSaving: false });
  });

  it('never lets a read sent before a change landed undo it', async () => {
    const { calls, store, clock } = await ready();
    clock.at += PICTURE_CHOICE_FRESH_MS;
    store.of('acme').retain();
    expect(calls[1]).toMatchObject({ kind: 'get' });
    const landing = store.change('acme', true);
    await tick();
    calls[2]?.settle(true, hidden(true));
    await landing;
    // The read answers late, from before the change.
    calls[1]?.settle(true, hidden(false));
    await tick();
    expect(store.of('acme').getSnapshot()).toMatchObject({ isHidden: true });
  });

  it('sends nothing while unread, for no change, or for a member who can’t change it', async () => {
    const { calls, store } = setup();
    expect(await store.change('acme', true)).toBe(false);
    expect(calls).toHaveLength(0);
    const loaded = store.read('acme');
    const { pictureHidden: _none, ...unsigned } = PROFILE;
    calls[0]?.settle(true, unsigned);
    await loaded;
    expect(store.of('acme').getSnapshot()).toEqual({
      status: 'ready',
      isHidden: false,
      isSaving: false,
      canChange: false,
    });
    expect(await store.change('acme', true)).toBe(false);
    const other = await ready();
    expect(await other.store.change('acme', false)).toBe(true);
    expect(other.calls).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('says a failed read, and Try again reads again', async () => {
    const { calls, store } = setup();
    const held = store.of('acme');
    held.retain();
    calls[0]?.settle(false);
    await tick();
    expect(held.getSnapshot()).toEqual({ status: 'error', message: 'That didn’t save.' });
    held.retry();
    expect(held.getSnapshot()).toEqual({ status: 'loading' });
    calls[1]?.settle(true, hidden(true));
    await tick();
    expect(held.getSnapshot()).toMatchObject({ status: 'ready', isHidden: true });
  });

  it('keeps each workspace apart, and forgets them all when signed out', async () => {
    const { calls, store } = await ready();
    expect(store.of('globex').getSnapshot()).toEqual({ status: 'loading' });
    store.clear();
    expect(store.of('acme').getSnapshot()).toEqual({ status: 'loading' });
    expect(calls).toHaveLength(1);
  });
});
