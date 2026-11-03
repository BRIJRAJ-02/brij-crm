// The reservation page's entry (spec 0066 B7 lite): `/r/<key>` (reserve) and `/r/<key>/manage` (the guest's own
// reservation, the token in the fragment, or the code with the email) load this instead of the CRM app
// (reserve.html), always on the public origin. The library's root stylesheet, then the page inside the booking
// page's provider. Inside a site's embed (`?embed=1`) it tells the site its height, as the booking page does.
import '@crm/ui/styles.css';
import { createTableClient, isDataError, type PublicTablePage } from '@crm/data/tables';
import { BookingMessage, BookingProvider, createToasts } from '@crm/ui/public-booking';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { closeOnEscape, embedOf, naturalHeight, reportHeight, watchTree, type PostToHost } from '../frame.ts';
import { ManageReservation } from './ManageReservation.tsx';
import { ReservePage } from './ReservePage.tsx';
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

type Read =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly page: PublicTablePage }
  | { readonly status: 'error'; readonly message: string };

function Page({ placeKey, isManage }: { readonly placeKey: string; readonly isManage: boolean }) {
  const [read, setRead] = useState<Read>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [manage, setManage] = useState<{ readonly token: string | undefined; readonly isWelcome: boolean } | undefined>(
    isManage ? { token: tokenOf(globalThis.location.hash), isWelcome: false } : undefined,
  );
  useEffect(() => {
    let current = true;
    client.page(placeKey).then(
      (page) => {
        if (!current) return;
        setRead({ status: 'ready', page });
        document.title = strings.tabTitle(page.place.name);
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
        title={strings.notFound}
        onRetry={() => {
          setRead({ status: 'loading' });
          setAttempt((count) => count + 1);
        }}
      >
        {read.message}
      </BookingMessage>
    );
  }
  if (manage !== undefined) {
    return (
      <ManageReservation
        client={client}
        page={read.page}
        locale={locale}
        token={manage.token}
        isWelcome={manage.isWelcome}
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
        setManage({ token: reserved.token, isWelcome: true });
      }}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <BookingProvider locale={locale} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone} toasts={toasts}>
      {path === null ? (
        <BookingMessage title={strings.notFound} />
      ) : (
        <Page placeKey={decodeURIComponent(path[1] ?? '')} isManage={path[2] !== undefined} />
      )}
    </BookingProvider>
  </StrictMode>,
);
