import { createDataLayer } from '@crm/data';
import '@crm/ui/styles.css';
import { createThemeController, safeLocalStorage } from '@crm/ui/theme';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen.ts';

const data = createDataLayer({ origin: window.location.origin });

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

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
