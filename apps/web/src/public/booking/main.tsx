// The public booking bundle's entry (spec 0025): `/b/<publicKey>` and its guest
// page `/b/<publicKey>/manage?t=<token>` load this instead of the CRM app
// (book.html, the second Vite input), so a visitor never downloads the app
// shell: the library's root stylesheet, then the page inside the library's
// provider with the browser's language and zone. No analytics. Inside a
// site's embed (`?embed=1`, frame.ts) it also tells the site its height, an
// invisible addition: the page looks the same framed or not.
//
// Handle addresses (22 Oct 2026) load it too: `/<handle>` is the person's
// profile, and `/<handle>/<slug>` one of their pages, found by its public key
// and then drawn exactly as `/b/<key>` is. An old handle's address moves to
// the current one in place; a plain `/b/<key>` visit shows the page's handle
// address in place once it has one (never inside an embed, never on a return
// from Google, which comes back to `/b/`).
import '@crm/ui/styles.css';
import { handleAddressOf } from '@crm/contracts/handles';
import { createHandleClient, isDataError } from '@crm/data/booking';
import { BookingMessage, BookingProvider } from '@crm/ui/public-booking';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BookingPage } from './BookingPage.tsx';
import { closeOnEscape, embedOf, naturalHeight, reportHeight, watchTree, type PostToHost } from '../frame.ts';
import { forgetHandoff, takeHandoff, type HandoffStorage } from './prefill.ts';
import { strings } from './strings.ts';

// The guest page loads on its own: a visitor booking never downloads its changes (move, guests, cancel).
const ManagePage = lazy(() => import('./ManagePage.tsx').then((module) => ({ default: module.ManagePage })));
// A profile loads on its own too: a visitor booking never downloads the list.
const ProfilePage = lazy(() => import('./ProfilePage.tsx').then((module) => ({ default: module.ProfilePage })));

const root = document.getElementById('root');
if (root === null) throw new Error('The booking page has no #root.');

const address = new URL(globalThis.location.href);
// /b/<publicKey> or /b/<publicKey>/manage, nothing after but an optional slash.
const path = /^\/b\/([^/]+)(\/manage)?\/?$/.exec(address.pathname);
// Else /<handle> or /<handle>/<slug>.
const handled = path === null ? handleAddressOf(address.pathname) : undefined;
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

const view = createRoot(root);

/** The address shown, in place, with the query and fragment the visit came with. */
const showAddress = (pathname: string) => {
  const next = `${pathname}${globalThis.location.search}${globalThis.location.hash}`;
  globalThis.history.replaceState(globalThis.history.state, '', next);
};

/** Whether a plain `/b/<key>` visit moves to the page's handle address: never framed, nor on a return from Google. */
const mayMove = path !== null && !isManage && embed === undefined && !/[?&](?:calendar|d|day|tz)=/.test(address.search);

/** The booking page (or its guest page) for a public key, as `/b/<key>` has always drawn it. */
function renderBooking(publicKey: string) {
  // The address now: a handle address may have moved to the current handle since the visit began.
  const { handoff, tidied } = isManage ? {} : takeHandoff(new URL(globalThis.location.href), publicKey, storage);
  if (tidied !== undefined) globalThis.history.replaceState(globalThis.history.state, '', tidied);
  view.render(
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
            {...(mayMove
              ? {
                  // The address bar shows the handle address in place: the page already loaded carries on.
                  onAddress: (moved: string) => {
                    showAddress(moved);
                  },
                }
              : {})}
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
}

/** A whole page message, in the provider. */
function renderMessage(title: string, text: string) {
  view.render(
    <StrictMode>
      <BookingProvider locale={locale} timeZone={timeZone}>
        <BookingMessage title={title}>{text}</BookingMessage>
      </BookingProvider>
    </StrictMode>,
  );
}

if (path !== null) {
  renderBooking(decodeURIComponent(path[1] ?? ''));
} else if (handled?.kind === 'profile') {
  view.render(
    <StrictMode>
      <BookingProvider locale={locale} timeZone={timeZone}>
        <Suspense fallback={<BookingMessage title={strings.loading} isLoading />}>
          <ProfilePage handle={handled.handle} onMoved={(current) => showAddress(`/${current}`)} />
        </Suspense>
      </BookingProvider>
    </StrictMode>,
  );
} else if (handled?.kind === 'page') {
  view.render(
    <StrictMode>
      <BookingProvider locale={locale} timeZone={timeZone}>
        <BookingMessage title={strings.loading} isLoading />
      </BookingProvider>
    </StrictMode>,
  );
  const page = handled;
  const tryAddress = () => {
    createHandleClient({ origin: globalThis.location.origin })
      .address(page.handle, page.slug)
      .then(
        (found) => {
          // An old handle's or an old slug's address shows the current one.
          if (found.handle !== page.handle || found.slug !== page.slug) showAddress(`/${found.handle}/${found.slug}`);
          renderBooking(found.publicKey);
        },
        (error: unknown) => {
          if (isDataError(error) && error.code === 'NOT_FOUND') {
            renderMessage(strings.notFoundTitle, strings.notFoundText);
            return;
          }
          view.render(
            <StrictMode>
              <BookingProvider locale={locale} timeZone={timeZone}>
                <BookingMessage title={strings.failedTitle} onRetry={tryAddress}>
                  {strings.failedText}
                </BookingMessage>
              </BookingProvider>
            </StrictMode>,
          );
        },
      );
  };
  tryAddress();
} else {
  renderMessage(strings.notFoundTitle, strings.notFoundText);
}
