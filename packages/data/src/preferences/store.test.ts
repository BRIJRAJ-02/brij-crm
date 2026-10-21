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
    calls[1]?.settle(false);
    expect(await changing).toBe(false);
    expect(store.of('acme').getSnapshot()).toEqual({ status: 'ready', preferences: DEFAULTS });
    expect(notices).toHaveLength(1);
    expect(notices[0]?.tone).toBe('danger');
  });

  it('never lets an older answer undo a newer change', async () => {
    const { calls, store } = setup();
    const loading = store.load('acme');
    calls[0]?.settle(true, DEFAULTS);
    await loading;
    void store.change('acme', { dateFormat: 'dmy' });
    void store.change('acme', { dateFormat: 'ymd' });
    calls[1]?.settle(true, { ...DEFAULTS, dateFormat: 'dmy' });
    await tick();
    expect(store.of('acme').getSnapshot()).toMatchObject({ preferences: { dateFormat: 'ymd' } });
    calls[2]?.settle(true, { ...DEFAULTS, dateFormat: 'ymd' });
    await tick();
    expect(store.of('acme').getSnapshot()).toMatchObject({ preferences: { dateFormat: 'ymd' } });
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
