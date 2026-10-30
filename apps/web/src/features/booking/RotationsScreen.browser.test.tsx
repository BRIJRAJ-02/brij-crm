// Settings › Round robin in Chromium: New group shows once (the empty state's while there are no groups, then the
// bar's, SS-R2); the group dialog's name error goes as soon as a name is typed (SS-R3); who can join is said in the
// member picker's hint, as plain text, and the server's refusal of someone who can't offers to remove them and their
// hours in a new tab, for the member that was sent even after the draft changes; a refusal of someone no longer
// active offers only the remove (SS-R1); a member removed from the refusal or their row hands focus to Save or the
// next row's remove, never the title bar's Close; without booking.manage the page isn't there (SS-R10); axe is clean
// at 390 in light and dark.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/styles.css';
import { dataError, type DataLayer, type MemberSummary, type MyAccess, type RotationView } from '@crm/data';
import { createToasts, UiProvider, type Toasts } from '@crm/ui';
import { createMemoryHistory, createRootRouteWithContext, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { Route as RoundRobinRoute } from '../../routes/w.$slug.bookings.round-robin.tsx';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SettingsTopBarSlot } from '../settings/topBarSlot.ts';
import { RotationDialog } from './RotationDialog.tsx';
import { RotationsScreen } from './RotationsScreen.tsx';
import { strings } from './rotation-strings.ts';

const ADA: MemberSummary = { id: '0199a6f2-0000-7000-8000-000000000001', name: 'Ada Lovelace', email: 'ada@acme.dev' };
const MAYA: MemberSummary = { id: '0199a6f2-0000-7000-8000-000000000002', name: 'Maya Patel', email: 'maya@acme.dev' };

/** A group of Ada and Maya, Fair over 30 days, on one booking page. */
const SALES: RotationView = {
  id: '0199a6f2-0000-7000-8000-0000000000r1',
  name: 'Sales',
  strategy: 'fair',
  windowDays: 30,
  evenGap: 3,
  returning: 'owner',
  pages: 1,
  canChange: true,
  createdAt: '2026-10-20T09:00:00.000Z',
  updatedAt: '2026-10-20T09:00:00.000Z',
  members: [ADA, MAYA].map((person) => ({
    memberId: person.id,
    name: person.name,
    weight: 100,
    priority: 2,
    dailyCap: null,
    weeklyCap: null,
    isOn: true,
    hasCalendar: true,
    count: 0,
    upcoming: 0,
  })),
};

/** Everyone's calendar works (spec 0037): the chips stay quiet. */
const allConnected = {
  held: (_workspace: string, memberId: string) => {
    const state = { status: 'ready' as const, health: { memberId, status: 'connected' as const }, asked: false };
    return { subscribe: () => () => undefined, getSnapshot: () => state, retain: () => () => undefined };
  },
  ask: () => Promise.resolve(true),
};

/** The groups as the data layer holds them: ready, never changing. */
function groups(items: readonly RotationView[]) {
  const state = { status: 'ready' as const, items, pendingIds: new Set<string>() };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

/** A data layer holding `items` as the groups, whose create and update answer `answer`. */
function layerWith(items: readonly RotationView[], answer: () => Promise<RotationView> = () => Promise.resolve(SALES)) {
  const view = groups(items);
  return {
    scheduling: { loaded: () => ({ health: allConnected }), open: () => new Promise(() => undefined) },
    rotations: {
      view: () => view,
      newId: () => '0199a6f2-0000-7000-8000-0000000000n1',
      create: vi.fn(answer),
      update: vi.fn(answer),
      // The Distribution tab reads only when opened.
      distribution: () => new Promise(() => undefined),
    },
  } as unknown as DataLayer;
}

let shown: InApp | undefined;
let bar: HTMLElement | undefined;

beforeEach(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  bar?.remove();
  bar = undefined;
  resetTheme();
});

/** The settings frame's bar, where the page draws its TopBar and its one primary action. */
function withBar(screen: ReactNode): ReactNode {
  bar = document.createElement('div');
  document.body.append(bar);
  return <SettingsTopBarSlot.Provider value={bar}>{screen}</SettingsTopBarSlot.Provider>;
}

/** The Round robin page for an admin of a two person workspace, over `items`. */
async function renderRoundRobin(items: readonly RotationView[]) {
  const data = layerWith(items);
  shown = await renderInApp(() => withBar(<RotationsScreen data={data} slug="acme" people={[ADA, MAYA]} canManage />), {
    data,
    pattern: '/w/$slug/settings/scheduling/round-robin',
    at: '/w/acme/settings/scheduling/round-robin',
    permissions: ['booking.manage', 'booking.admin', 'members.invite'],
  });
  return data;
}

/** The group dialog on its own, new or editing `rotation`. */
async function renderDialog(data: DataLayer, rotation?: RotationView) {
  shown = await renderInApp(
    () => (
      <RotationDialog
        data={data}
        slug="acme"
        people={[ADA, MAYA]}
        {...(rotation === undefined ? {} : { rotation })}
        isOpen
        onClose={() => undefined}
        onSaved={() => undefined}
      />
    ),
    { data, pattern: '/w/$slug/settings/scheduling/round-robin', at: '/w/acme/settings/scheduling/round-robin' },
  );
}

const newGroup = () => page.getByRole('button', { name: strings.newRotation, exact: true });

describe('New group, once', () => {
  it('is the empty state’s one action while there are no groups', async () => {
    await renderRoundRobin([]);
    await expect.element(page.getByText(strings.emptyTitle)).toBeVisible();
    expect(newGroup().elements()).toHaveLength(1);
    expect(bar?.contains(newGroup().element())).toBe(false);
  });

  it('is the bar’s once a group exists', async () => {
    await renderRoundRobin([SALES]);
    await expect.element(page.getByRole('heading', { name: 'Sales' })).toBeVisible();
    expect(newGroup().elements()).toHaveLength(1);
    expect(bar?.contains(newGroup().element())).toBe(true);
    // The card's line, in plain words.
    await expect.element(page.getByText('Fair · last 30 days · 1 booking page')).toBeVisible();
  });

  it('says a group on no booking page in the same small letters', async () => {
    await renderRoundRobin([{ ...SALES, pages: 0 }]);
    await expect.element(page.getByText('Fair · last 30 days · not on a booking page yet')).toBeVisible();
  });
});

describe('the group dialog', () => {
  it('focuses a new group’s name as it opens, not an existing group’s (Q102)', async () => {
    await renderDialog(layerWith([]));
    await expect.element(page.getByRole('textbox', { name: strings.name })).toHaveFocus();
    shown?.unmount();
    await renderDialog(layerWith([SALES]), SALES);
    await expect.element(page.getByRole('textbox', { name: strings.name })).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: strings.name })).not.toHaveFocus();
  });

  it('clears the name error as soon as a name is typed', async () => {
    await renderDialog(layerWith([]));
    await userEvent.click(page.getByRole('button', { name: strings.create }));
    await expect.element(page.getByText(strings.nameRequired)).toBeVisible();
    await userEvent.type(page.getByRole('textbox', { name: strings.name }), 'S');
    expect(page.getByText(strings.nameRequired).elements()).toEqual([]);
  });

  it('says who can join in the picker’s hint, with no link away from the group', async () => {
    await renderDialog(layerWith([SALES]), SALES);
    await expect.element(page.getByText(strings.membersHint(2))).toBeVisible();
    expect(page.getByRole('link').elements()).toEqual([]);
    // The window's help.
    await expect.element(page.getByRole('button', { name: `About ${strings.window}` })).toBeVisible();
  });

  it('offers a refused member’s hours in a new tab, and to remove them, for the member that was sent', async () => {
    const LEE: MemberSummary = { id: '0199a6f2-0000-7000-8000-000000000003', name: 'Lee Chen', email: 'lee@acme.dev' };
    const [ada] = SALES.members;
    if (ada === undefined) throw new Error('Sales has Ada.');
    const withLee: RotationView = {
      ...SALES,
      members: [...SALES.members, { ...ada, memberId: LEE.id, name: LEE.name }],
    };
    const refused = 'Maya Patel needs to set hours or connect a calendar first.';
    const data = layerWith([withLee], () =>
      Promise.reject(
        dataError('CONFIG_INVALID', refused, {
          refusals: [{ code: 'CONFIG_INVALID', message: refused, field: 'members.1' }],
        }),
      ),
    );
    shown = await renderInApp(
      () => (
        <RotationDialog
          data={data}
          slug="acme"
          people={[ADA, MAYA, LEE]}
          rotation={withLee}
          isOpen
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      ),
      { data, pattern: '/w/$slug/settings/scheduling/round-robin', at: '/w/acme/settings/scheduling/round-robin' },
    );
    await userEvent.click(page.getByRole('button', { name: strings.save, exact: true }));
    const alert = page.getByRole('alert').filter({ hasText: refused });
    await expect.element(alert).toBeVisible();
    const toHours = alert.getByRole('link', { name: strings.setHoursFor(MAYA.name), exact: true });
    await expect.element(toHours).toHaveTextContent(strings.setHours);
    expect(toHours.element().getAttribute('href')).toBe(`/w/acme/bookings/availability?member=${MAYA.id}`);
    // A new tab, so the group being made stays.
    expect(toHours.element().getAttribute('target')).toBe('_blank');

    // Ada leaves the draft from above Maya: the refusal still names Maya, and still opens Maya's hours. Focus moves
    // on to the next row's remove.
    await userEvent.click(page.getByRole('button', { name: strings.remove(ADA.name), exact: true }));
    await expect.element(alert).toBeVisible();
    expect(toHours.element().getAttribute('href')).toBe(`/w/acme/bookings/availability?member=${MAYA.id}`);
    await expect.element(page.getByRole('button', { name: strings.remove(MAYA.name), exact: true })).toHaveFocus();

    // Removing Maya takes the refusal with her, and focus goes to Save, not the title bar's Close.
    const removeMaya = alert.getByRole('button', { name: strings.removeRefused(MAYA.name), exact: true });
    await expect.element(removeMaya).toHaveTextContent(strings.removeFromGroup);
    await userEvent.click(removeMaya);
    expect(page.getByRole('alert').filter({ hasText: refused }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: strings.remove(MAYA.name), exact: true }).elements()).toEqual([]);
    const save = page.getByRole('button', { name: strings.save, exact: true });
    await expect.element(save).toHaveFocus();

    // The last row's remove, with no row after it, hands focus to Save too.
    await userEvent.click(page.getByRole('button', { name: strings.remove(LEE.name), exact: true }));
    expect(page.getByRole('button', { name: strings.remove(LEE.name), exact: true }).elements()).toEqual([]);
    await expect.element(save).toHaveFocus();
  });

  it('keeps Remove from group to its short words for a long name at 390', async () => {
    await page.viewport(390, 844);
    const LONG: MemberSummary = {
      id: '0199a6f2-0000-7000-8000-000000000004',
      name: 'Maximiliana Wolfeschlegelsteinhausen Bergerdorff',
      email: 'max@acme.dev',
    };
    const [ada] = SALES.members;
    if (ada === undefined) throw new Error('Sales has Ada.');
    const withLong: RotationView = {
      ...SALES,
      members: [...SALES.members, { ...ada, memberId: LONG.id, name: LONG.name }],
    };
    const refused = `${LONG.name} needs to set hours or connect a calendar first.`;
    const data = layerWith([withLong], () =>
      Promise.reject(
        dataError('CONFIG_INVALID', refused, {
          refusals: [{ code: 'CONFIG_INVALID', message: refused, field: 'members.2' }],
        }),
      ),
    );
    shown = await renderInApp(
      () => (
        <RotationDialog
          data={data}
          slug="acme"
          people={[ADA, MAYA, LONG]}
          rotation={withLong}
          isOpen
          onClose={() => undefined}
          onSaved={() => undefined}
        />
      ),
      { data, pattern: '/w/$slug/settings/scheduling/round-robin', at: '/w/acme/settings/scheduling/round-robin' },
    );
    await userEvent.click(page.getByRole('button', { name: strings.save, exact: true }));
    const alert = page.getByRole('alert').filter({ hasText: refused });
    await expect.element(alert).toBeVisible();
    const remove = alert.getByRole('button', { name: strings.removeRefused(LONG.name), exact: true });
    await expect.element(remove).toHaveTextContent(strings.removeFromGroup);
    // Nothing in the refusal reaches past its own box.
    const box = alert.element().getBoundingClientRect();
    for (const action of [remove, alert.getByRole('link', { name: strings.setHoursFor(LONG.name), exact: true })]) {
      expect(action.element().getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });

  it('offers only to remove someone no longer active, whose hours wouldn’t help', async () => {
    const FORMER = { memberId: '0199a6f2-0000-7000-8000-000000000009', name: 'Sam Former' };
    const [ada] = SALES.members;
    if (ada === undefined) throw new Error('Sales has Ada.');
    const withFormer: RotationView = { ...SALES, members: [...SALES.members, { ...ada, ...FORMER }] };
    const refused = 'Only active members of this workspace can be in a rotation.';
    const data = layerWith([withFormer], () =>
      Promise.reject(
        dataError('CONFIG_INVALID', refused, {
          refusals: [{ code: 'CONFIG_INVALID', message: refused, field: 'members.2' }],
        }),
      ),
    );
    await renderDialog(data, withFormer);
    await userEvent.click(page.getByRole('button', { name: strings.save, exact: true }));
    const alert = page.getByRole('alert').filter({ hasText: refused });
    await expect.element(alert).toBeVisible();
    await expect.element(alert.getByRole('button', { name: strings.removeRefused(FORMER.name) })).toBeVisible();
    expect(alert.getByRole('link').elements()).toEqual([]);
  });
});

describe('without booking.manage', () => {
  it('finds no Round robin page, and reads nothing for it', async () => {
    // A role that can't make booking pages (a custom one; built in members can).
    const access: MyAccess = { memberId: ADA.id, role: 'member', roleLabel: 'Guest', permissions: ['records.export'] };
    const membersList = vi.fn(() => Promise.resolve([ADA]));
    const rotationsView = vi.fn(() => groups([]));
    // The frame around it (calendar banner, sidebar, Tasks badge), still loading: one snapshot, as a store's must be.
    const loading = { status: 'loading' as const };
    const stillLoading = {
      subscribe: () => () => undefined,
      getSnapshot: () => loading,
      retain: () => () => undefined,
      ready: () => Promise.resolve(),
      reload: () => undefined,
    };
    const data = {
      calendar: { view: () => stillLoading },
      nav: { source: () => stillLoading, change: () => undefined },
      tasks: { due: () => stillLoading },
      access: { mine: () => Promise.resolve(access) },
      members: { list: membersList },
      rotations: { view: rotationsView },
    } as unknown as DataLayer;
    const toasts: Toasts = createToasts();
    const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()();
    // The real route, under a bare root as the route tree would put it under the Bookings frame.
    const route = RoundRobinRoute.update({
      id: '/w/$slug/bookings/round-robin',
      path: '/w/$slug/bookings/round-robin',
      getParentRoute: () => rootRoute,
    } as Parameters<typeof RoundRobinRoute.update>[0]);
    const router = createRouter({
      routeTree: rootRoute.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/w/acme/bookings/round-robin'] }),
      context: { data, toasts },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <UiProvider
          locale="en-GB"
          timeZone="UTC"
          toasts={toasts}
          navigate={(href) => {
            router.history.push(href);
          }}
          useHref={(href) => router.history.createHref(href)}
        >
          <RouterProvider router={router} />
        </UiProvider>,
      );
      await router.load();
    });
    shown = {
      router,
      toasts,
      unmount: () => {
        act(() => {
          root.unmount();
        });
        host.remove();
      },
    };
    await expect.element(page.getByText('There’s nothing at this address.')).toBeVisible();
    expect(membersList).not.toHaveBeenCalled();
    expect(rotationsView).not.toHaveBeenCalled();
  });
});

describe('Round robin at 390', () => {
  for (const theme of THEMES) {
    it(`passes axe in ${theme}, with no groups and with one`, async () => {
      await page.viewport(390, 844);
      applyTheme(theme);
      await renderRoundRobin([]);
      await expect.element(page.getByText(strings.emptyTitle)).toBeVisible();
      expect(await axeViolations()).toEqual([]);
      shown?.unmount();
      bar?.remove();
      await renderRoundRobin([SALES]);
      await expect.element(page.getByRole('heading', { name: 'Sales' })).toBeVisible();
      expect(await axeViolations()).toEqual([]);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    });
  }
});
