// The site's pages: where each is served, the file the build writes it to, and its head. One list, read by the
// prerender (one file per page), by the browser's entry (which page to hydrate) and by the sitemap test.
import { PRIVACY_META } from './pages/PrivacyPage.tsx';
import { TERMS_META } from './pages/TermsPage.tsx';

/** A page of the site. */
export type PageId = 'home' | 'privacy' | 'terms';

/** One page's address, built file and head. */
export interface Route {
  readonly id: PageId;
  readonly path: string;
  readonly file: string;
  readonly title: string;
  readonly description: string;
}

const HOME_DESCRIPTION = 'Booking pages, forms and CRM in one place. Every booking becomes a customer record.';

export const ROUTES: readonly Route[] = [
  {
    id: 'home',
    path: '/',
    file: 'index.html',
    title: 'Timefix · Book the meeting. Keep the customer.',
    description: HOME_DESCRIPTION,
  },
  {
    id: 'privacy',
    path: '/privacy',
    file: 'privacy.html',
    title: `${PRIVACY_META.title} · Timefix`,
    description: PRIVACY_META.description,
  },
  {
    id: 'terms',
    path: '/terms',
    file: 'terms.html',
    title: `${TERMS_META.title} · Timefix`,
    description: TERMS_META.description,
  },
];

/** The page at `pathname` (a trailing slash is the same page); the home page for anything else. */
export function routeFor(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return ROUTES.find((route) => route.path === path) ?? (ROUTES[0] as Route);
}
