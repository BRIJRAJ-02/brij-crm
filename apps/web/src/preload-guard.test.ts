// The preload error guard (31 Oct 2026): a clean page reloads once and never loops, a page with unsaved work gets the
// toast and no reload, and storage that throws neither crashes it nor lets it reload without a stamp.
import { describe, expect, it, vi } from 'vitest';
import {
  blocksUnload,
  guardPreloadErrors,
  handlePreloadError,
  PRELOAD_RELOAD_KEY,
  PRELOAD_RELOAD_WINDOW_MS,
  type PreloadGuardDeps,
  type PreloadStorage,
} from './preload-guard.ts';

const memory = (): PreloadStorage & { readonly items: Map<string, string> } => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

const preloadError = () => new Event('vite:preloadError', { cancelable: true });

const deps = (over: Partial<PreloadGuardDeps> = {}): PreloadGuardDeps => {
  const storage = memory();
  return {
    target: new EventTarget(),
    storage: () => storage,
    now: () => 1_000_000,
    reload: vi.fn(),
    isDirty: () => false,
    offerReload: vi.fn(),
    ...over,
  };
};

describe('handlePreloadError', () => {
  it('reloads a clean page once, stamped, and cancels the error', () => {
    const storage = memory();
    const page = deps({ storage: () => storage });
    const event = preloadError();
    expect(handlePreloadError(event, page)).toBe('reloaded');
    expect(event.defaultPrevented).toBe(true);
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(storage.items.get(PRELOAD_RELOAD_KEY)).toBe('1000000');
  });

  it('never reloads twice inside the window: the second error falls through to the error screen', () => {
    const storage = memory();
    let at = 1_000_000;
    const page = deps({ storage: () => storage, now: () => at });
    handlePreloadError(preloadError(), page);
    at += PRELOAD_RELOAD_WINDOW_MS - 1;
    const again = preloadError();
    expect(handlePreloadError(again, page)).toBe('passed');
    expect(again.defaultPrevented).toBe(false);
    expect(page.reload).toHaveBeenCalledTimes(1);
    // Past the window it is a new deploy swap, and reloads again.
    at += 2;
    expect(handlePreloadError(preloadError(), page)).toBe('reloaded');
    expect(page.reload).toHaveBeenCalledTimes(2);
  });

  it('offers the toast over unsaved work and never reloads', () => {
    const page = deps({ isDirty: () => true });
    const event = preloadError();
    expect(handlePreloadError(event, page)).toBe('offered');
    expect(event.defaultPrevented).toBe(true);
    expect(page.offerReload).toHaveBeenCalledTimes(1);
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('leaves a dirty page with no toasts as it is', () => {
    const page = deps({ isDirty: () => true, offerReload: undefined });
    const event = preloadError();
    expect(handlePreloadError(event, page)).toBe('passed');
    expect(event.defaultPrevented).toBe(false);
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('survives storage that throws: no crash, and no reload it could not stamp', () => {
    const throwing: PreloadStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    for (const storage of [
      () => throwing,
      () => undefined,
      (): PreloadStorage => {
        throw new Error('SecurityError');
      },
    ]) {
      const page = deps({ storage });
      expect(() => handlePreloadError(preloadError(), page)).not.toThrow();
      expect(page.reload).not.toHaveBeenCalled();
      expect(page.offerReload).toHaveBeenCalledTimes(1);
    }
  });
});

describe('guardPreloadErrors', () => {
  it('listens on the page, offers the toast once however many errors come, and stops when removed', () => {
    const target = new EventTarget();
    const page = deps({ target, isDirty: () => true });
    const remove = guardPreloadErrors(page);
    target.dispatchEvent(preloadError());
    target.dispatchEvent(preloadError());
    expect(page.offerReload).toHaveBeenCalledTimes(1);
    remove();
    const late = preloadError();
    target.dispatchEvent(late);
    expect(late.defaultPrevented).toBe(false);
  });
});

describe('blocksUnload', () => {
  it('is true only while a leave guard cancels beforeunload', () => {
    const target = new EventTarget();
    expect(blocksUnload(target)).toBe(false);
    const guard = (event: Event) => {
      event.preventDefault();
    };
    target.addEventListener('beforeunload', guard);
    expect(blocksUnload(target)).toBe(true);
    target.removeEventListener('beforeunload', guard);
    expect(blocksUnload(target)).toBe(false);
  });
});
