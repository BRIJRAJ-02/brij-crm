// The services store (spec 0066 B1) against a fake API answered by hand: a change shows at once and the server's
// answer replaces it; a refusal puts the copy back and comes back to the screen; a week of shifts is one write; a
// `visits` event reads every held copy again.
import type { CatalogueView, PlaceHours, StaffTeamView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import { openServices, withServiceMoved, type ServicesProcedures } from './store.ts';

const PLACE = '01900000-0000-7000-8000-000000000001';
const HAIR = '01900000-0000-7000-8000-0000000000c1';
const [CUT, COLOUR, NAILS] = [
  '01900000-0000-7000-8000-0000000000a1',
  '01900000-0000-7000-8000-0000000000a2',
  '01900000-0000-7000-8000-0000000000a3',
];
const ASHA = '01900000-0000-7000-8000-0000000000b1';

const service = (id: string, name: string, categoryId?: string) => ({
  id,
  name,
  ...(categoryId === undefined ? {} : { categoryId }),
  bufferAfterMin: 0,
  online: true,
  staffRule: 'all' as const,
  staffIds: [],
  placeIds: [PLACE],
  needs: [],
  variants: [],
  archived: false,
});

const CATALOGUE: CatalogueView = {
  categories: [{ id: HAIR, name: 'Hair' }],
  services: [service(CUT, 'Cut', HAIR), service(COLOUR, 'Colour', HAIR), service(NAILS, 'Nails')],
  places: [],
  staff: [],
  resources: [],
  setup: { steps: [] },
};

const TEAM: StaffTeamView = {
  staff: [
    {
      id: ASHA,
      name: 'Asha',
      archived: false,
      places: [{ placeId: PLACE, shifts: { weekly: {}, exceptions: [] }, outsideHours: false }],
      serviceIds: [],
      timeOff: [],
      blocks: [],
      upcoming: 0,
    },
  ],
  places: [],
  services: [],
  categories: [],
  canManage: true,
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setUp(overrides: Partial<ServicesProcedures>) {
  const notUsed = () => Promise.reject(new Error('Not used here.'));
  const api = new Proxy({} as ServicesProcedures, {
    get: (_target, name: string) => (overrides as Record<string, unknown>)[name] ?? notUsed,
  });
  let id = 0;
  return openServices({
    api,
    call: (run) => run({}),
    mintId: () => {
      id += 1;
      return `m${String(id)}`;
    },
    origin: 'https://app.example.com',
    upload: () => Promise.resolve({ photo: 'x' }),
    now: () => 0,
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the catalogue', () => {
  it('moves a service at once inside its category and across', () => {
    expect(withServiceMoved(CATALOGUE, COLOUR, HAIR, 0).services.map((each) => each.name)).toEqual([
      'Colour',
      'Cut',
      'Nails',
    ]);
    const across = withServiceMoved(CATALOGUE, NAILS, HAIR, 1);
    expect(across.services.map((each) => [each.name, each.categoryId])).toEqual([
      ['Cut', HAIR],
      ['Nails', HAIR],
      ['Colour', HAIR],
    ]);
  });

  it('turns a service off at once, and puts it back with the refusal', async () => {
    const answer = deferred<CatalogueView>();
    const store = setUp({ catalogue: () => Promise.resolve(CATALOGUE), setOnline: () => answer.promise });
    store.catalogue('ws').retain();
    await flush();
    const sent = store.setOnline('ws', [CUT], false);
    const shown = store.catalogue('ws').getSnapshot();
    expect(shown.status === 'ready' && shown.value.services[0]?.online).toBe(false);
    answer.reject(dataError('FORBIDDEN', 'Only owners and admins can set up services.'));
    expect(await sent).toMatchObject({ code: 'FORBIDDEN' });
    const back = store.catalogue('ws').getSnapshot();
    expect(back.status === 'ready' && back.value.services[0]?.online).toBe(true);
  });
});

describe('the team', () => {
  it('sends a whole week of shifts in one write, shown at once', async () => {
    const sent: PlaceHours[] = [];
    const week: PlaceHours = {
      weekly: Object.fromEntries(
        (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => [
          day,
          [{ from: '10:00', to: '16:00' }],
        ]),
      ),
      exceptions: [],
    };
    const store = setUp({
      shifts: () => Promise.resolve(TEAM),
      setShifts: (input) => {
        sent.push(input.shifts);
        return Promise.resolve(TEAM);
      },
    });
    store.team('ws', 'shifts').retain();
    await flush();
    const writing = store.setShifts('ws', 'shifts', ASHA, PLACE, week, false);
    const shown = store.team('ws', 'shifts').getSnapshot();
    expect(shown.status === 'ready' && Object.keys(shown.value.staff[0]?.places[0]?.shifts.weekly ?? {})).toHaveLength(
      7,
    );
    expect(await writing).toBeUndefined();
    expect(sent).toEqual([week]);
  });

  it('reads every held copy again on a visits event', async () => {
    let reads = 0;
    const store = setUp({
      catalogue: () => Promise.resolve(CATALOGUE),
      team: () => {
        reads += 1;
        return Promise.resolve(TEAM);
      },
    });
    store.team('ws').retain();
    await flush();
    store.placesChanged('ws');
    await flush();
    expect(reads).toBe(2);
  });
});
