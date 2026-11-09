// The reservation page's entry (spec 0066 B7 lite): `/r/<key>` (reserve) and `/r/<key>/manage` (the guest's own
// reservation, the token in the fragment, or the code with the email) load this instead of the CRM app
// (reserve.html), always on the public origin. The library's root stylesheet, then the page inside the booking
// page's provider. Inside a site's embed (`?embed=1`) it tells the site its height, as the booking page does.
import '@crm/ui/styles.css';
import { createTableClient, isDataError, type PublicTablePage } from '@crm/data/tables';
import { BookingMessage, BookingProvider, createToasts, GuestLook } from '@crm/ui/public-booking';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { closeOnEscape, embedOf, naturalHeight, reportHeight, watchTree, type PostToHost } from '../frame.ts';
import { wearGuestScheme, wearStylesheet } from '../stylesheet.ts';
import { ManageReservation } from './ManageReservation.tsx';
import { NewsConfirm } from './NewsConfirm.tsx';
import { lookHref, ReservePage } from './ReservePage.tsx';
import { strings } from './strings.ts';

const root = document.getElementById('root');
if (root === null) throw new Error('The reservation page has no #root.');

const address = new URL(globalThis.location.href);
const path = /^\/r\/([^/]+)(\/manage)?\/?$/.exec(address.pathname);
const locale = navigator.languages[0] ?? 'en-US';
const client = createTableClient({ origin: address.origin });
const toasts = createToasts();

const embed = embedOf({
  search: address.search,
  isFramed: globalThis.parent !== globalThis.window,
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

/** The manage link's token, from the fragment (never sent to a server, never in a log). */
const tokenOf = (hash: string): string | undefined => {
  const token = hash.replace(/^#(?:t=)?/, '');
  return /^[A-Za-z0-9_-]{32}$/.test(token) ? token : undefined;
};

/**
 * The news and offers link's token (`#news=`, double opt-in), from the fragment like the manage token: present (a
 * string, maybe one that opens nothing) only on that link, so the manage page never reads it as a reservation's.
 */
const newsOf = (hash: string): string | undefined => {
  if (!hash.startsWith('#news=')) return undefined;
  const token = new URLSearchParams(hash.slice(1)).get('news') ?? '';
  return /^[A-Za-z0-9_.-]{1,1024}$/.test(token) ? token : '';
};

type Read =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly page: PublicTablePage }
  | { readonly status: 'error'; readonly message: string };

function Page({ placeKey, isManage }: { readonly placeKey: string; readonly isManage: boolean }) {
  const [read, setRead] = useState<Read>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [news] = useState(() => (isManage ? newsOf(globalThis.location.hash) : undefined));
  const [manage, setManage] = useState<
    { readonly token: string | undefined; readonly isWelcome: boolean; readonly isNewsAsked?: boolean } | undefined
  >(isManage ? { token: tokenOf(globalThis.location.hash), isWelcome: false } : undefined);
  useEffect(() => {
    let current = true;
    client.page(placeKey).then(
      (page) => {
        if (!current) return;
        // The guest look (the menu's, with the brand's accent) before the page draws, so it never paints in the
        // fallback first; a slow stylesheet arrives over the drawn page.
        wearGuestScheme(document.documentElement, page.scheme);
        void wearStylesheet(document, lookHref(page)).then(() => {
          if (!current) return;
          setRead({ status: 'ready', page });
          document.title = strings.tabTitle(page.place.name);
        });
      },
      (error: unknown) => {
        if (current) setRead({ status: 'error', message: isDataError(error) ? error.message : strings.offline });
      },
    );
    return () => {
      current = false;
    };
  }, [placeKey, attempt]);
  if (read.status === 'loading') return <BookingMessage title={strings.reserveTable} isLoading />;
  if (read.status === 'error') {
    return (
      <BookingMessage
        // Offline is not gone: the page says which, and Try again stays.
        title={read.message === strings.offline ? strings.offlineTitle : strings.notFound}

        onRetry={() => {
          setRead({ status: 'loading' });
          setAttempt((count) => count + 1);
        }}
      >
        {read.message}
      </BookingMessage>
    );
  }
  if (isManage && news !== undefined) {
    return <NewsConfirm client={client} page={read.page} token={news === '' ? undefined : news} />;
  }
  if (manage !== undefined) {
    return (
      <ManageReservation
        client={client}
        page={read.page}
        locale={locale}
        token={manage.token}
        isWelcome={manage.isWelcome}
        isNewsAsked={manage.isNewsAsked === true}
      />
    );
  }
  return (
    <ReservePage
      client={client}
      page={read.page}
      locale={locale}
      isEmbedded={embed !== undefined}
      onReserved={(reserved) => {
        // The reservation's own address from now on, so a reload or a bookmark keeps it (the token in the fragment).
        if (reserved.token !== undefined) {
          globalThis.history.replaceState(null, '', `/r/${encodeURIComponent(placeKey)}/manage#${reserved.token}`);
        }
        setManage({ token: reserved.token, isWelcome: true, isNewsAsked: reserved.isNewsAsked });
      }}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <BookingProvider locale={locale} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} toasts={toasts}>
      {/* One look for everything here: loading, closed, the page, the details and the receipt. */}
      <GuestLook>
        {path === null ? (
          <BookingMessage title={strings.notFound} />
        ) : (
          <Page placeKey={decodeURIComponent(path[1] ?? '')} isManage={path[2] !== undefined} />
        )}
      </GuestLook>
    </BookingProvider>
  </StrictMode>,
);
