// The calendar store against a fake API answered by hand (spec 0024,
// Settings › Calendar): the list read when held, a sharing change and a new
// default shown at once and put back with a toast when refused, a disconnect
// gone at once, and a syncing connection read again until it is done, only
// while a screen holds the list and never past the poll's limit.
import type { CalendarConnections, CalendarConnectionView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import type { Notice } from '../notice.ts';
import {
  connectUrl,
  createCalendarStore,
  needsReconnect,
  SYNC_POLL_FOR_MS,
  SYNC_POLL_MS,
  type CalendarApi,
} from './store.ts';

const WS = 'acme';
const A = '0199a6f2-0000-7000-8000-0000000000a1';
const B = '0199a6f2-0000-7000-8000-0000000000a2';

const connection = (id: string, changes: Partial<CalendarConnectionView> = {}): CalendarConnectionView => ({
  id,
  provider: 'google',
  accountEmail: `${id.slice(-2)}@acme.dev`,
  status: 'connected',
  sharing: 'shared',
  isDefault: id === A,
  createdAt: '2026-10-19T09:00:00.000Z',
  ...changes,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(lists: CalendarConnections[]) {
  const notices: Notice[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  let reads = 0;
  let clock = 0;
  const sent: unknown[] = [];
  let refuse = false;
  const api: CalendarApi = {
    list: () => {
      const answer = lists[Math.min(reads, lists.length - 1)];
      reads += 1;
      return answer === undefined ? Promise.reject(new Error('none')) : Promise.resolve(answer);
    },
    update: (input) => {
      sent.push(input);
      if (refuse) {
        return Promise.reject(
          Object.assign(new Error('That calendar connection does not exist.'), { code: 'NOT_FOUND' }),
        );
      }
      return Promise.resolve(
        connection(input.connectionId, { ...(input.sharing === undefined ? {} : { sharing: input.sharing }) }),
      );
    },
    remove: (input) => {
      sent.push(input);
      return refuse
        ? Promise.reject(new Error('Refused.'))
        : Promise.resolve({ connectionId: input.connectionId, meetingsRemoved: 2 });
    },
    syncNow: () => Promise.resolve({ queued: true }),
    settings: () => Promise.resolve({ createUnknownPeople: false, canManage: true }),
    updateSettings: (input) => {
      sent.push(input);
      return refuse
        ? Promise.reject(Object.assign(new Error('Only workspace owners and admins can.'), { code: 'FORBIDDEN' }))
        : Promise.resolve({ createUnknownPeople: input.createUnknownPeople, canManage: true });
    },
    addAttendee: (input) => {
      sent.push(input);
      return refuse
        ? Promise.reject(
            Object.assign(new Error('That attendee can’t be added as a person.'), { code: 'CONFIG_INVALID' }),
          )
        : Promise.resolve({ recordId: '0199a6f2-0000-7000-8000-0000000000c1' });
    },
  };
  const store = createCalendarStore({
    api,
    mintId: () => '0199a6f2-0000-7000-8000-0000000000ff',
    notify: (notice) => notices.push(notice),
    setTimeout: (run, ms) => {
      timers.push({ run, ms });
      return timers.length;
    },
    clearTimeout: () => undefined,
    now: () => clock,
  });
  return {
    store,
    notices,
    timers,
    sent,
    reads: () => reads,
    refuse: (value: boolean) => {
      refuse = value;
    },
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const listed = (connections: CalendarConnectionView[]): CalendarConnections => ({
  enabled: true,
  providers: ['google'],
  connections,
  max: 3,
});

describe('the calendar store (spec 0024)', () => {
  it('reads the list when held, and says where to go to connect', async () => {
    const t = setup([listed([connection(A)])]);
    const view = t.store.view(WS);
    expect(view.getSnapshot()).toEqual({ status: 'loading' });
    const release = view.retain();
    await flush();
    expect(view.getSnapshot()).toMatchObject({ status: 'ready', enabled: true, connections: [{ id: A }] });
    release();
    expect(connectUrl('my team')).toBe('/api/calendar/google/start?workspace=my%20team');
    // First run's calendar step asks to come back to it (spec 0036, AC-1217); Settings is the default.
    expect(connectUrl('acme', 'welcome')).toBe('/api/calendar/google/start?workspace=acme&then=welcome');
    expect(connectUrl('acme', 'settings')).toBe('/api/calendar/google/start?workspace=acme');
    expect(connectUrl('acme', 'settings', 'microsoft')).toBe('/api/calendar/microsoft/start?workspace=acme');
  });

  it('shows a sharing change and a new default at once, and puts each back with a toast when refused', async () => {
    const t = setup([listed([connection(A), connection(B)])]);
    const view = t.store.view(WS);
    view.retain();
    await flush();
    const changing = t.store.setSharing(WS, B, 'private');
    expect(view.getSnapshot()).toMatchObject({ connections: [{ sharing: 'shared' }, { sharing: 'private' }] });
    expect(await changing).toBe(true);
    expect(t.sent[0]).toMatchObject({ workspace: WS, connectionId: B, sharing: 'private' });

    t.refuse(true);
    const refused = t.store.makeDefault(WS, B);
    expect(view.getSnapshot()).toMatchObject({ connections: [{ isDefault: false }, { isDefault: true }] });
    expect(await refused).toBe(false);
    expect(view.getSnapshot()).toMatchObject({ connections: [{ isDefault: true }, { isDefault: false }] });
    expect(t.notices).toEqual([{ tone: 'danger', message: expect.any(String) as unknown }]);
  });

  it('takes a disconnected connection off at once, and back when refused', async () => {
    const t = setup([listed([connection(A), connection(B)]), listed([connection(A)])]);
    const view = t.store.view(WS);
    view.retain();
    await flush();
    t.refuse(true);
    const refused = t.store.remove(WS, B);
    expect(view.getSnapshot()).toMatchObject({ connections: [{ id: A }] });
    expect(await refused).toBe(false);
    expect(view.getSnapshot()).toMatchObject({ connections: [{ id: A }, { id: B }] });
    t.refuse(false);
    expect(await t.store.remove(WS, B)).toBe(true);
    await flush();
    expect(view.getSnapshot()).toMatchObject({ connections: [{ id: A }] });
  });

  it('from a confirm, keeps the row until the server answers and throws a refusal with no toast', async () => {
    const t = setup([listed([connection(A), connection(B)]), listed([connection(A)])]);
    const view = t.store.view(WS);
    view.retain();
    await flush();
    t.refuse(true);
    const refused = t.store.remove(WS, B, { asksFirst: true });
    expect(view.getSnapshot()).toMatchObject({ connections: [{ id: A }, { id: B }] });
    await expect(refused).rejects.toMatchObject({ message: expect.any(String) as unknown });
    expect(t.notices).toEqual([]);
    t.refuse(false);
    expect(await t.store.remove(WS, B, { asksFirst: true })).toBe(true);
    await flush();
    expect(view.getSnapshot()).toMatchObject({ connections: [{ id: A }] });
  });

  it('reads a syncing connection again while held, until it is done or the limit passes', async () => {
    const syncing = listed([connection(A, { status: 'syncing' })]);
    const t = setup([syncing, syncing, listed([connection(A)])]);
    const view = t.store.view(WS);
    const release = view.retain();
    await flush();
    expect(t.timers.map((timer) => timer.ms)).toEqual([SYNC_POLL_MS]);
    t.timers[0]?.run();
    await flush();
    t.timers[1]?.run();
    await flush();
    expect(view.getSnapshot()).toMatchObject({ connections: [{ status: 'connected' }] });
    expect(t.reads()).toBe(3);
    // Done: nothing more is scheduled.
    expect(t.timers).toHaveLength(2);
    release();

    // Still syncing past the limit: it stops asking.
    const stuck = setup([syncing]);
    const held = stuck.store.view(WS);
    held.retain();
    await flush();
    stuck.tick(SYNC_POLL_FOR_MS + 1);
    stuck.timers[0]?.run();
    await flush();
    expect(stuck.timers).toHaveLength(1);
  });
});

describe('milestone 2: the workspace setting and Add as person', () => {
  it('turns making people on at once, and puts it back with a toast when refused', async () => {
    const { store, notices, refuse } = setup([]);
    const held = store.settings(WS);
    held.retain();
    await flush();
    expect(held.getSnapshot()).toEqual({ status: 'ready', createUnknownPeople: false, canManage: true });
    const turning = store.setCreateUnknownPeople(WS, true);
    expect(held.getSnapshot()).toMatchObject({ createUnknownPeople: true });
    expect(await turning).toBe(true);
    // Saved: a quiet toast with Undo, which turns it back.
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ tone: 'success', action: { label: 'Undo' } });
    notices[0]?.action?.onAction();
    await flush();
    expect(held.getSnapshot()).toMatchObject({ createUnknownPeople: false });
    expect(notices).toHaveLength(2);
    refuse(true);
    const refused = store.setCreateUnknownPeople(WS, true);
    expect(held.getSnapshot()).toMatchObject({ createUnknownPeople: true });
    expect(await refused).toBe(false);
    expect(held.getSnapshot()).toMatchObject({ createUnknownPeople: false });
    expect(notices.at(-1)).toMatchObject({ tone: 'danger' });
    expect(notices).toHaveLength(3);
  });

  it('adds an attendee and answers the person, or says why not', async () => {
    const { store, notices, refuse, sent } = setup([]);
    const input = { recordId: A, meetingId: B, email: 'cy@northwind.com' };
    expect(await store.addAttendee(WS, input)).toBe('0199a6f2-0000-7000-8000-0000000000c1');
    expect(sent.at(-1)).toMatchObject({ workspace: WS, ...input });
    refuse(true);
    expect(await store.addAttendee(WS, input)).toBeUndefined();
    expect(notices.at(-1)).toMatchObject({ tone: 'danger' });
  });

  it('says which connections need their member', () => {
    const statuses = ['syncing', 'connected', 'expired', 'failed', 'revoked'] as const;
    expect(statuses.map((status) => needsReconnect({ status }))).toEqual([false, false, true, true, true]);
  });
});

describe('the calendars live kind', () => {
  it('reads the held list again when the member’s connections changed in another tab', async () => {
    const { store, reads } = setup([listed([connection(A)]), listed([connection(A), connection(B)])]);
    const release = store.view(WS).retain();
    await flush();
    expect(reads()).toBe(1);
    store.changed(WS);
    await flush();
    expect(reads()).toBe(2);
    const state = store.view(WS).getSnapshot();
    expect(state.status === 'ready' ? state.connections.map((each) => each.id) : []).toEqual([A, B]);
    release();
  });

  it('reads nothing while no screen holds the list', async () => {
    const { store, reads } = setup([listed([connection(A)])]);
    const release = store.view(WS).retain();
    await flush();
    release();
    store.changed(WS);
    store.changed('elsewhere');
    await flush();
    expect(reads()).toBe(1);
  });
});
