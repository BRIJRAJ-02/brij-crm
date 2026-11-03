// The Hospitality store (spec 0065, H0) against a fake API answered by hand: a change shows at once, the server's
// answer replaces it, a refusal puts it back and comes back to the screen, and an install tells the sidebar.
import type { AppsView, PlaceFloor } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { openHospitality, type HospitalityProcedures } from './store.ts';

const PLACE = '01900000-0000-7000-8000-000000000001';
const table = (id: string, label: string, position: number) => ({
  id,
  label,
  minGuests: 2,
  maxGuests: 4,
  online: true,
  joins: [],
  position,
  archived: false,
});
const FLOOR: PlaceFloor = {
  placeId: PLACE,
  areas: [],
  tables: [table('a', 'T1', 0), table('b', 'T2', 1), table('c', 'T3', 2)],
};
const APPS: AppsView = {
  available: true,
  canManage: true,
  hasBusiness: true,
  apps: [
    { app: 'menu', installed: false },
    { app: 'menu_qr', installed: false },
    { app: 'table_seating', installed: false },
  ],
};

/** A promise and its settle functions, for answering a call by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setUp(overrides: Partial<HospitalityProcedures>) {
  const notUsed = () => Promise.reject(new Error('Not used here.'));
  const api = new Proxy({} as HospitalityProcedures, {
    get: (_target, name: string) => (overrides as Record<string, unknown>)[name] ?? notUsed,
  });
  const changed: string[] = [];
  let id = 0;
  const store = openHospitality({
    api,
    call: (run) => run({}),
    mintId: () => `id-${String((id += 1))}`,
    onAppsChanged: (workspace) => changed.push(workspace),
  });
  return { store, changed };
}

describe('the floor', () => {
  it('moves a table at once, takes the server’s floor, and puts it back when refused', async () => {
    const answer = deferred<PlaceFloor>();
    const { store } = setUp({ floor: () => Promise.resolve(FLOOR), moveTable: () => answer.promise });
    await store.readFloor('acme', PLACE);
    const moving = store.moveTable('acme', PLACE, 'c', 0);
    const shown = store.floor('acme', PLACE).getSnapshot();
    expect(shown.status === 'ready' && shown.value.tables.map((each) => each.label)).toEqual(['T3', 'T1', 'T2']);
    answer.reject(Object.assign(new Error('Nope.'), { code: 'NOT_FOUND' }));
    expect(await moving).toBeDefined();
    const back = store.floor('acme', PLACE).getSnapshot();
    expect(back.status === 'ready' && back.value.tables.map((each) => each.label)).toEqual(['T1', 'T2', 'T3']);
  });

  it('archives a table at once, last in the list', async () => {
    const { store } = setUp({
      floor: () => Promise.resolve(FLOOR),
      archiveTable: () => new Promise(() => undefined),
    });
    await store.readFloor('acme', PLACE);
    void store.archiveTable('acme', PLACE, 'a');
    const shown = store.floor('acme', PLACE).getSnapshot();
    expect(shown.status === 'ready' && shown.value.tables.at(-1)).toMatchObject({ id: 'a', archived: true });
  });
});

describe('the apps', () => {
  it('shows an install at once and tells the sidebar once it landed', async () => {
    const { store, changed } = setUp({
      apps: () => Promise.resolve(APPS),
      install: () =>
        Promise.resolve({
          ...APPS,
          apps: APPS.apps.map((each) => (each.app === 'menu' ? { ...each, installed: true } : each)),
        }),
    });
    await store.readApps('acme');
    const installing = store.install('acme', 'menu');
    const shown = store.apps('acme').getSnapshot();
    expect(shown.status === 'ready' && shown.value.apps[0]?.installed).toBe(true);
    expect(await installing).toBeUndefined();
    expect(changed).toEqual(['acme']);
  });

  it('answers APP_NEEDED for the screen to ask, the apps as they were and the sidebar untouched', async () => {
    const { store, changed } = setUp({
      apps: () => Promise.resolve(APPS),
      install: () => Promise.reject(Object.assign(new Error('Menu QR needs Menu.'), { code: 'APP_NEEDED' })),
    });
    await store.readApps('acme');
    const refused = await store.install('acme', 'menu_qr');
    expect(refused).toBeDefined();
    const shown = store.apps('acme').getSnapshot();
    expect(shown.status === 'ready' && shown.value.apps.every((each) => !each.installed)).toBe(true);
    expect(changed).toEqual([]);
  });
});
