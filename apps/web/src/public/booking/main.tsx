// The public booking bundle's entry (spec 0025): `/b/<publicKey>` loads this
// instead of the CRM app (book.html, the second Vite input), so a visitor
// never downloads the app shell. The library's root stylesheet first, then
// the page in the provider, with the browser's language and zone.
import '@crm/ui/styles.css';
import { createToasts, UiProvider } from '@crm/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BookingPage } from './BookingPage.tsx';

const root = document.getElementById('root');
if (root === null) throw new Error('The booking page has no #root.');

// /b/<publicKey>, nothing after it but an optional slash.
const publicKey = /^\/b\/([^/]+)\/?$/.exec(globalThis.location.pathname)?.[1] ?? '';

createRoot(root).render(
  <StrictMode>
    <UiProvider
      locale={navigator.languages[0] ?? 'en-US'}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      navigate={(href) => globalThis.location.assign(href)}
      toasts={createToasts()}
    >
      <BookingPage
        publicKey={decodeURIComponent(publicKey)}
        locale={navigator.languages[0] ?? 'en-US'}
        timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
        now={() => Date.now()}
      />
    </UiProvider>
  </StrictMode>,
);
