// The workspace's region: read once when held, kept current by a save, never overwritten by an older read.
import { describe, expect, it } from 'vitest';
import { createRegionStore, REGION_FRESH_MS, regionOf } from './workspace-region.ts';

const settings = (over: { currency?: string; country?: string } = {}) => ({
  id: '0194b7c0-1111-7000-8000-000000000001',
  name: 'Acme',
  slug: 'acme',
  timeZone: 'UTC',
  ...over,
});

describe('regionOf', () => {
  it('keeps only what the workspace set', () => {
    expect(regionOf(settings())).toEqual({});
    expect(regionOf(settings({ currency: 'INR' }))).toEqual({ currency: 'INR' });
    expect(regionOf(settings({ currency: 'INR', country: 'IN' }))).toEqual({ currency: 'INR', country: 'IN' });
  });
});

describe('the region store', () => {
  it('reads when a screen holds it, and tells the screen', async () => {
    let reads = 0;
    const store = createRegionStore({
      read: () => {
        reads += 1;
        return Promise.resolve(settings({ country: 'GB' }));
      },
    });
    const held = store.of('acme');
    let told = 0;
    held.subscribe(() => {
      told += 1;
    });
    expect(held.getSnapshot()).toBeUndefined();
    held.retain();
    await Promise.resolve();
    await Promise.resolve();
    expect(held.getSnapshot()).toEqual({ country: 'GB' });
    expect(told).toBe(1);
    // Held again at once: the read still stands.
    held.retain();
    expect(reads).toBe(1);
  });

  it('reads again once the copy is old', async () => {
    let clock = 0;
    let reads = 0;
    const store = createRegionStore({
      now: () => clock,
      read: () => {
        reads += 1;
        return Promise.resolve(settings());
      },
    });
    const held = store.of('acme');
    held.retain();
    await Promise.resolve();
    await Promise.resolve();
    clock = REGION_FRESH_MS + 1;
    held.retain();
    expect(reads).toBe(2);
  });

  it('puts a saved region in place, and an older read never covers it', async () => {
    let answer: (value: ReturnType<typeof settings>) => void = () => undefined;
    const store = createRegionStore({
      read: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const held = store.of('acme');
    held.retain();
    store.set('acme', { currency: 'EUR' });
    answer(settings({ currency: 'USD' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(held.getSnapshot()).toEqual({ currency: 'EUR' });
  });

  it('keeps each workspace apart and forgets one that moved', () => {
    const store = createRegionStore({ read: () => Promise.resolve(settings()) });
    store.set('acme', { currency: 'EUR' });
    expect(store.of('other').getSnapshot()).toBeUndefined();
    store.drop('acme');
    expect(store.of('acme').getSnapshot()).toBeUndefined();
  });
});
