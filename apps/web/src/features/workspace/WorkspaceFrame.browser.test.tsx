// The workspace frame's sidebar in Chromium (spec 0026, AC-681, AC-685): the
// theme switch left its footer for Settings, which sits there with ⌘, and
// opens on that shortcut (but not from a text field); inside Settings the
// settings sidebar takes its place. Sign out asks first (the owner, 21
// October 2026).
import type { DataLayer } from '@crm/data';
import { createToasts, UiProvider } from '@crm/ui';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { WorkspaceFrame, type SettingsSidebar } from './WorkspaceFrame.tsx';

// The frame reaches the data layer on undo and sign out, which these tests never press, and for the calendar banner,
// which reads the member's calendars: here none, still loading, so no banner shows.
const loading = { status: 'loading' as const };
const calendarView = {
  subscribe: () => () => undefined,
  getSnapshot: () => loading,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};
const data = { calendar: { view: () => calendarView } } as unknown as DataLayer;

// Wider than bp-page-compact, so the sidebar is open and shows its words and keycaps.
beforeAll(async () => {
  await page.viewport(1280, 800);
});

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;

afterEach(() => {
  if (mounted === undefined) return;
  const { root, host } = mounted;
  act(() => {
    root.unmount();
  });
  host.remove();
  mounted = undefined;
});

/** Renders the frame at `/w/acme/start` inside a memory router, with a settings page to go to. */
async function renderFrame(
  settings?: SettingsSidebar,
  layer: DataLayer = data,
  roleLabel?: string,
): Promise<AnyRouter> {
  const toasts = createToasts();
  const rootRoute = createRootRoute();
  const frame = () => (
    <WorkspaceFrame
      data={layer}
      toasts={toasts}
      slug="acme"
      workspaceName="Acme"
      objects={[]}
      {...(roleLabel === undefined ? {} : { roleLabel })}
      {...(settings === undefined ? {} : { settings })}
    >
      <input aria-label="Draft" />
    </WorkspaceFrame>
  );
  const start = createRoute({ getParentRoute: () => rootRoute, path: '/w/acme/start', component: frame });
  const preferences = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/acme/settings/account/preferences',
    component: () => <p>Preferences page</p>,
  });
  const signIn = createRoute({ getParentRoute: () => rootRoute, path: '/sign-in', component: () => <p>Sign in</p> });
  const home = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>Home</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([start, preferences, signIn, home]),
    history: createMemoryHistory({ initialEntries: ['/w/acme/start'] }),
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
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
  return router;
}

/** Presses ⌘, (Ctrl+, off a Mac) on `target`, and lets the router settle. */
async function pressSettingsKey(target: Element): Promise<void> {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: isMac, ctrlKey: !isMac, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('the workspace frame’s sidebar', () => {
  it('no longer holds the theme switch, and keeps Settings at its foot with ⌘,', async () => {
    await renderFrame();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    const settings = [...document.querySelectorAll<HTMLAnchorElement>('nav a')].find((link) =>
      link.textContent.startsWith('Settings'),
    );
    expect(settings?.getAttribute('href')).toBe('/w/acme/settings/account/preferences');
    expect(settings?.querySelector('kbd')).not.toBeNull();
    expect(settings?.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+,$/);
  });

  it('opens Settings on ⌘, (Ctrl+, off a Mac)', async () => {
    const router = await renderFrame();
    await pressSettingsKey(document.body);
    expect(router.state.location.pathname).toBe('/w/acme/settings/account/preferences');
  });

  it('leaves a text field’s ⌘, alone, so a draft is never left behind', async () => {
    const router = await renderFrame();
    const draft = document.querySelector('input[aria-label="Draft"]');
    if (draft === null) throw new Error('No draft field.');
    await pressSettingsKey(draft);
    expect(router.state.location.pathname).toBe('/w/acme/start');
  });

  it('inside Settings, swaps the app sidebar for Settings with its way back and its groups', async () => {
    await renderFrame({ current: 'preferences', backHref: '/w/acme/objects/people' });
    const nav = document.querySelector('nav[aria-label="Settings"]');
    expect(nav).not.toBeNull();
    expect(document.querySelector('nav[aria-label="Main navigation"]')).toBeNull();
    expect(nav?.getAttribute('data-keyboard')).toBe('arrows');
    expect(nav?.querySelector('a[aria-label="Leave settings"]')?.getAttribute('href')).toBe('/w/acme/objects/people');
    // Named by their label on screen, or (folded to the rail on a narrow window) by aria-label.
    const groups = [...(nav?.querySelectorAll('[role="group"]') ?? [])].map((group) => {
      const labelledBy = group.getAttribute('aria-labelledby');
      return labelledBy === null ? group.getAttribute('aria-label') : document.getElementById(labelledBy)?.textContent;
    });
    expect(groups).toEqual(['Account', 'Workspace']);
    // Every entry is a page in Settings: no link out to Captures.
    expect(nav?.textContent).not.toContain('In Captures');
    expect(nav?.querySelector('a[aria-current="page"]')?.textContent).toBe('Preferences');
    // Nothing of the app's sidebar: no records, no Settings entry at the foot.
    expect(nav?.textContent).not.toContain('Records');
    expect(nav?.querySelector('kbd')).toBeNull();
  });
});

describe('signing out from the workspace menu', () => {
  /** A data layer whose sign out is counted, and answers when `release` is called. */
  function signOutLayer() {
    let calls = 0;
    let release: () => void = () => undefined;
    const layer = {
      ...data,
      auth: {
        signOut: () => {
          calls += 1;
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
    } as unknown as DataLayer;
    return { layer, calls: () => calls, release: () => release() };
  }

  /** Opens the workspace menu and picks Sign out. */
  async function pickSignOut(): Promise<void> {
    await page.getByRole('button', { name: /workspace menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
  }

  it('asks first: Cancel signs nobody out and puts focus back on the menu’s button', async () => {
    const counted = signOutLayer();
    await renderFrame(undefined, counted.layer);
    await pickSignOut();
    const dialog = page.getByRole('dialog', { name: 'Sign out?' });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().textContent).toContain('You’ll need to sign in again on this device.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.calls()).toBe(0);
    await expect.element(page.getByRole('button', { name: /workspace menu/ })).toHaveFocus();
  });

  it('signs out once on Sign out, busy while it runs, then opens sign in', async () => {
    const counted = signOutLayer();
    const router = await renderFrame(undefined, counted.layer);
    await pickSignOut();
    const dialog = page.getByRole('dialog', { name: 'Sign out?' });
    const commit = dialog.getByRole('button', { name: /Sign(ing)? out/ });
    await commit.click();
    // Busy: the commit spins, and a second press does nothing.
    await expect.element(dialog.getByRole('button', { name: 'Signing out' })).toBeVisible();
    await commit.click({ force: true });
    expect(counted.calls()).toBe(1);
    await act(async () => {
      counted.release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(router.state.location.pathname).toBe('/sign-in');
  });
});

describe('leaving the workspace from its menu', () => {
  /** A data layer whose leave is counted, answering with `answer`. */
  function leaveLayer(answer: () => Promise<void>) {
    let calls = 0;
    const layer = {
      ...data,
      members: {
        leave: () => {
          calls += 1;
          return answer();
        },
      },
    } as unknown as DataLayer;
    return { layer, calls: () => calls };
  }

  /** Opens the workspace menu and picks Leave workspace. */
  async function pickLeave(): Promise<void> {
    await page.getByRole('button', { name: /workspace menu/ }).click();
    await page.getByRole('menuitem', { name: 'Leave workspace' }).click();
  }

  it('asks first, naming the workspace; Cancel leaves nothing', async () => {
    const counted = leaveLayer(() => Promise.resolve());
    await renderFrame(undefined, counted.layer, 'Member');
    await pickLeave();
    const dialog = page.getByRole('alertdialog', { name: 'Leave Acme?' });
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.calls()).toBe(0);
  });

  it('leaves once, then opens the next workspace from /', async () => {
    const counted = leaveLayer(() => Promise.resolve());
    const router = await renderFrame(undefined, counted.layer, 'Member');
    await pickLeave();
    const dialog = page.getByRole('alertdialog', { name: 'Leave Acme?' });
    await dialog.getByRole('button', { name: 'Leave workspace' }).click();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(counted.calls()).toBe(1);
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows the only owner LAST_OWNER’s sentence inside the dialog, which stays open', async () => {
    const counted = leaveLayer(() =>
      Promise.reject(
        Object.assign(new Error('A workspace needs an owner. Make someone else an owner first.'), {
          name: 'DataError',
          code: 'LAST_OWNER',
        }),
      ),
    );
    await renderFrame(undefined, counted.layer, 'Owner');
    await pickLeave();
    const dialog = page.getByRole('alertdialog', { name: 'Leave Acme?' });
    await dialog.getByRole('button', { name: 'Leave workspace' }).click();
    await expect.element(dialog.getByRole('alert')).toBeVisible();
    expect(dialog.element().textContent).toContain('A workspace needs an owner.');
    expect(counted.calls()).toBe(1);
  });

  it('isn’t offered before the person’s role is known', async () => {
    await renderFrame();
    await page.getByRole('button', { name: /workspace menu/ }).click();
    await expect.element(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    expect(page.getByRole('menuitem', { name: 'Leave workspace' }).elements()).toHaveLength(0);
  });
});
