// The calendars store against a fake API answered by hand (spec 0024 milestone 5): the list read when held, a switch
// and a colour shown at once and put back with a toast when refused, showing a calendar on the week reading the
// weeks again once it lands, the destination moving at once, and a page's own destination set and cleared.
import type { CalendarList, CalendarView, PageDestinationView } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import type { Notice } from '../notice.ts';
import { createCalendarsStore, type CalendarsApi } from './calendars.ts';

const WS = 'acme';
const CONN = '0199a6f2-0000-7000-8000-0000000000c1';
const MAIN = '0199a6f2-0000-7000-8000-0000000000a1';
const TEAM = '0199a6f2-0000-7000-8000-0000000000a2';
const PAGE = '0199a6f2-0000-7000-8000-0000000000p1';

const calendar = (id: string, changes: Partial<CalendarView> = {}): CalendarView => ({
  id,
  connectionId: CONN,
  name: id === MAIN ? 'Ada' : 'Team',
  hue: 'blue',
  accessRole: 'owner',
  isPrimary: id === MAIN,
  checkConflicts: true,
  showInWeek: true,
  sync: true,
  isDestination: id === MAIN,
  canBeDestination: true,
  ...changes,
});

const list = (): CalendarList => ({
  enabled: true,
  providers: ['google'],
  max: 6,
  accounts: [
    {
      id: CONN,
      provider: 'google',
      accountEmail: 'ada@acme.dev',
      status: 'connected',
      sharing: 'shared',
      isDefault: true,
      createdAt: '2026-10-19T09:00:00.000Z',
      calendars: [calendar(MAIN), calendar(TEAM)],
    },
  ],
  destinationId: MAIN,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const notices: Notice[] = [];
  const shown: string[] = [];
  const sent: unknown[] = [];
  const gate = { refuse: false, fellBack: false };
  const refusal = () => Promise.reject(Object.assign(new Error('Not yours.'), { code: 'FORBIDDEN' }));
  let page: PageDestinationView = { status: 'default', isOwner: true };
  const api: CalendarsApi = {
    list: () => Promise.resolve(gate.fellBack ? { ...list(), fellBack: { removedName: 'Team' } } : list()),
    update: (input) => {
      sent.push(input);
      if (gate.refuse) return refusal();
      const { workspace: _w, calendarId, mutationId: _m, colourOverride, ...switches } = input;
      return Promise.resolve(
        calendar(calendarId, {
          ...switches,
          ...(colourOverride === undefined || colourOverride === null ? {} : { colourOverride, hue: colourOverride }),
        }),
      );
    },
    setDestination: (input) => {
      sent.push(input);
      return gate.refuse ? refusal() : Promise.resolve({ destinationId: input.calendarId });
    },
    dismissNotice: (input) => {
      sent.push(input);
      return gate.refuse ? refusal() : Promise.resolve({ destinationId: MAIN });
    },
    pageDestination: () => Promise.resolve(page),
    setPageDestination: (input) => {
      sent.push(input);
      if (gate.refuse) return refusal();
      page =
        input.calendarId === null
          ? { status: 'default', isOwner: true }
          : { calendarId: input.calendarId, status: 'page', isOwner: true };
      return Promise.resolve(page);
    },
  };
  const store = createCalendarsStore({
    api,
    mintId: () => 'mutation',
    notify: (notice) => notices.push(notice),
    onShownChange: (workspace) => shown.push(workspace),
  });
  return { store, notices, shown, sent, gate };
}

const calendarsOf = (state: ReturnType<ReturnType<typeof setup>['store']['list']>['getSnapshot']) => {
  const snapshot = state();
  return snapshot.status === 'ready' ? snapshot.accounts.flatMap((account) => account.calendars) : [];
};

describe('calendars store', () => {
  it('reads the list when held', async () => {
    const { store } = setup();
    const held = store.list(WS);
    expect(held.getSnapshot().status).toBe('loading');
    held.retain();
    await flush();
    expect(calendarsOf(held.getSnapshot).map((each) => each.name)).toEqual(['Ada', 'Team']);
  });

  it('hides a calendar at once, then reads the weeks again once it lands', async () => {
    const { store, shown } = setup();
    const held = store.list(WS);
    held.retain();
    await flush();
    const landing = store.update(WS, TEAM, { showInWeek: false });
    expect(calendarsOf(held.getSnapshot).find((each) => each.id === TEAM)?.showInWeek).toBe(false);
    expect(shown).toEqual([]);
    await expect(landing).resolves.toBe(true);
    expect(shown).toEqual([WS]);
  });

  it('puts a refused colour back and says why', async () => {
    const { store, notices, gate, shown } = setup();
    const held = store.list(WS);
    held.retain();
    await flush();
    gate.refuse = true;
    const landing = store.update(WS, TEAM, { colourOverride: 'green' });
    expect(calendarsOf(held.getSnapshot).find((each) => each.id === TEAM)?.hue).toBe('green');
    await expect(landing).resolves.toBe(false);
    expect(calendarsOf(held.getSnapshot).find((each) => each.id === TEAM)?.hue).toBe('blue');
    expect(notices).toHaveLength(1);
    expect(shown).toEqual([]);
  });

  it('moves the destination at once', async () => {
    const { store } = setup();
    const held = store.list(WS);
    held.retain();
    await flush();
    const landing = store.setDestination(WS, TEAM);
    const snapshot = held.getSnapshot();
    expect(snapshot.status === 'ready' && snapshot.destinationId).toBe(TEAM);
    expect(
      calendarsOf(held.getSnapshot)
        .filter((each) => each.isDestination)
        .map((each) => each.id),
    ).toEqual([TEAM]);
    await expect(landing).resolves.toBe(true);
  });

  it('puts the fallback notice away at once, and back when refused', async () => {
    const { store, gate } = setup();
    gate.fellBack = true;
    const held = store.list(WS);
    held.retain();
    await flush();
    expect(held.getSnapshot()).toHaveProperty('fellBack');
    gate.refuse = true;
    const landing = store.dismissNotice(WS);
    expect(held.getSnapshot()).not.toHaveProperty('fellBack');
    await expect(landing).resolves.toBe(false);
    expect(held.getSnapshot()).toHaveProperty('fellBack');
  });

  it("sets a page's own destination, and clears it back to the owner's", async () => {
    const { store } = setup();
    const held = store.pageDestination(WS, PAGE);
    held.retain();
    await flush();
    void store.setPageDestination(WS, PAGE, TEAM);
    expect(held.getSnapshot()).toMatchObject({ status: 'ready', destination: { status: 'page', calendarId: TEAM } });
    await flush();
    await store.setPageDestination(WS, PAGE, null);
    expect(held.getSnapshot()).toEqual({ status: 'ready', destination: { status: 'default', isOwner: true } });
  });
});
