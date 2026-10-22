// For browser tests (*.browser.test.tsx) only, never imported by the app: a
// screen inside what main.tsx gives every screen, the UiProvider (language,
// time zone, toasts) and a router whose root context holds the data layer and
// the toasts, at one address. The data layer is a fake holding just what the
// screen under test calls; tests reach the page through `vitest/browser`.
import type { DataLayer } from '@crm/data';
import { createToasts, UiProvider, type Toasts } from '@crm/ui';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/** A screen rendered by `renderInApp`, and how to take it down. */
export interface InApp {
  readonly router: AnyRouter;
  readonly toasts: Toasts;
  readonly unmount: () => void;
}

/** Where the screen renders: a route pattern (`/w/$slug/trash`) and the address it opens at (`/w/acme/trash`). */
export interface InAppOptions {
  readonly data: Partial<DataLayer>;
  readonly pattern: string;
  readonly at: string;
  /** The app's toast queue, when the screen takes it as a prop too; else one of its own. */
  readonly toasts?: Toasts;
  /** What the person may do, read by `useCan`: the screen then sits under a `/w/$slug` route whose loader holds
   * them, as the workspace frame's does. `pattern` must start with `/w/$slug/`. Left out, `useCan` is false. */
  readonly permissions?: readonly string[];
}

/** The calendar banner every workspace page draws: no calendars, still loading, so nothing shows. One snapshot,
 * the same each read, as a store's must be. */
const loading = { status: 'loading' as const };
const calendarView = {
  subscribe: () => () => undefined,
  getSnapshot: () => loading,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};

/** The frame's sidebar (spec 0034) and its Tasks badge: still loading, so the sidebar draws its loading row and no
 * count. The frame calls them on every workspace page, so a screen's fake needn't. */
const stillLoading = {
  subscribe: () => () => undefined,
  getSnapshot: () => loading,
  retain: () => () => undefined,
};

/** Renders `screen` at `at` inside the app's providers, and waits for the router to settle. */
export async function renderInApp(
  screen: () => ReactNode,
  { data, pattern, at, toasts = createToasts(), permissions }: InAppOptions,
): Promise<InApp> {
  const layer = {
    calendar: { view: () => calendarView },
    nav: { source: () => stillLoading, change: () => undefined },
    ...data,
    tasks: { due: () => stillLoading, ...data.tasks },
  } as unknown as DataLayer;
  const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()({ component: Outlet });
  const workspace =
    permissions === undefined
      ? undefined
      : createRoute({
          getParentRoute: () => rootRoute,
          path: '/w/$slug',
          component: Outlet,
          loader: () => ({ access: { permissions } }),
        });
  const routeTree =
    workspace === undefined
      ? rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: pattern, component: screen })])
      : rootRoute.addChildren([
          workspace.addChildren([
            createRoute({
              getParentRoute: () => workspace,
              path: pattern.replace(/^\/w\/\$slug\//, ''),
              component: screen,
            }),
          ]),
        ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [at] }),
    context: { data: layer, toasts },
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
  return {
    router,
    toasts,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/**
 * The open modal dialog, if any: an alert (a confirm before something destructive) or a plain dialog. Toasts are
 * alert dialogs too, but never modal, so they don't count.
 */
export function openDialog(role: 'alertdialog' | 'dialog' | 'any' = 'any'): HTMLElement | null {
  const roles = role === 'any' ? ['alertdialog', 'dialog'] : [role];
  return document.querySelector<HTMLElement>(
    roles.map((each) => `[role="${each}"]:not([aria-modal="false"])`).join(', '),
  );
}

/** A promise and the hands that settle it, for a write the test answers when it chooses. */
export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
