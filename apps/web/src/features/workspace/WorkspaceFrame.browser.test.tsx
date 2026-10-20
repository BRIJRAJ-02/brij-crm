// The workspace frame's sidebar in Chromium (spec 0026, AC-681, AC-685): the
// theme switch left its footer for Settings, which sits there with ⌘, and
// opens on that shortcut (but not from a text field); inside Settings the
// settings sidebar takes its place.
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
async function renderFrame(settings?: SettingsSidebar): Promise<AnyRouter> {
  const toasts = createToasts();
  const rootRoute = createRootRoute();
  const frame = () => (
    <WorkspaceFrame
      data={data}
      toasts={toasts}
      slug="acme"
      workspaceName="Acme"
      objects={[]}
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
  const router = createRouter({
    routeTree: rootRoute.addChildren([start, preferences]),
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
