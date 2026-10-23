// Settings' back link (spec 0026, AC-681): the page Settings was opened from,
// in the same workspace, else the workspace's home.
import { describe, expect, it } from 'vitest';
import { backHref, isSettingsPath, rememberPlace, SETTINGS_BACK_KEY, type BackStorage } from './back.ts';

/** A Map behind the two Storage calls the back link uses. */
function memoryStorage(): BackStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** A store that throws, as a blocked one does. */
const blocked: BackStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('isSettingsPath', () => {
  it('is any address inside a workspace’s Settings', () => {
    expect(isSettingsPath('/w/acme/settings')).toBe(true);
    expect(isSettingsPath('/w/acme/settings/account/preferences')).toBe(true);
    expect(isSettingsPath('/w/acme/settingsx')).toBe(false);
    expect(isSettingsPath('/w/acme/objects/people')).toBe(false);
  });
});

describe('the back link', () => {
  it('returns to the last workspace page reached outside Settings, with its search', () => {
    const storage = memoryStorage();
    rememberPlace(storage, '/w/acme/objects/people?view=abc');
    rememberPlace(storage, '/w/acme/settings/jobs');
    expect(backHref(storage, 'acme')).toBe('/w/acme/objects/people?view=abc');
  });

  it('remembers nothing outside a workspace', () => {
    const storage = memoryStorage();
    rememberPlace(storage, '/sign-in?redirect=%2Fw%2Facme');
    expect(storage.values.has(SETTINGS_BACK_KEY)).toBe(false);
  });

  it('goes to the workspace’s home with nothing remembered, or a page of another workspace', () => {
    const storage = memoryStorage();
    expect(backHref(storage, 'acme')).toBe('/w/acme');
    rememberPlace(storage, '/w/globex/tasks');
    expect(backHref(storage, 'acme')).toBe('/w/acme');
    expect(backHref(undefined, 'acme')).toBe('/w/acme');
  });

  it('never remembers the trash, which sits in Settings (A120), with or without its object filter', () => {
    const storage = memoryStorage();
    rememberPlace(storage, '/w/acme/objects/people');
    rememberPlace(storage, '/w/acme/settings/trash');
    rememberPlace(storage, '/w/acme/settings/trash?object=abc');
    expect(isSettingsPath('/w/acme/settings/trash')).toBe(true);
    expect(backHref(storage, 'acme')).toBe('/w/acme/objects/people');
  });

  it('never remembers or returns to the trash’s old address, which redirects into Settings', () => {
    const storage = memoryStorage();
    rememberPlace(storage, '/w/acme/objects/people');
    rememberPlace(storage, '/w/acme/trash');
    rememberPlace(storage, '/w/acme/trash?object=abc');
    expect(backHref(storage, 'acme')).toBe('/w/acme/objects/people');
    // A value saved before the move, still in this tab's storage.
    storage.setItem(SETTINGS_BACK_KEY, '/w/acme/trash?object=abc');
    expect(backHref(storage, 'acme')).toBe('/w/acme');
    // A record page is not the trash.
    storage.setItem(SETTINGS_BACK_KEY, '/w/acme/trashcan');
    expect(backHref(storage, 'acme')).toBe('/w/acme/trashcan');
  });

  it('never returns into Settings, even from a value written by hand', () => {
    const storage = memoryStorage();
    storage.setItem(SETTINGS_BACK_KEY, '/w/acme/settings/objects');
    expect(backHref(storage, 'acme')).toBe('/w/acme');
  });

  it('goes home when storage is blocked, without throwing', () => {
    expect(() => {
      rememberPlace(blocked, '/w/acme/tasks');
    }).not.toThrow();
    expect(backHref(blocked, 'acme')).toBe('/w/acme');
  });
});
