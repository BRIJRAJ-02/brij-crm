// The site inside the library's provider: the same tree on the server (render.tsx) and in the browser (client.tsx),
// so hydration matches. Nothing here may read the browser while it renders, so the clock is frozen at the live
// demo's own "now" and the keyboard platform is fixed.
import { UiProvider, type Toasts, type UiProviderProps } from '@crm/ui';
import { SiteFooter } from './components/SiteFooter/SiteFooter.tsx';
import { SiteFrame } from './components/SiteFrame/SiteFrame.tsx';
import { SiteHeader } from './components/SiteHeader/SiteHeader.tsx';
import { HomePage } from './HomePage.tsx';
import { DEMO_NOW, DEMO_TIME_ZONE } from './live/time.ts';
import { PrivacyPage } from './pages/PrivacyPage.tsx';
import { TermsPage } from './pages/TermsPage.tsx';
import type { PageId } from './routes.ts';

/** Props for App. */
export interface AppProps {
  readonly page: PageId;
  readonly toasts: Toasts;
}

/** The year the copyright line names: the build's (vite.config.ts), the same on the server and in the browser. */
const YEAR = __BUILD_YEAR__;

/** A clock that never moves: the demo workspace lives at one moment, on the server and in every browser. */
const frozenClock: NonNullable<UiProviderProps['clock']> = { now: () => DEMO_NOW, subscribe: () => () => undefined };

/** Leaves the page the browser's own way (every link out is to another page or origin). */
const navigate = (href: string) => {
  window.location.assign(href);
};

/** A legal page in the site's frame, between the bar and the footer. */
function LegalSite({ children }: { readonly children: React.ReactNode }) {
  return (
    <SiteFrame>
      <SiteHeader />
      {children}
      <SiteFooter year={YEAR} />
    </SiteFrame>
  );
}

/** One page of the site with the library's language, time zone, clock and toasts around it. */
export function App({ page, toasts }: AppProps) {
  return (
    <UiProvider
      locale="en-US"
      timeZone={DEMO_TIME_ZONE}
      navigate={navigate}
      toasts={toasts}
      clock={frozenClock}
      platform="mac"
    >
      {page === 'home' && <HomePage year={YEAR} />}
      {page === 'privacy' && (
        <LegalSite>
          <PrivacyPage />
        </LegalSite>
      )}
      {page === 'terms' && (
        <LegalSite>
          <TermsPage />
        </LegalSite>
      )}
    </UiProvider>
  );
}
