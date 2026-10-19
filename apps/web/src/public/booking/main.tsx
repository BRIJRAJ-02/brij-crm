// The public booking bundle's entry (spec 0025): `/b/<publicKey>` loads this
// instead of the CRM app (book.html, the second Vite input), so a visitor
// never downloads the app shell or the component library: the compiled
// tokens, then the page with the browser's language and zone. No analytics.
import '@crm/tokens/tokens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BookingPage } from './BookingPage.tsx';
import { readPrefill } from './prefill.ts';

const root = document.getElementById('root');
if (root === null) throw new Error('The booking page has no #root.');

// /b/<publicKey>, nothing after it but an optional slash.
const publicKey = /^\/b\/([^/]+)\/?$/.exec(globalThis.location.pathname)?.[1] ?? '';
const prefill = readPrefill(new URL(globalThis.location.href));

createRoot(root).render(
  <StrictMode>
    <BookingPage
      publicKey={decodeURIComponent(publicKey)}
      locale={navigator.languages[0] ?? 'en-US'}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
      now={() => Date.now()}
      {...(prefill === undefined ? {} : { prefill })}
    />
  </StrictMode>,
);
