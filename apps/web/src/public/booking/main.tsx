// The public booking bundle's entry (spec 0025): `/b/<publicKey>` and its guest
// page `/b/<publicKey>/manage?t=<token>` load this instead of the CRM app
// (book.html, the second Vite input), so a visitor never downloads the app
// shell: the library's root stylesheet, then the page inside the library's
// provider with the browser's language and zone. No analytics.
import '@crm/ui/styles.css';
import { BookingProvider } from '@crm/ui/public-booking';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BookingPage } from './BookingPage.tsx';
import { ManagePage } from './ManagePage.tsx';
import { readPrefill } from './prefill.ts';

const root = document.getElementById('root');
if (root === null) throw new Error('The booking page has no #root.');

const address = new URL(globalThis.location.href);
// /b/<publicKey> or /b/<publicKey>/manage, nothing after but an optional slash.
const path = /^\/b\/([^/]+)(\/manage)?\/?$/.exec(address.pathname);
const publicKey = decodeURIComponent(path?.[1] ?? '');
const isManage = path?.[2] !== undefined;
const locale = navigator.languages[0] ?? 'en-US';
const now = () => Date.now();
const prefill = readPrefill(address);

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

createRoot(root).render(
  <StrictMode>
    <BookingProvider locale={locale} timeZone={timeZone}>
      {isManage ? (
        <ManagePage
          token={address.searchParams.get('t') ?? ''}
          isWelcome={address.searchParams.get('welcome') === '1'}
          locale={locale}
          now={now}
        />
      ) : (
        <BookingPage
          publicKey={publicKey}
          locale={locale}
          timeZone={timeZone}
          now={now}
          {...(prefill === undefined ? {} : { prefill })}
          onBooked={(token) =>
            globalThis.location.assign(
              `/b/${encodeURIComponent(publicKey)}/manage?${new URLSearchParams({ t: token, welcome: '1' }).toString()}`,
            )
          }
        />
      )}
    </BookingProvider>
  </StrictMode>,
);
