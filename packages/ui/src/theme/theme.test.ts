// AC-7: a saved Light or Dark choice applies and survives, follows other
// tabs, and blocked or odd storage falls back to System without throwing.
import { describe, expect, it, vi } from 'vitest';
import {
  createThemeController,
  parseThemeChoice,
  safeLocalStorage,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from './theme.ts';

function fakeStorage(initial: Record<string, string> = {}): ThemeStorage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function blockedStorage(): ThemeStorage {
  const blocked = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return { getItem: blocked, setItem: blocked, removeItem: blocked };
}

function fakeRoot() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
    },
  };
}

/** A stand in for the window's storage event, so a test can play another tab. */
function fakeTabs() {
  let handler: ((key: string | null, value: string | null) => void) | undefined;
  const unsubscribe = vi.fn();
  return {
    unsubscribe,
    onStorage: (next: (key: string | null, value: string | null) => void) => {
      handler = next;
      return unsubscribe;
    },
    otherTabWrites: (key: string | null, value: string | null) => handler?.(key, value),
  };
}

function setup(storage: ThemeStorage | undefined = fakeStorage()) {
  const root = fakeRoot();
  const tabs = fakeTabs();
  const controller = createThemeController({ storage, root, onStorage: tabs.onStorage });
  return { controller, root, tabs };
}

describe('parseThemeChoice', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    [null, 'system'],
    ['purple', 'system'],
    ['Dark', 'system'],
    [42, 'system'],
  ])('reads %j as %s', (value, choice) => {
    expect(parseThemeChoice(value)).toBe(choice);
  });
});

describe('createThemeController', () => {
  it('follows the OS when nothing is saved: no data-theme at all', () => {
    const { controller, root } = setup();
    expect(controller.get()).toBe('system');
    expect(root.attributes.has('data-theme')).toBe(false);
  });

  it('applies a saved choice as soon as it is created', () => {
    const { controller, root } = setup(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }));
    expect(controller.get()).toBe('dark');
    expect(root.attributes.get('data-theme')).toBe('dark');
  });

  it('saves a Light or Dark choice and sets data-theme', () => {
    const storage = fakeStorage();
    const { controller, root } = setup(storage);
    controller.set('dark');
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(root.attributes.get('data-theme')).toBe('dark');
    controller.set('light');
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('light');
    expect(root.attributes.get('data-theme')).toBe('light');
  });

  it('clears both the key and the attribute for System', () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: 'dark' });
    const { controller, root } = setup(storage);
    controller.set('system');
    expect(storage.data.has(THEME_STORAGE_KEY)).toBe(false);
    expect(root.attributes.has('data-theme')).toBe(false);
  });

  it('treats anything else in storage as System', () => {
    const { controller, root } = setup(fakeStorage({ [THEME_STORAGE_KEY]: 'purple' }));
    expect(controller.get()).toBe('system');
    expect(root.attributes.has('data-theme')).toBe(false);
  });

  it('still applies the choice to this page when storage is blocked, and never throws', () => {
    const { controller, root } = setup(blockedStorage());
    expect(controller.get()).toBe('system');
    expect(() => controller.set('dark')).not.toThrow();
    expect(controller.get()).toBe('dark');
    expect(root.attributes.get('data-theme')).toBe('dark');
  });

  it('works with no storage at all', () => {
    const { controller, root } = setup(undefined);
    controller.set('light');
    expect(root.attributes.get('data-theme')).toBe('light');
  });

  it('follows a choice made in another tab and tells subscribers', () => {
    const { controller, root, tabs } = setup();
    const listener = vi.fn();
    controller.subscribe(listener);
    tabs.otherTabWrites(THEME_STORAGE_KEY, 'dark');
    expect(controller.get()).toBe('dark');
    expect(root.attributes.get('data-theme')).toBe('dark');
    expect(listener).toHaveBeenCalledWith('dark');
    tabs.otherTabWrites(THEME_STORAGE_KEY, null);
    expect(controller.get()).toBe('system');
    expect(root.attributes.has('data-theme')).toBe(false);
  });

  it('goes back to System when another tab clears all of storage', () => {
    const { controller, tabs } = setup(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }));
    tabs.otherTabWrites(null, null);
    expect(controller.get()).toBe('system');
  });

  it('ignores other keys changing in other tabs', () => {
    const { controller, tabs } = setup(fakeStorage({ [THEME_STORAGE_KEY]: 'dark' }));
    tabs.otherTabWrites('something.else', 'light');
    expect(controller.get()).toBe('dark');
  });

  it('notifies once per real change, and not after unsubscribing', () => {
    const { controller } = setup();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.set('dark');
    controller.set('dark');
    unsubscribe();
    controller.set('light');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops listening to other tabs on dispose', () => {
    const { controller, tabs } = setup();
    controller.dispose();
    expect(tabs.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('safeLocalStorage', () => {
  it('returns the storage when it can be read', () => {
    const storage = fakeStorage() as unknown as Storage;
    expect(safeLocalStorage({ localStorage: storage })).toBe(storage);
  });

  it('returns undefined when reading localStorage throws', () => {
    const win = {
      get localStorage(): Storage {
        throw new DOMException('Blocked', 'SecurityError');
      },
    };
    expect(safeLocalStorage(win)).toBeUndefined();
  });
});
