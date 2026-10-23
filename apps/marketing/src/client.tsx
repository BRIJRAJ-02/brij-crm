// The browser's entry, the site's one script. Built, each page is already drawn (scripts/prerender.ts), and this
// hydrates it so the live demo and the features panel come alive; the dev server has no prerendered pages, so it
// draws the one its address names.
import '@crm/ui/styles.css';
import './styles/fonts.css';
import './styles/site.css';
import { createToasts } from '@crm/ui';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { sendVisit } from './beacon.ts';
import { routeFor } from './routes.ts';
import { APP_ORIGIN } from './site.ts';

const root = document.getElementById('root');
if (root === null) throw new Error('The page has no #root.');
const app = <App page={routeFor(window.location.pathname).id} toasts={createToasts()} />;
if (import.meta.env.DEV) createRoot(root).render(app);
else hydrateRoot(root, app);

// The visit, counted by the app's own api (spec 0047): the built site only (VITE_SITE_HIT_URL overrides the address),
// never the dev server, and never a browser under automation.
const hits =
  import.meta.env.VITE_SITE_HIT_URL ?? (import.meta.env.PROD ? `${APP_ORIGIN}/api/public/site/hit` : undefined);
sendVisit(hits, {
  href: window.location.href,
  referrer: document.referrer,
  isAutomated: navigator.webdriver,
  send: (url, body) => navigator.sendBeacon(url, body),
});
