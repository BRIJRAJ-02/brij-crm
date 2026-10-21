// watchFontsSettled against a stand in FontFaceSet: a font batch finishing calls back, so a list measures its rows
// again; fonts still loading at the start call back once they are in; stopping stops it.
import { describe, expect, it } from 'vitest';
import { watchFontsSettled, type FontEvents } from './fonts-settled.ts';

/** A stand in FontFaceSet: its status, its ready promise (settled by hand) and its loadingdone listeners. */
function fakeFonts(status: 'loading' | 'loaded') {
  const listeners = new Set<() => void>();
  let settle = () => undefined as unknown;
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const fonts: FontEvents = {
    status,
    ready,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  const loadingDone = () => {
    for (const listener of listeners) listener();
  };
  return { fonts, listeners, loadingDone, settle: () => settle() };
}

describe('watchFontsSettled', () => {
  it('calls back each time a batch of fonts finishes loading', () => {
    const { fonts, loadingDone } = fakeFonts('loaded');
    let calls = 0;
    watchFontsSettled(fonts, () => {
      calls += 1;
    });
    loadingDone();
    loadingDone();
    expect(calls).toBe(2);
  });

  it('calls back once the fonts loading at the start are in', async () => {
    const { fonts, settle } = fakeFonts('loading');
    let calls = 0;
    watchFontsSettled(fonts, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    settle();
    await fonts.ready;
    expect(calls).toBe(1);
  });

  it('never calls back when the fonts were in before, nothing loads, and after it stops', async () => {
    const loaded = fakeFonts('loaded');
    let calls = 0;
    watchFontsSettled(loaded.fonts, () => {
      calls += 1;
    });
    loaded.settle();
    await loaded.fonts.ready;
    expect(calls).toBe(0);

    const loading = fakeFonts('loading');
    const stop = watchFontsSettled(loading.fonts, () => {
      calls += 1;
    });
    stop();
    loading.loadingDone();
    loading.settle();
    await loading.fonts.ready;
    expect(calls).toBe(0);
    expect(loading.listeners.size).toBe(0);
  });
});
