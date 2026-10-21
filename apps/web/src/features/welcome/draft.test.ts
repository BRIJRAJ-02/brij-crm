// What first run has typed, kept in this tab (spec 0036, AC-1210): read back
// for the same person only, with the workspace's id, and forgotten on demand;
// storage that throws never breaks the steps.
import { describe, expect, it } from 'vitest';
import { clearDraft, readDraft, saveDraft } from './draft.ts';

/** A Storage held in a Map, as sessionStorage behaves. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** A Storage whose every call throws, as a blocked one can. */
const blocked = new Proxy({} as Storage, {
  get: () => () => {
    throw new Error('The operation is insecure.');
  },
});

const ID = '0199a6f2-0000-7000-8000-00000000000a';
const ADA = '0199a6f2-0000-7000-8000-000000000001';

describe('first run’s draft', () => {
  it('reads back what was typed, with the workspace id, for the same person', () => {
    const storage = memoryStorage();
    saveDraft(storage, { userId: ADA, workspaceId: ID, memberName: 'Ada', workspaceName: 'Acme', slug: 'acme' });
    expect(readDraft(storage, ADA)).toEqual({
      userId: ADA,
      workspaceId: ID,
      memberName: 'Ada',
      workspaceName: 'Acme',
      slug: 'acme',
    });
  });

  it('is nobody else’s: another person in the same tab starts afresh', () => {
    const storage = memoryStorage();
    saveDraft(storage, { userId: ADA, workspaceId: ID, memberName: 'Ada' });
    expect(readDraft(storage, '0199a6f2-0000-7000-8000-000000000002')).toBeUndefined();
  });

  it('refuses a draft it can’t trust: not JSON, a workspace id that isn’t a UUID v7, values that aren’t text', () => {
    const storage = memoryStorage();
    storage.setItem('crm.welcome.draft', '{');
    expect(readDraft(storage, ADA)).toBeUndefined();
    storage.setItem('crm.welcome.draft', JSON.stringify({ userId: ADA, workspaceId: 'not-an-id' }));
    expect(readDraft(storage, ADA)).toBeUndefined();
    storage.setItem('crm.welcome.draft', JSON.stringify({ userId: ADA, workspaceId: ID, memberName: 7 }));
    expect(readDraft(storage, ADA)).toEqual({ userId: ADA, workspaceId: ID });
  });

  it('is forgotten once the workspace is made', () => {
    const storage = memoryStorage();
    saveDraft(storage, { userId: ADA, workspaceId: ID });
    clearDraft(storage);
    expect(readDraft(storage, ADA)).toBeUndefined();
  });

  it('never throws when storage does, or is missing', () => {
    expect(() => {
      saveDraft(blocked, { userId: ADA, workspaceId: ID });
      clearDraft(blocked);
    }).not.toThrow();
    expect(readDraft(blocked, ADA)).toBeUndefined();
    expect(readDraft(undefined, ADA)).toBeUndefined();
  });
});
