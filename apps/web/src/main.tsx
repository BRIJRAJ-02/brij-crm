// The root stylesheet comes first. The layer order itself comes from
// /layers.css, which layerOrder() (vite.config.ts) links ahead of every bundled
// stylesheet, since Vite links a shared chunk's CSS before this entry's
// (build.test.ts checks).
import '@crm/ui/styles.css';
import { createDataLayer, createIdMinter } from '@crm/data';
import { createToasts, LOADING_TIMING, UiProvider } from '@crm/ui';
import { createThemeController, safeLocalStorage } from '@crm/ui/theme';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { signInHref } from './features/auth/redirect.ts';
import { focusFirstLoad, focusPage } from './features/navigation/focus.ts';
import { followPageTitle } from './features/navigation/title.ts';
import { routeTree } from './routeTree.gen.ts';

// One toast queue for the app, shared by the screens and the data layer.
const toasts = createToasts();

// `router` is made after the data layer (it carries the layer in its
// context); the layer reaches it only once a session starts or ends, long
// after both exist.
const goTo = (href: string) => {
  void router.navigate({ href, replace: true });
};
// Who is signed in changed: the router's loaded pages belong to the last
// person, so none of them may show again (Back after someone else signs in).
const forgetPages = () => {
  router.clearCache();
};
// Someone changed an object's attributes (a live change): the pages showing
// them load again, so a new column appears.
const reloadPages = () => {
  void router.invalidate();
};

// Centrifugo's address, baked in at build time; unset (previews), live updates are off.
const realtimeUrl = import.meta.env.VITE_REALTIME_URL;

const data = createDataLayer({
  origin: window.location.origin,
  notify: (notice) => {
    toasts.toast(notice);
  },
  mintId: createIdMinter({
    now: () => Date.now(),
    fill: (bytes) => {
      crypto.getRandomValues(bytes);
    },
  }),
  onSignedOut: (redirectTo) => {
    goTo(signInHref(redirectTo));
  },
  onSessionChange: forgetPages,
  currentPath: () => `${window.location.pathname}${window.location.search}`,
  ...(realtimeUrl === undefined || realtimeUrl === '' ? {} : { realtimeUrl }),
  onDefinitionsChange: reloadPages,
});

// theme-boot.js already applied a saved choice before first paint; this keeps
// it in step with changes here and in other tabs.
const theme = createThemeController({
  storage: safeLocalStorage(window),
  root: document.documentElement,
  onStorage: (handler) => {
    const listener = (event: StorageEvent) => {
      handler(event.key, event.newValue);
    };
    window.addEventListener('storage', listener);
    return () => {
      window.removeEventListener('storage', listener);
    };
  },
});

const router = createRouter({
  routeTree,
  context: { data, theme, toasts },
  defaultPreload: 'intent',
  // A pending route shows its skeleton on the same timing as everything else (AC-13).
  defaultPendingMs: LOADING_TIMING.delayMs,
  defaultPendingMinMs: LOADING_TIMING.minimumMs,
});

// After moving to another page, focus goes to its title (the page's h1), so
// a screen reader starts there and Tab continues from the top of the page;
// on /sign-in and /verify, to their one field (focus.ts). On the first load,
// only those one field pages move focus, into their field.
router.subscribe('onRendered', (event) => {
  const { pathname } = event.toLocation;
  if (event.fromLocation === undefined) {
    requestAnimationFrame(() => {
      focusFirstLoad(document, pathname);
    });
    return;
  }
  if (!event.pathChanged) return;
  requestAnimationFrame(() => {
    focusPage(document, pathname);
  });
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The page is missing its #root element.');

// The tab's title follows the page's h1 from the first load on (WCAG 2.4.2).
followPageTitle({
  doc: document,
  observe: (onChange) => {
    const observer = new MutationObserver(onChange);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
    };
  },
  nextFrame: (run) => {
    requestAnimationFrame(run);
  },
});

// The browser's language and time zone until #23 adds them to the profile.
createRoot(root).render(
  <StrictMode>
    <UiProvider
      locale={navigator.languages[0] ?? 'en-US'}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      navigate={(href) => {
        router.history.push(href);
      }}
      useHref={(href) => router.history.createHref(href)}
      toasts={toasts}
    >
      <RouterProvider router={router} />
    </UiProvider>
  </StrictMode>,
);
