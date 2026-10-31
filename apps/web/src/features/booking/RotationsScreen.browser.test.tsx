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
import { sharingStrings } from './sharing-strings.ts';

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

/** The editors the fake holds: Maya edits Sales until a test changes it. */
let editorsHeld: readonly { readonly id: string; readonly name: string }[] = [];
const NONE: ReadonlySet<string> = new Set();
let snapshot = { status: 'ready' as const, items: editorsHeld, pendingIds: NONE };
const editorsView = {
  subscribe: () => () => undefined,
  // One snapshot per list held, as useSyncExternalStore needs.
  getSnapshot: () => {
    if (snapshot.items !== editorsHeld) snapshot = { status: 'ready' as const, items: editorsHeld, pendingIds: NONE };
    return snapshot;
  },
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};

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
    // Sharing (spec 0037, AC-1331): the group's editors, held, and set at once.
    editors: {
      view: () => editorsView,
      set: vi.fn((_workspace: string, _type: string, _id: string, next: readonly { id: string; name: string }[]) => {
        editorsHeld = next;
        return Promise.resolve(next);
      }),
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

describe('Sharing (spec 0037, AC-1331, AC-1433)', () => {
  it('lets an admin add an editor and asks before removing one', async () => {
    editorsHeld = [];
    const data = await renderRoundRobin([SALES]);
    await userEvent.click(page.getByRole('tab', { name: sharingStrings.title }));
    await expect.element(page.getByText(sharingStrings.none)).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: new RegExp(sharingStrings.add) }));
    await userEvent.click(page.getByRole('option', { name: /Maya Patel/ }));
    expect(data.editors.set).toHaveBeenLastCalledWith('acme', 'rotation', SALES.id, [{ id: MAYA.id, name: MAYA.name }]);
    shown?.unmount();
    const again = await renderRoundRobin([SALES]);
    await userEvent.click(page.getByRole('tab', { name: sharingStrings.title }));
    await userEvent.click(page.getByRole('button', { name: sharingStrings.remove(MAYA.name) }));
    // Removing ends their access: it asks first.
    const dialog = page.getByRole('alertdialog');
    await expect.element(dialog.getByText(sharingStrings.removeText(MAYA.name, 'Sales'))).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: sharingStrings.removeAction }));
    expect(again.editors.set).toHaveBeenLastCalledWith('acme', 'rotation', SALES.id, []);
    // The row went with its button: focus is on the picker, not lost to the page.
    await expect.element(page.getByRole('button', { name: new RegExp(sharingStrings.add) })).toHaveFocus();
  });

  it('shows an editor the badge and who else edits, with nothing to change and no Delete', async () => {
    editorsHeld = [{ id: MAYA.id, name: MAYA.name }];
    const data = layerWith([{ ...SALES, isEditor: true, canManage: false }]);
    shown = await renderInApp(
      () => withBar(<RotationsScreen data={data} slug="acme" people={[ADA, MAYA]} canManage={false} />),
      {
        data,
        pattern: '/w/$slug/settings/scheduling/round-robin',
        at: '/w/acme/settings/scheduling/round-robin',
        permissions: ['booking.manage'],
      },
    );
    await expect.element(page.getByText(sharingStrings.editorBadge, { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole('tab', { name: sharingStrings.title }));
    await expect.element(page.getByText(MAYA.name)).toBeVisible();
    expect(page.getByRole('button', { name: sharingStrings.remove(MAYA.name) }).elements()).toEqual([]);
    await userEvent.click(page.getByRole('button', { name: strings.rowActions('Sales') }));
    await expect.element(page.getByRole('menuitem', { name: strings.edit })).toBeVisible();
    expect(page.getByRole('menuitem', { name: strings.delete }).elements()).toEqual([]);
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

  it('opens on Fair with the rarely changed settings folded and the members in a drawer (spec 0058, AC-12)', async () => {
    await renderDialog(layerWith([]));
    await expect.element(page.getByRole('radio', { name: strings.fairCard })).toBeChecked();
    // Count meetings and Returning guests fold under More options, closed for a new group.
    const more = page.getByRole('button', { name: strings.moreOptions });
    await expect.element(more).toHaveAttribute('aria-expanded', 'false');
    expect(page.getByRole('button', { name: new RegExp(strings.window) }).elements()).toEqual([]);
    // No member picker or table in the popup: one Members row opens the drawer.
    expect(page.getByRole('table').elements()).toEqual([]);
    expect(page.getByRole('button', { name: new RegExp(strings.addMember) }).elements()).toEqual([]);
    const addMembers = page.getByRole('button', { name: strings.addMembersFor(strings.newRotation) });
    await userEvent.click(addMembers);
    const drawer = page.getByRole('dialog', { name: strings.members(strings.newRotation) });
    await expect.element(drawer.getByRole('button', { name: new RegExp(strings.addMember) })).toBeVisible();
    // Done brings focus back to the row that opened it, not the name field.
    await userEvent.click(drawer.getByRole('button', { name: strings.done }));
    await expect.element(addMembers).toHaveFocus();
    // Create with too few members says so in the popup, with the way back to the drawer.
    await userEvent.type(page.getByRole('textbox', { name: strings.name }), 'Sales');
    await userEvent.click(page.getByRole('button', { name: strings.create }));
    const alert = page.getByRole('alert').filter({ hasText: strings.needTwo });
    await expect.element(alert).toBeVisible();
    // Fixed from the Members row's button, right above it.
    await expect.element(page.getByRole('button', { name: strings.addMembersFor('Sales') })).toBeVisible();
  });

  it('keeps an edited group’s non default settings open', async () => {
    await renderDialog(layerWith([]), { ...SALES, windowDays: 90 });
    await expect
      .element(page.getByRole('button', { name: strings.moreOptions }))
      .toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('button', { name: `About ${strings.window}` })).toBeVisible();
  });

  it('says who can join in the picker’s hint, with no link away from the group', async () => {
    await renderDialog(layerWith([SALES]), SALES);
    await expect.element(page.getByText(strings.membersCount(2))).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: strings.editMembersFor(SALES.name) }));
    const drawer = page.getByRole('dialog', { name: strings.members(SALES.name) });
    await expect.element(drawer.getByText(strings.membersHint(2))).toBeVisible();
    expect(page.getByRole('link').elements()).toEqual([]);
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

    // Ada leaves the draft from above Maya, in the drawer: focus moves on to the next row's remove. Back in the
    // popup, the refusal still names Maya, and still opens Maya's hours.
    const editMembers = page.getByRole('button', { name: strings.editMembersFor(withLee.name) });
    await userEvent.click(editMembers);
    const drawer = page.getByRole('dialog', { name: strings.members(withLee.name) });
    await userEvent.click(drawer.getByRole('button', { name: strings.remove(ADA.name), exact: true }));
    await expect.element(drawer.getByRole('button', { name: strings.remove(MAYA.name), exact: true })).toHaveFocus();
    await userEvent.click(drawer.getByRole('button', { name: strings.done }));
    await expect.element(alert).toBeVisible();
    expect(toHours.element().getAttribute('href')).toBe(`/w/acme/bookings/availability?member=${MAYA.id}`);

    // Removing Maya takes the refusal with her, and focus goes to Save, not the title bar's Close.
    const removeMaya = alert.getByRole('button', { name: strings.removeRefused(MAYA.name), exact: true });
    await expect.element(removeMaya).toHaveTextContent(strings.removeFromGroup);
    await userEvent.click(removeMaya);
    expect(page.getByRole('alert').filter({ hasText: refused }).elements()).toEqual([]);
    const save = page.getByRole('button', { name: strings.save, exact: true });
    await expect.element(save).toHaveFocus();

    // The last row's remove, with no row after it, hands focus to the drawer's Done.
    await userEvent.click(editMembers);
    expect(drawer.getByRole('button', { name: strings.remove(MAYA.name), exact: true }).elements()).toEqual([]);
    await userEvent.click(drawer.getByRole('button', { name: strings.remove(LEE.name), exact: true }));
    expect(drawer.getByRole('button', { name: strings.remove(LEE.name), exact: true }).elements()).toEqual([]);
    await expect.element(drawer.getByRole('button', { name: strings.done })).toHaveFocus();
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
