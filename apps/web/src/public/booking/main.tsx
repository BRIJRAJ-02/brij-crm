// The public booking bundle's entry (spec 0025): `/b/<publicKey>` and its guest
// page `/b/<publicKey>/manage?t=<token>` load this instead of the CRM app
// (book.html, the second Vite input), so a visitor never downloads the app
// shell: the library's root stylesheet, then the page inside the library's
// provider with the browser's language and zone. No analytics. Inside a
// site's embed (`?embed=1`, frame.ts) it also tells the site its height, an
// invisible addition: the page looks the same framed or not.
import '@crm/ui/styles.css';
import { BookingMessage, BookingProvider } from '@crm/ui/public-booking';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BookingPage } from './BookingPage.tsx';
import { closeOnEscape, embedOf, naturalHeight, reportHeight, watchTree, type PostToHost } from '../frame.ts';
import { forgetHandoff, takeHandoff, type HandoffStorage } from './prefill.ts';
import { strings } from './strings.ts';

// The guest page loads on its own: a visitor booking never downloads its changes (move, guests, cancel).
const ManagePage = lazy(() => import('./ManagePage.tsx').then((module) => ({ default: module.ManagePage })));

const root = document.getElementById('root');
if (root === null) throw new Error('The booking page has no #root.');

const address = new URL(globalThis.location.href);
// /b/<publicKey> or /b/<publicKey>/manage, nothing after but an optional slash.
const path = /^\/b\/([^/]+)(\/manage)?\/?$/.exec(address.pathname);
const publicKey = decodeURIComponent(path?.[1] ?? '');
const isManage = path?.[2] !== undefined;
const locale = navigator.languages[0] ?? 'en-US';
const now = () => Date.now();
// A form's hand off leaves the address at once, kept in the tab's session storage (prefill.ts).
const storage = ((): HandoffStorage | undefined => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
})();
const { handoff, tidied } = isManage ? {} : takeHandoff(address, publicKey, storage);
if (tidied !== undefined) globalThis.history.replaceState(globalThis.history.state, '', tidied);

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const embed = embedOf({
  search: address.search,
  isFramed: globalThis.parent !== globalThis.window,
  // Firefox has no ancestor list.
  ancestorOrigins: 'ancestorOrigins' in globalThis.location ? [...globalThis.location.ancestorOrigins] : undefined,
});
if (embed !== undefined) {
  const page = root;
  const post: PostToHost = (message, targetOrigin) => {
    globalThis.parent.postMessage(message, targetOrigin);
  };
  closeOnEscape(embed, post, globalThis.window);
  reportHeight(
    embed,
    post,
    () => {
      const main = page.querySelector('main');
      return main === null ? page.getBoundingClientRect().height : naturalHeight(main, globalThis.window);
    },
    (changed) => watchTree(page, changed),
  );
}

createRoot(root).render(
  <StrictMode>
    <BookingProvider locale={locale} timeZone={timeZone}>
      {isManage ? (
        <Suspense fallback={<BookingMessage title={strings.loading} isLoading />}>
          <ManagePage
            token={address.searchParams.get('t') ?? ''}
            isWelcome={address.searchParams.get('welcome') === '1'}
            locale={locale}
            now={now}
          />
        </Suspense>
      ) : (
        <BookingPage
          publicKey={publicKey}
          locale={locale}
          timeZone={timeZone}
          now={now}
          {...(handoff === undefined ? {} : { handoff })}
          onBooked={(token) => {
            forgetHandoff(publicKey, storage);
            const manage = `/b/${encodeURIComponent(publicKey)}/manage?${new URLSearchParams({ t: token, welcome: '1' }).toString()}`;
            // Inside an embed the guest page opens on the whole tab: it carries the guest's token, so it is
            // never framed.
            if (embed === undefined) globalThis.location.assign(manage);
            else globalThis.open(manage, '_top');
          }}
        />
      )}
    </BookingProvider>
  </StrictMode>,
);
