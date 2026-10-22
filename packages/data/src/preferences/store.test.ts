// The member's preferences store: one read shared by every holder, a change
// shown at once and put back with a toast when refused, and an older answer
// never undoing a newer change.
import type { MemberPreferences } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import type { Notice } from '../notice.ts';
import { applyChange, createPreferencesStore } from './store.ts';

const DEFAULTS: MemberPreferences = { dateFormat: 'auto', weekStart: 'auto', landing: { kind: 'home' } };

/** A hand answered API: each call waits until the test settles it. */
function fakeApi() {
  const calls: { kind: 'get' | 'update'; input: unknown; settle: (ok: boolean, value?: MemberPreferences) => void }[] =
    [];
  const pending = (kind: 'get' | 'update', input: unknown) =>
    new Promise<MemberPreferences>((resolve, reject) => {
      calls.push({
        kind,
        input,
        settle: (ok, value) => {
          if (ok && value !== undefined) resolve(value);
          else reject(Object.assign(new Error('No.'), { code: 'FORBIDDEN' }));
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
  const store = createPreferencesStore({
    api: fake.api,
    mintId: () => `m${String((ids += 1))}`,
    notify: (notice) => notices.push(notice),
  });
  return { ...fake, notices, store };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('applyChange', () => {
  it('changes only the fields named, and null takes the time zone away', () => {
    const zoned = applyChange(DEFAULTS, { timeZone: 'Asia/Kolkata', weekStart: 'sunday' });
    expect(zoned).toEqual({ ...DEFAULTS, timeZone: 'Asia/Kolkata', weekStart: 'sunday' });
    expect(applyChange(zoned, { dateFormat: 'ymd' })).toMatchObject({ timeZone: 'Asia/Kolkata', dateFormat: 'ymd' });
    expect(applyChange(zoned, { timeZone: null })).not.toHaveProperty('timeZone');
  });

  it('puts Home sections away and brings them back with an empty list', () => {
    const hidden = applyChange(DEFAULTS, { homeHidden: ['setup'] });
    expect(hidden).toEqual({ ...DEFAULTS, homeHidden: ['setup'] });
    expect(applyChange(hidden, { weekStart: 'monday' })).toMatchObject({ homeHidden: ['setup'] });
    expect(applyChange(hidden, { homeHidden: [] })).toEqual(DEFAULTS);
  });
});

describe('the preferences store', () => {
  it('reads once for every holder and loader', async () => {
    const { calls, store } = setup();
    const held = store.of('acme');
    held.retain();
    const loaded = store.load('acme');
    expect(calls).toHaveLength(1);
    calls[0]?.settle(true, DEFAULTS);
    expect(await loaded).toEqual(DEFAULTS);
    expect(held.getSnapshot()).toEqual({ status: 'ready', preferences: DEFAULTS });
  });

  it('shows a change at once and keeps the answer', async () => {
    const { calls, store } = setup();
    const loading = store.load('acme');
    calls[0]?.settle(true, DEFAULTS);
    await loading;
    const changing = store.change('acme', { weekStart: 'monday' });
    expect(store.of('acme').getSnapshot()).toMatchObject({ preferences: { weekStart: 'monday' } });
    await tick();
    expect(calls[1]?.input).toEqual({ workspace: 'acme', weekStart: 'monday', mutationId: 'm1' });
    calls[1]?.settle(true, { ...DEFAULTS, weekStart: 'monday' });
    expect(await changing).toBe(true);
  });

  it('puts a refused change back with a toast', async () => {
    const { calls, notices, store } = setup();
    const loading = store.load('acme');
    calls[0]?.settle(true, DEFAULTS);
    await loading;
    const changing = store.change('acme', { landing: { kind: 'tasks' } });
    await tick();
    calls[1]?.settle(false);
    expect(await changing).toBe(false);
    expect(store.of('acme').getSnapshot()).toEqual({ status: 'ready', preferences: DEFAULTS });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.tone).toBe('danger');
  });

  it('sends changes one after another, and a refusal drops only its own', async () => {
    const { calls, store } = setup();
    const loading = store.load('acme');
    calls[0]?.settle(true, DEFAULTS);
    await loading;
    const first = store.change('acme', { weekStart: 'sunday' });
    const second = store.change('acme', { dateFormat: 'ymd' });
    expect(store.of('acme').getSnapshot()).toMatchObject({ preferences: { weekStart: 'sunday', dateFormat: 'ymd' } });
    // The second waits for the first.
    await tick();
    expect(calls).toHaveLength(2);
    calls[1]?.settle(true, { ...DEFAULTS, weekStart: 'sunday' });
    expect(await first).toBe(true);
    await tick();
    expect(calls[2]?.input).toMatchObject({ dateFormat: 'ymd' });
    calls[2]?.settle(false);
    expect(await second).toBe(false);
    expect(store.of('acme').getSnapshot()).toEqual({
      status: 'ready',
      preferences: { ...DEFAULTS, weekStart: 'sunday' },
    });
  });

  it('forgets every copy once signed out', async () => {
    const { calls, store } = setup();
    const loading = store.load('acme');
    calls[0]?.settle(true, DEFAULTS);
    await loading;
    store.clear();
    void store.load('acme');
    expect(calls).toHaveLength(2);
  });
});
