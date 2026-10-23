// Settings › Round robin in Chromium: New group shows once (the empty state's while there are no groups, then the
// bar's, SS-R2); the group dialog's name error goes as soon as a name is typed (SS-R3); who can join is said under
// the member picker with a Set hours link, and the server's refusal of someone who can't gains the same link to their
// hours (SS-R1); without booking.manage the page isn't there (SS-R10); axe is clean at 390 in light and dark.
// The library's stylesheet first, as main.tsx loads it, so what axe measures is the app's.
import '@crm/ui/styles.css';
import { dataError, type DataLayer, type MemberSummary, type MyAccess, type RotationView } from '@crm/data';
import { createToasts, UiProvider, type Toasts } from '@crm/ui';
import { createMemoryHistory, createRootRouteWithContext, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { Route as RoundRobinRoute } from '../../routes/w.$slug.settings.scheduling.round-robin.tsx';
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
});

describe('the group dialog', () => {
  it('clears the name error as soon as a name is typed', async () => {
    await renderDialog(layerWith([]));
    await userEvent.click(page.getByRole('button', { name: strings.create }));
    await expect.element(page.getByText(strings.nameRequired)).toBeVisible();
    await userEvent.type(page.getByRole('textbox', { name: strings.name }), 'S');
    expect(page.getByText(strings.nameRequired).elements()).toEqual([]);
  });

  it('says who can join, with Set hours, and links a refused member to their hours', async () => {
    const refused = 'Maya Patel needs to set hours or connect a calendar first.';
    const data = layerWith([SALES], () =>
      Promise.reject(
        dataError('CONFIG_INVALID', refused, {
          refusals: [{ code: 'CONFIG_INVALID', message: refused, field: 'members.1' }],
        }),
      ),
    );
    await renderDialog(data, SALES);
    // Under the picker, before anything is sent.
    await expect.element(page.getByText(strings.canJoin)).toBeVisible();
    const hint = page.getByRole('link', { name: strings.setHours });
    expect(hint.elements()).toHaveLength(1);
    expect(hint.element().getAttribute('href')).toBe('/w/acme/bookings/availability');
    // The window's help.
    await expect.element(page.getByRole('button', { name: `About ${strings.window}` })).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: strings.save, exact: true }));
    const alert = page.getByRole('alert').filter({ hasText: refused });
    await expect.element(alert).toBeVisible();
    const toHours = alert.getByRole('link', { name: strings.setHours });
    expect(toHours.element().getAttribute('href')).toBe(`/w/acme/bookings/availability?member=${MAYA.id}`);
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
    // The real route, under a bare root as the route tree would put it under the settings frame.
    const route = RoundRobinRoute.update({
      id: '/w/$slug/settings/scheduling/round-robin',
      path: '/w/$slug/settings/scheduling/round-robin',
      getParentRoute: () => rootRoute,
    } as Parameters<typeof RoundRobinRoute.update>[0]);
    const router = createRouter({
      routeTree: rootRoute.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/w/acme/settings/scheduling/round-robin'] }),
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
