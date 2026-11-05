// Purpose: the guest menu at `/m/<key>` (spec 0065, H1), its own bundle (menu.html), so a guest never downloads the app.
// Main task: read the place's published menu, draw it with the library's MenuList, keep Your picks in this browser.
// Leaves out: ordering and paying (picks send nothing), any account, analytics (spec 0066).
//
// The shell function already wrote the menu into the page and left the read as a boot block, so the first paint needs
// no request; the page reads again behind it, and again whenever the tab comes back, so a dish sold out mid service
// shows. A table's QR adds its code (`?t=<code>`, H2): the page asks the server which table that is (counting the
// scan) and shows "Table 4" in the bar.
import '@crm/ui/styles.css';
import { createMenuClient, isDataError, type PublicMenu } from '@crm/data/menu-guest';
import { menuLogoPath, menuLookPath, menuPhotoPath } from '@crm/data/menu';
import {
  BookingFoot,
  BookingProvider,
  EmptyState,
  MenuList,
  claimPageHref,
  livePicks,
  type GuestPick,
} from '@crm/ui/public-menu';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { wearGuestScheme } from '../stylesheet.ts';
import { picksStore, readMenuBoot, tableCodeOf } from './boot.ts';
import { strings } from './strings.ts';

const root = document.getElementById('root');
if (root === null) throw new Error('The menu page has no #root.');

const key = /^\/m\/([^/]+)\/?$/.exec(globalThis.location.pathname)?.[1] ?? '';
const client = createMenuClient({ origin: globalThis.location.origin });
const boot = readMenuBoot(document, key, Date.now());
const tableCode = tableCodeOf(globalThis.location.search);
const picks = picksStore(key, () => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
});

/**
 * Wears the menu's look stylesheet (the shell may have linked it already), the newest version the read names, so a look
 * saved while the tab was open arrives on the next read. A pinned look says its side on the document.
 */
function wearLook(menu: PublicMenu): void {
  wearGuestScheme(document.documentElement, menu.scheme);
  if (menu.look === undefined) return;
  const href = menuLookPath(key, menu.look);
  const worn = document.getElementById('crm-menu-look');
  if (worn?.getAttribute('href') === href) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.id = 'crm-menu-look';
  link.href = href;
  if (worn === null) document.head.append(link);
  else worn.replaceWith(link);
}

/** The picks the menu still offers, writing the trimmed list back when any went. */
function keptPicks(menu: PublicMenu, was: readonly GuestPick[]): readonly GuestPick[] {
  const kept = livePicks(menu, was);
  if (kept.length === was.length) return was;
  picks.write(kept);
  return kept;
}

function MenuPage() {
  const [menu, setMenu] = useState<PublicMenu | undefined>(boot);
  const [failed, setFailed] = useState<'missing' | 'offline' | undefined>();
  // The table a QR opened the menu at ("Table 4", H2), named by the server from the code; an old or unknown code
  // simply shows no table.
  const [table, setTable] = useState<string | undefined>();
  useEffect(() => {
    if (tableCode === undefined) return;
    const controller = new AbortController();
    client.table(key, tableCode, controller.signal).then(
      (found) => setTable(found.name),
      () => undefined,
    );
    return () => controller.abort();
  }, []);
  // A pick saved against an older menu (a size or option since removed) is dropped once the menu is read.
  const [chosen, setChosen] = useState<readonly GuestPick[]>(() =>
    boot === undefined || boot.hidden === true ? picks.read() : keptPicks(boot, picks.read()),
  );

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      client.read(key).then(
        (answer) => {
          if (cancelled) return;
          wearLook(answer);
          setMenu(answer);
          if (answer.hidden !== true) setChosen((was) => keptPicks(answer, was));
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
  // Taken down for now (Live or Hidden): MenuList's own unavailable page, in the menu's look with its header, the
  // ways still open (Reserve a table, Call) and the foot; nothing of the menu.
  return (
    <MenuList
      menu={menu}
      {...(menu.logo === undefined ? {} : { logoHref: menuLogoPath(key, menu.logo) })}
      photoHref={(photoId, size, version) => menuPhotoPath(key, photoId, size, version)}
      {...(table === undefined || menu.hidden === true ? {} : { table })}
      picks={chosen}
      onPicksChange={(next) => {
        setChosen(next);
        picks.write(next);
      }}
      foot={<BookingFoot page="menu" claimHref={claimPageHref('menu')} />}
      hasEntrance
      {...(menu.cover === undefined
        ? {}
        : { coverHref: menuPhotoPath(key, menu.cover.id, 'large', menu.cover.version) })}
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
