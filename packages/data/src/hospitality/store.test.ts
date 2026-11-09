// The Hospitality store (spec 0065, H0) against a fake API answered by hand: a change shows at once, the server's
// answer replaces it, a refusal puts it back and comes back to the screen, and an install tells the sidebar.
import type { AppsView, PlaceFloor, PlaceQrCodes } from '@crm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { openHospitality, type HospitalityProcedures } from './store.ts';

const PLACE = '01900000-0000-7000-8000-000000000001';
const table = (id: string, label: string, position: number) => ({
  id,
  kind: 'table' as const,
  label,
  minCapacity: 2,
  maxCapacity: 4,
  online: true,
  joins: [],
  position,
  archived: false,
});
const FLOOR: PlaceFloor = {
  placeId: PLACE,
  areas: [],
  resources: [table('a', 'T1', 0), table('b', 'T2', 1), table('c', 'T3', 2)],
};
const APPS: AppsView = {
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
    const { store } = setUp({ resources: () => Promise.resolve(FLOOR), moveResource: () => answer.promise });
    await store.listResources('acme', PLACE);
    const moving = store.moveResource('acme', PLACE, 'c', 0);
    const shown = store.floor('acme', PLACE).getSnapshot();
    expect(shown.status === 'ready' && shown.value.resources.map((each) => each.label)).toEqual(['T3', 'T1', 'T2']);
    answer.reject(Object.assign(new Error('Nope.'), { code: 'NOT_FOUND' }));
    expect(await moving).toBeDefined();
    const back = store.floor('acme', PLACE).getSnapshot();
    expect(back.status === 'ready' && back.value.resources.map((each) => each.label)).toEqual(['T1', 'T2', 'T3']);
  });

  it('reads the Tables copy once more when a floor write lands while a read of it is out', async () => {
    const reads: ReturnType<typeof deferred<PlaceQrCodes>>[] = [];
    const codes = (labels: readonly string[]): PlaceQrCodes => ({
      placeId: PLACE,
      placeName: 'Soho',
      menuKey: 'AbCdEfGhIjKlMnOp',
      menuState: 'live',
      tables: labels.map((label, index) => ({ id: `t${String(index)}`, label, code: `c${String(index)}`, scans: 0 })),
    });
    const { store } = setUp({
      resources: () => Promise.resolve(FLOOR),
      qrCodes: () => {
        const read = deferred<PlaceQrCodes>();
        reads.push(read);
        return read.promise;
      },
      saveArea: () => Promise.resolve(FLOOR),
      addResources: () => Promise.resolve(FLOOR),
    });
    await store.listResources('acme', PLACE);
    const first = store.readQrCodes('acme', PLACE);
    reads[0]?.resolve(codes(['T1']));
    await first;
    // A new zone's write starts a read; the table's write lands while that read is still out.
    await store.saveArea('acme', PLACE, 'Patio', undefined, 'zone-1');
    expect(reads).toHaveLength(2);
    await store.addResources('acme', PLACE, { kind: 'table', labels: ['T2'], minCapacity: 2, maxCapacity: 4 });
    expect(reads).toHaveLength(2);
    // The read out began before the add: once it lands, one more follows, and that one shows T2.
    reads[1]?.resolve(codes(['T1']));
    await vi.waitFor(() => expect(reads).toHaveLength(3));
    reads[2]?.resolve(codes(['T1', 'T2']));
    await vi.waitFor(() => {
      const shown = store.qrCodes('acme', PLACE).getSnapshot();
      expect(shown.status === 'ready' && shown.value.tables.map((each) => each.label)).toEqual(['T1', 'T2']);
    });
  });

  it('archives a table at once, last in the list', async () => {
    const { store } = setUp({
      resources: () => Promise.resolve(FLOOR),
      archiveResource: () => new Promise(() => undefined),
    });
    await store.listResources('acme', PLACE);
    void store.archiveResource('acme', PLACE, 'a');
    const shown = store.floor('acme', PLACE).getSnapshot();
    expect(shown.status === 'ready' && shown.value.resources.at(-1)).toMatchObject({ id: 'a', archived: true });
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

describe('the held copies', () => {
  it('answers NOT_READY to a change asked before the copy is read, sending nothing', async () => {
    let sent = 0;
    const { store } = setUp({
      moveResource: () => {
        sent += 1;
        return Promise.resolve(FLOOR);
      },
    });
    expect((await store.moveResource('acme', PLACE, 'a', 1))?.code).toBe('NOT_READY');
    expect(sent).toBe(0);
  });

  it('reads the copy again once the queue drains after a refusal that was not the latest', async () => {
    let reads = 0;
    const first = deferred<PlaceFloor>();
    const { store } = setUp({
      resources: () => {
        reads += 1;
        return Promise.resolve(FLOOR);
      },
      moveResource: () => first.promise,
      archiveResource: () => Promise.resolve(FLOOR),
    });
    await store.listResources('acme', PLACE);
    const moving = store.moveResource('acme', PLACE, 'c', 0);
    const archiving = store.archiveResource('acme', PLACE, 'a');
    first.reject(Object.assign(new Error('Nope.'), { code: 'NOT_FOUND' }));
    expect(await moving).toBeDefined();
    expect(await archiving).toBeUndefined();
    await Promise.resolve();
    expect(reads).toBe(2);
  });
});

describe('businesses (spec 0065 H7)', () => {
  const FIRST = '0192f0c8-0000-7000-8000-00000000b001';
  const SECOND = '0192f0c8-0000-7000-8000-00000000b002';
  const listed = (count: number) => ({
    canManage: true,
    properties: [
      { id: FIRST, name: 'One', position: 0, holds: 1 },
      ...(count > 1 ? [{ id: SECOND, name: 'Two', position: 1, holds: 0 }] : []),
    ],
  });
  const view = { canEdit: true, places: [] };

  it('names no business with one, reads the chosen one with two, and keeps the choice on the device', async () => {
    const asked: (string | undefined)[] = [];
    const kept = new Map<string, string>();
    let count = 1;
    const api = new Proxy({} as HospitalityProcedures, {
      get: (_target, name: string) => {
        if (name === 'properties') return () => Promise.resolve(listed(count));
        if (name === 'business')
          return (input: { property?: string }) => {
            asked.push(input.property);
            return Promise.resolve(view);
          };
        return () => Promise.reject(new Error('Not used here.'));
      },
    });
    const store = openHospitality({
      api,
      call: (run) => run({}),
      mintId: () => 'id',
      choices: { get: (key) => kept.get(key) ?? null, set: (key, id) => kept.set(key, id) },
    });
    await store.readProperties('acme');
    store.choose('acme', SECOND);
    // One business: nothing to choose, so the first is read, named by nothing.
    await store.readBusiness('acme');
    expect(asked).toEqual([undefined]);
    count = 2;
    store.properties('acme').retry();
    await store.readProperties('acme');
    const choice = store.choice('acme').getSnapshot();
    expect(choice.status === 'ready' && choice.value).toBe(SECOND);
    await store.readBusiness('acme');
    expect(asked).toEqual([undefined, SECOND]);
    expect(kept.get('crm.business.acme')).toBe(SECOND);
    // The first again is no name at all, so its copy is the one the first read made.
    store.choose('acme', FIRST);
    const first = store.choice('acme').getSnapshot();
    expect(first.status === 'ready' && first.value).toBeUndefined();
  });

  it('keeps a removed business out of the choice', async () => {
    const kept = new Map<string, string>([['crm.business.acme', SECOND]]);
    const api = new Proxy({} as HospitalityProcedures, {
      get: (_target, name: string) =>
        name === 'properties' ? () => Promise.resolve(listed(1)) : () => Promise.reject(new Error('Not used here.')),
    });
    const store = openHospitality({
      api,
      call: (run) => run({}),
      mintId: () => 'id',
      choices: { get: (key) => kept.get(key) ?? null, set: (key, id) => kept.set(key, id) },
    });
    await store.readProperties('acme');
    const choice = store.choice('acme').getSnapshot();
    expect(choice.status === 'ready' && choice.value).toBeUndefined();
  });

  it('asks nothing more once signed out, while the switcher still shows on the way to sign in', async () => {
    let reads = 0;
    const late = deferred<ReturnType<typeof listed>>();
    const api = new Proxy({} as HospitalityProcedures, {
      get: (_target, name: string) =>
        name === 'properties'
          ? () => {
              reads += 1;
              return reads === 1 ? Promise.resolve(listed(2)) : late.promise;
            }
          : () => Promise.reject(new Error('Not used here.')),
    });
    const store = openHospitality({ api, call: (run) => run({}), mintId: () => 'id' });
    const shown = store.properties('acme');
    shown.retain();
    store.choice('acme').retain();
    await store.readProperties('acme');
    // A read still out when the session ends (a `nav` event's) never lands in the copy after it.
    store.propertiesChanged('acme');
    expect(reads).toBe(2);
    const heard = vi.fn();
    shown.subscribe(heard);
    store.clear();
    expect(heard).toHaveBeenCalled();
    expect(shown.getSnapshot().status).toBe('loading');
    // The sidebar renders again as sign out navigates: the same copy, so nothing is held anew and nothing asked.
    expect(store.properties('acme')).toBe(shown);
    store.choice('acme').getSnapshot();
    late.resolve(listed(2));
    await late.promise;
    await Promise.resolve();
    expect(shown.getSnapshot().status).toBe('loading');
    expect(reads).toBe(2);
    // The next sign in's screens hold it anew, and it reads.
    shown.retain();
    expect(reads).toBe(3);
  });
});
