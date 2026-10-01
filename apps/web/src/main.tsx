// The root stylesheet comes first: browsers order cascade layers by first
// appearance, and the minifier drops the layer order statement, so component
// CSS imported before it would sink below the reset (build.test.ts checks).
import '@crm/ui/styles.css';
import { createDataLayer } from '@crm/data';
import { createToasts, UiProvider } from '@crm/ui';
import { createThemeController, safeLocalStorage } from '@crm/ui/theme';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen.ts';

const data = createDataLayer({ origin: window.location.origin });

// One toast queue for the app. The data layer (#6) will raise its toasts on it too.
const toasts = createToasts();

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
  context: { data, theme },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('The page is missing its #root element.');

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
