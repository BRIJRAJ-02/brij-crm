// The browser's entry, the site's one script. Built, each page is already drawn (scripts/prerender.ts), and this
// hydrates it so the live demo and the features panel come alive; the dev server has no prerendered pages, so it
// draws the one its address names.
import '@crm/ui/styles.css';
import './styles/fonts.css';
import './styles/site.css';
import { createToasts } from '@crm/ui';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { routeFor } from './routes.ts';

const root = document.getElementById('root');
if (root === null) throw new Error('The page has no #root.');
const app = <App page={routeFor(window.location.pathname).id} toasts={createToasts()} />;
if (import.meta.env.DEV) createRoot(root).render(app);
else hydrateRoot(root, app);
