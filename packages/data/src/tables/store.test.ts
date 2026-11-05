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

  it('hands a screen the same held day for the same day, so a render never lets go and reads again', async () => {
    let reads = 0;
    const store = setUp({
      day: () => {
        reads += 1;
        return Promise.resolve(DAY);
      },
    });
    const day = store.day('acme', PLACE, DAY.date);
    expect(store.day('acme', PLACE, DAY.date)).toBe(day);
    const release = day.retain();
    await flush();
    expect(reads).toBe(1);
    release();
  });

  it('reads the shown days of a place again on a visits event, and no other place’s', async () => {
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

describe('walk ins and new reservation emails (spec 0066 B7 lite)', () => {
  it('seats a walk in, then reads the held day again; a refusal changes nothing and comes back', async () => {
    let reads = 0;
    let seated = false;
    const store = setUp({
      day: () => {
        reads += 1;
        return Promise.resolve(DAY);
      },
      walkIn: (input) => {
        if (seated) return Promise.reject(dataError('SLOT_TAKEN', 'That table was just taken. Pick another.'));
        seated = true;
        expect(input).toMatchObject({ party: 3, resourceIds: ['t1'], name: 'Ada' });
        return Promise.resolve({ id: VISIT, status: 'started' as const });
      },
    });
    const release = store.day('ws', PLACE, DAY.date).retain();
    await flush();
    const before = reads;
    expect(await store.walkIn('ws', PLACE, DAY.date, { party: 3, resourceIds: ['t1'], name: ' Ada ' })).toBeUndefined();
    expect(reads).toBe(before + 1);
    const refused = await store.walkIn('ws', PLACE, DAY.date, { party: 3, resourceIds: ['t1'] });
    expect(refused?.code).toBe('SLOT_TAKEN');
    expect(reads).toBe(before + 1);
    release();
  });

  it('takes a reservation with blanks left out, then reads the held day again; a refusal comes back', async () => {
    let reads = 0;
    let booked = false;
    const store = setUp({
      day: () => {
        reads += 1;
        return Promise.resolve(DAY);
      },
      book: (input) => {
        if (booked) return Promise.reject(dataError('SLOT_TAKEN', 'That time was just taken. Pick another.'));
        booked = true;
        expect(input).toMatchObject({ party: 4, name: 'Ada', phone: '07700 900123', resourceIds: ['t1'] });
        expect(input).not.toHaveProperty('email');
        return Promise.resolve({ id: VISIT, status: 'booked' as const });
      },
    });
    const release = store.day('ws', PLACE, DAY.date).retain();
    await flush();
    const before = reads;
    const booking = {
      start: '2026-11-05T19:00:00.000Z',
      party: 4,
      name: ' Ada ',
      phone: '07700 900123',
      email: ' ',
      resourceIds: ['t1'],
    };
    expect(await store.book('ws', PLACE, DAY.date, booking)).toBeUndefined();
    expect(reads).toBe(before + 1);
    expect((await store.book('ws', PLACE, DAY.date, booking))?.code).toBe('SLOT_TAKEN');
    expect(reads).toBe(before + 1);
    release();
  });

  it('shows the new reservation email switch at once, and puts it back when refused', async () => {
    const setup = {
      placeId: PLACE,
      rules: {
        minutes: 90,
        holds: [],
        partyMin: 1,
        partyMax: 8,
        stepMinutes: 15,
        noticeMinutes: 120,
        windowDays: 60,
        changeCutoffMinutes: 120,
        cancelCutoffMinutes: 120,
        online: true,
      },
      saved: true,
      steps: [],
      ready: true,
      publicKey: 'AAAAAAAAAAAAAAAA',
      notifyMe: true,
    };
    const answer = deferred<{ placeId: string; notifyMe: boolean }>();
    const store = setUp({ setup: () => Promise.resolve(setup), setNotify: () => answer.promise });
    const held = store.setup('ws', PLACE);
    held.retain();
    await flush();
    const sent = store.setNotify('ws', PLACE, false);
    const now = held.getSnapshot();
    expect(now.status === 'ready' && now.value.notifyMe).toBe(false);
    answer.reject(dataError('FORBIDDEN', 'You can’t run service here.'));
    expect((await sent)?.code).toBe('FORBIDDEN');
    const after = held.getSnapshot();
    expect(after.status === 'ready' && after.value.notifyMe).toBe(true);
  });
});
