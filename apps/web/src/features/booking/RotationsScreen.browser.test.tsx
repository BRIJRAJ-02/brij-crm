// Settings › Scheduling › Round robin in Chromium (SS-R1 to SS-R3, SS-R10, 23 October 2026): New group shows once,
// in the empty state while there are no groups and in the bar once there is one; the group dialog says who can join
// before Create, with a Set hours link, and its refusal gains the same link; a name error clears as the name is typed;
// and a role without booking.manage finds no such page. QA has no group to show, so the groups are a fixture.
import '@crm/ui/styles.css';
import {
  dataError,
  type CaptureListState,
  type CaptureListView,
  type DataLayer,
  type MemberSummary,
  type RotationView,
} from '@crm/data';
import { createToasts, UiProvider, type Toasts } from '@crm/ui';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRoute,
} from '@tanstack/react-router';
import axe from 'axe-core';
import { act, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { Route as RoundRobinRoute } from '../../routes/w.$slug.settings.scheduling.round-robin.tsx';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { strings as settingsStrings } from '../settings/strings.ts';
import { SettingsTopBarSlot } from '../settings/topBarSlot.ts';
import { RotationsScreen } from './RotationsScreen.tsx';
import { strings } from './rotation-strings.ts';

const ADA = '0190f0f0-0000-7000-8000-0000000000d1';
const GRACE = '0190f0f0-0000-7000-8000-0000000000d2';

const PEOPLE: readonly MemberSummary[] = [
  { id: ADA, name: 'Ada Lovelace', email: 'ada@acme.dev' },
  { id: GRACE, name: 'Grace Hopper', email: 'grace@acme.dev' },
];

const SALES: RotationView = {
  id: '0190f0f0-0000-7000-8000-0000000000e1',
  name: 'Sales',
  strategy: 'fair',
  windowDays: 30,
  evenGap: 3,
  returning: 'owner',
  pages: 1,
  canChange: true,
  createdAt: '2026-10-20T09:00:00Z',
  updatedAt: '2026-10-20T09:00:00Z',
  members: [
    {
      memberId: ADA,
      name: 'Ada Lovelace',
      weight: 100,
      priority: 2,
      dailyCap: null,
      weeklyCap: null,
      isOn: true,
      hasCalendar: true,
      count: 4,
    },
    {
      memberId: GRACE,
      name: 'Grace Hopper',
      weight: 100,
      priority: 2,
      dailyCap: null,
      weeklyCap: null,
      isOn: true,
      hasCalendar: false,
    },
  ],
};

/** The data layer's held list of groups, as the screen reads it. */
function groupsOf(items: readonly RotationView[]): CaptureListView<RotationView> {
  const snapshot: CaptureListState<RotationView> = { status: 'ready', items, pendingIds: new Set() };
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

const LOADING = { status: 'loading' as const };
const stillLoading = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};

let shown: InApp | undefined;
let unmountRoute: (() => void) | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  unmountRoute?.();
  unmountRoute = undefined;
  delete document.documentElement.dataset.theme;
});

/** The settings frame's bar, which a settings page draws its title and its one action into. */
function WithBar({ children }: { readonly children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <>
      <div ref={setSlot} />
      <SettingsTopBarSlot value={slot}>{children}</SettingsTopBarSlot>
    </>
  );
}

/** The screen as an owner sees it, over `groups`; `create` answers the dialog's Create. */
async function renderRotations(
  groups: readonly RotationView[],
  create: () => Promise<RotationView> = () => Promise.resolve(SALES),
) {
  const data = {
    rotations: {
      view: () => groupsOf(groups),
      newId: () => '0190f0f0-0000-7000-8000-0000000000f1',
      create: vi.fn(create),
    },
  } as unknown as DataLayer;
  shown = await renderInApp(
    () => (
      <WithBar>
        <RotationsScreen data={data} slug="acme" people={PEOPLE} canManage />
      </WithBar>
    ),
    {
      data,
      pattern: '/w/$slug/settings/scheduling/round-robin',
      at: '/w/acme/settings/scheduling/round-robin',
      permissions: ['booking.manage', 'booking.admin', 'members.invite'],
    },
  );
  return data;
}

const newGroup = () => page.getByRole('button', { name: strings.newRotation });

/** Opens New group's dialog, names the group and adds both people. */
async function openDialog() {
  await newGroup().click();
  const dialog = page.getByRole('dialog', { name: strings.newRotation });
  await expect.element(dialog).toBeVisible();
  return dialog;
}

/**
 * Theme changes start colour transitions, and a dialog grows in from its centre; finish them so axe reads the final
 * colours and sizes (a spinner's endless turn is left alone).
 */
function settleTransitions() {
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
  }
}

/** The page's WCAG A and AA violations, as `rule: elements` lines. */
async function violations(): Promise<string[]> {
  settleTransitions();
  // React Aria's live announcer can still hold an earlier test's announcement, naming an element gone since.
  const results = await axe.run(
    { include: [document.body], exclude: [['[data-live-announcer]']] },
    {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    },
  );
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

describe('Round robin’s New group', () => {
  it('shows once, in the empty state, while there are no groups', async () => {
    await page.viewport(1280, 800);
    await renderRotations([]);
    await expect.element(page.getByText(strings.emptyTitle)).toBeVisible();
    await expect.element(newGroup()).toBeVisible();
    expect(newGroup().elements()).toHaveLength(1);
    // The empty state's own primary, after its words (the bar sits above the body, before them).
    const title = page.getByText(strings.emptyTitle).element();
    expect(title.compareDocumentPosition(newGroup().element()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(newGroup().element().getAttribute('data-variant')).toBe('primary');
  });

  it('shows once, in the bar, once there is a group', async () => {
    await page.viewport(1280, 800);
    await renderRotations([SALES]);
    await expect.element(page.getByRole('heading', { name: 'Sales' })).toBeVisible();
    expect(newGroup().elements()).toHaveLength(1);
    expect(page.getByText(strings.emptyTitle).elements()).toEqual([]);
    // In the bar, before the groups.
    const group = page.getByRole('heading', { name: 'Sales' }).element();
    expect(group.compareDocumentPosition(newGroup().element()) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('describes a group plainly', async () => {
    await page.viewport(1280, 800);
    await renderRotations([SALES, { ...SALES, id: '0190f0f0-0000-7000-8000-0000000000e2', name: 'Support', pages: 0 }]);
    await expect.element(page.getByText('Fair · last 30 days · 1 booking page')).toBeVisible();
    await expect.element(page.getByText('Fair · last 30 days · not on a booking page yet')).toBeVisible();
  });
});

describe('Round robin’s group dialog', () => {
  it('says who can join before Create, with a Set hours link', async () => {
    await page.viewport(1280, 800);
    await renderRotations([]);
    const dialog = await openDialog();
    await expect.element(dialog.getByText(strings.canJoin)).toBeVisible();
    await expect
      .element(dialog.getByRole('link', { name: strings.setHours }))
      .toHaveAttribute('href', '/w/acme/bookings/availability');
    await expect.element(dialog.getByRole('button', { name: `About ${strings.window}` })).toBeVisible();
  });

  it('clears the name error as the name is typed', async () => {
    await page.viewport(1280, 800);
    await renderRotations([]);
    const dialog = await openDialog();
    await dialog.getByRole('button', { name: strings.create }).click();
    await expect.element(dialog.getByText(strings.nameRequired)).toBeVisible();
    await userEvent.type(dialog.getByRole('textbox', { name: strings.name }), 'S');
    expect(dialog.getByText(strings.nameRequired).elements()).toEqual([]);
  });

  it('keeps the server’s refusal in its words, with the Set hours link', async () => {
    await page.viewport(1280, 800);
    const refusal = 'Grace Hopper needs to set hours or connect a calendar first.';
    await renderRotations([], () =>
      Promise.reject(
        dataError('CONFIG_INVALID', refusal, {
          refusals: [{ field: 'members.1', code: 'CONFIG_INVALID', message: refusal }],
        }),
      ),
    );
    const dialog = await openDialog();
    await userEvent.type(dialog.getByRole('textbox', { name: strings.name }), 'Sales');
    for (const person of PEOPLE) {
      await dialog.getByRole('button', { name: new RegExp(strings.addMember) }).click();
      await page.getByRole('option', { name: new RegExp(person.name) }).click();
    }
    await dialog.getByRole('button', { name: strings.create }).click();
    const said = dialog.getByRole('alert').filter({ hasText: refusal });
    await expect.element(said).toBeVisible();
    await expect.element(said.getByRole('link', { name: strings.setHours })).toBeVisible();
    // The refusal says it now, so the hint under the picker steps aside: one Set hours, not two.
    expect(dialog.getByRole('link', { name: strings.setHours }).elements()).toHaveLength(1);
    expect(dialog.getByText(strings.canJoin).elements()).toEqual([]);
  });
});

describe('Round robin’s address', () => {
  it('is Page not found for a role without booking.manage', async () => {
    await page.viewport(1280, 800);
    const data = {
      access: { mine: () => Promise.resolve({ role: 'guest', permissions: [] }) },
      members: { list: () => Promise.resolve(PEOPLE) },
      rotations: {
        view: () => ({
          ...groupsOf([]),
          ready: () => Promise.reject(dataError('FORBIDDEN', 'You can’t use booking pages here.')),
        }),
      },
      // The frame around the page (sidebar, Tasks badge, calendar banner), all still loading.
      calendar: { view: () => stillLoading },
      nav: { source: () => stillLoading, change: () => undefined },
      tasks: { due: () => stillLoading },
    } as unknown as DataLayer;
    const toasts: Toasts = createToasts();
    const root = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()({ component: Outlet });
    // The file route as the route tree mounts it, here straight under the root.
    const route = RoundRobinRoute.update({
      id: '/w/$slug/settings/scheduling/round-robin',
      path: '/w/$slug/settings/scheduling/round-robin',
      getParentRoute: () => root,
    } as never) as unknown as AnyRoute;
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/w/acme/settings/scheduling/round-robin'] }),
      context: { data, toasts },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const reactRoot = createRoot(host);
    await act(async () => {
      reactRoot.render(
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
    unmountRoute = () => {
      act(() => {
        reactRoot.unmount();
      });
      host.remove();
    };
    await expect.element(page.getByText(settingsStrings.missingText)).toBeVisible();
    expect(page.getByText(strings.emptyTitle).elements()).toEqual([]);
  });
});

describe.each(['light', 'dark'] as const)('Round robin at 390 in %s', (theme) => {
  it.each([
    ['with no groups', [] as readonly RotationView[]],
    ['with a group', [SALES]],
  ] as const)('passes axe %s', async (_state, groups) => {
    await page.viewport(390, 800);
    document.documentElement.dataset.theme = theme;
    await renderRotations(groups);
    expect(await violations()).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it('passes axe with the group dialog open', async () => {
    await page.viewport(390, 800);
    document.documentElement.dataset.theme = theme;
    await renderRotations([]);
    await openDialog();
    expect(await violations()).toEqual([]);
  });
});
