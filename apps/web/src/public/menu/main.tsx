// Purpose: the guest menu at `/m/<key>` (spec 0065, H1), its own bundle (menu.html), so a guest never downloads the app.
// Main task: read the place's published menu, draw it with the library's MenuList, keep Your picks in this browser.
// Leaves out: ordering and paying (picks send nothing), any account, analytics (spec 0066).
//
// The shell function already wrote the menu into the page and left the read as a boot block, so the first paint needs
// no request; the page reads again behind it, and again whenever the tab comes back, so a dish sold out mid service
// shows. The table a QR code opened it at comes in the fragment (`#t=4`, H2).
import '@crm/ui/styles.css';
import { createMenuClient, isDataError, type PublicMenu } from '@crm/data/menu-guest';
import { menuLogoPath, menuLookPath, menuPhotoPath } from '@crm/data/menu';
import { BookingFoot, BookingProvider, EmptyState, MenuList, claimPageHref, type GuestPick } from '@crm/ui/public-menu';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { picksStore, readMenuBoot, tableOf } from './boot.ts';
import { strings } from './strings.ts';

const root = document.getElementById('root');
if (root === null) throw new Error('The menu page has no #root.');

const key = /^\/m\/([^/]+)\/?$/.exec(globalThis.location.pathname)?.[1] ?? '';
const client = createMenuClient({ origin: globalThis.location.origin });
const boot = readMenuBoot(document, key, Date.now());
const table = tableOf(globalThis.location.hash);
const picks = picksStore(key, () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
});

/** Wears the menu's look stylesheet, once (the shell may have linked it already). */
function wearLook(menu: PublicMenu): void {
  if (menu.look === undefined || document.getElementById('crm-menu-look') !== null) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.id = 'crm-menu-look';
  link.href = menuLookPath(key, menu.look);
  document.head.append(link);
}

function MenuPage() {
  const [menu, setMenu] = useState<PublicMenu | undefined>(boot);
  const [failed, setFailed] = useState<'missing' | 'offline' | undefined>();
  const [chosen, setChosen] = useState<readonly GuestPick[]>(() => picks.read());

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      client.read(key).then(
        (answer) => {
          if (cancelled) return;
          wearLook(answer);
          setMenu(answer);
          setFailed(undefined);
        },
        (error: unknown) => {
          if (cancelled) return;
          setFailed(isDataError(error) && error.code === 'NOT_FOUND' ? 'missing' : 'offline');
        },
      );
    };
    read();
    const onShown = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onShown);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onShown);
    };
  }, []);

  useEffect(() => {
    if (menu !== undefined) document.title = strings.title(menu.business.name);
  }, [menu]);

  if (menu === undefined) {
    if (failed === undefined) return <EmptyState title={strings.loading} isLoading />;
    return (
      <EmptyState
        title={failed === 'missing' ? strings.missing : strings.offline}
        {...(failed === 'offline' ? { onRetry: () => globalThis.location.reload() } : {})}
      >
        {failed === 'missing' ? strings.missingLine : strings.offlineLine}
      </EmptyState>
    );
  }
  return (
    <MenuList
      menu={menu}
      {...(menu.logo === undefined ? {} : { logoHref: menuLogoPath(key, menu.logo) })}
      photoHref={(photoId, size, version) => menuPhotoPath(key, photoId, size, version)}
      {...(table === undefined ? {} : { table })}
      picks={chosen}
      onPicksChange={(next) => {
        setChosen(next);
        picks.write(next);
      }}
      foot={<BookingFoot page="menu" claimHref={claimPageHref('menu')} />}
      hasEntrance
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <BookingProvider
      locale={navigator.languages[0] ?? 'en-GB'}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
    >
      <MenuPage />
    </BookingProvider>
  </StrictMode>,
);
