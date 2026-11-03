// Table seating's store (spec 0066 B7 lite) against a fake API answered by hand: a status move shows at once (Seated
// starts the clock, the covers count again), a refusal puts the row back and comes back to the screen, and a `visits`
// event reads the held days of that place again.
import type { ServiceDayView, VisitStatus } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import { openTables, withStatus, type TablesProcedures } from './store.ts';

const PLACE = '01900000-0000-7000-8000-000000000001';
const VISIT = '01900000-0000-7000-8000-0000000000aa';
const DAY: ServiceDayView = {
  date: '2026-11-09',
  zone: 'Europe/London',
  visits: [
    {
      id: VISIT,
      start: '2026-11-09T18:00:00.000Z',
      end: '2026-11-09T19:30:00.000Z',
      name: 'Grace Hopper',
      party: 2,
      status: 'booked',
      resourceIds: [],
      lookupCode: 'ABCDEFGH',
      source: 'online',
    },
  ],
  covers: { booked: 2, seated: 0, toCome: 2 },
  truncated: false,
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

function setUp(overrides: Partial<TablesProcedures>) {
  const notUsed = () => Promise.reject(new Error('Not used here.'));
  const api = new Proxy({} as TablesProcedures, {
    get: (_target, name: string) => (overrides as Record<string, unknown>)[name] ?? notUsed,
  });
  let id = 0;
  return openTables({
    api,
    call: (run) => run({}),
    mintId: () => {
      id += 1;
      return `m${String(id)}`;
    },
    now: () => Date.parse('2026-11-09T18:05:00.000Z'),
    isLive: () => true,
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the Service day', () => {
  it('seats at once with the clock started, and keeps it once the server agrees', async () => {
    const answer = deferred<{ id: string; status: VisitStatus }>();
    const store = setUp({ day: () => Promise.resolve(DAY), setStatus: () => answer.promise });
    const day = store.day('acme', PLACE, DAY.date);
    const release = day.retain();
    await flush();
    const moving = store.setStatus('acme', PLACE, DAY.date, VISIT, 'started');
    const shown = day.getSnapshot();
    expect(shown.status === 'ready' && shown.value.visits[0]).toMatchObject({
      status: 'started',
      seatedAt: '2026-11-09T18:05:00.000Z',
    });
    expect(shown.status === 'ready' && shown.value.covers).toEqual({ booked: 2, seated: 2, toCome: 0 });
    answer.resolve({ id: VISIT, status: 'started' });
    expect(await moving).toBeUndefined();
    const after = day.getSnapshot();
    expect(after.status === 'ready' && after.value.visits[0]?.status).toBe('started');
    release();
  });

  it('puts the row back when the move is refused, and says why', async () => {
    const store = setUp({
      day: () => Promise.resolve(withStatus(DAY, VISIT, 'no_show', '')),
      setStatus: () => Promise.reject(dataError('SLOT_TAKEN', 'That table was given to someone else meanwhile.')),
    });
    const day = store.day('acme', PLACE, DAY.date);
    const release = day.retain();
    await flush();
    const refused = await store.setStatus('acme', PLACE, DAY.date, VISIT, 'booked');
    expect(refused?.code).toBe('SLOT_TAKEN');
    const shown = day.getSnapshot();
    expect(shown.status === 'ready' && shown.value.visits[0]?.status).toBe('no_show');
    release();
  });

  it('reads the held days of a place again on a visits event, and no other place’s', async () => {
    let reads = 0;
    const store = setUp({
      day: () => {
        reads += 1;
        return Promise.resolve(DAY);
      },
    });
    const release = store.day('acme', PLACE, DAY.date).retain();
    await flush();
    expect(reads).toBe(1);
    store.placesChanged('acme', ['01900000-0000-7000-8000-0000000000ff']);
    store.placesChanged('other', [PLACE]);
    await flush();
    expect(reads).toBe(1);
    store.placesChanged('acme', [PLACE]);
    await flush();
    expect(reads).toBe(2);
    release();
  });
});
