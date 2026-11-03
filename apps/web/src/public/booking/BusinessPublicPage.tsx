// Brief
// Purpose: a business's public page at /<company-handle> and /<company-handle>/<place-slug> (spec 0066, B4 lite): what
// it is, whether it is open, its menu, hours and where it is, and the way to reserve.
// Main task: a guest decides to go, and reserves (or, until the reservation flow lands, calls to book, else gets
// directions: never a dead end).
// Leaves out: booking itself (the reservation flow's own page), reviews (B6), services and team (B1), events (B8).
//
// It draws the shell's copy at once when there is a recent one (boot.ts), and reads the page again behind it, so an
// edge cached shell is never what stays. An old handle's or slug's address shows the current one in place.
import { createBusinessClient, directionsLinks, isDataError, type PublicBusinessPage } from '@crm/data/business-page';
import { BookingFoot, BookingMessage, BusinessPage } from '@crm/ui/public-booking';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { wearStylesheet } from '../stylesheet.ts';
import { businessStrings, kindWord } from './business-strings.ts';
import { strings, tabTitle } from './strings.ts';

/** Props for the business page. */
export interface BusinessPublicPageProps {
  /** The handle in the address, as typed. */
  readonly handle: string;
  /** A place's slug, for `/<handle>/<slug>`. */
  readonly slug?: string;
  /** The page the shell already read, drawn at once while the page's own read is out. */
  readonly initial?: PublicBusinessPage;
  /** The page's current address differs from the one in the bar: the page shows it. */
  readonly onMoved: (path: string) => void;
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'gone' }
  | { readonly state: 'failed' }
  | { readonly state: 'ready'; readonly page: PublicBusinessPage };

/** A version as the api writes it, for the brand's stylesheet and logo paths. */
const VERSION = /^[0-9a-f]{12}$/;

/** The page's path for the place it shows: the handle alone for one place, else the place's own. */
function pathOf(page: PublicBusinessPage): string {
  const place = page.places.find((each) => each.id === page.placeId);
  return page.places.length <= 1 || place === undefined
    ? `/${encodeURIComponent(page.handle)}`
    : `/${encodeURIComponent(page.handle)}/${encodeURIComponent(place.slug)}`;
}

/** The business page: the shell's copy, then the page's own read. */
export function BusinessPublicPage({ handle, slug, initial, onMoved }: BusinessPublicPageProps) {
  const client = useMemo(() => createBusinessClient({ origin: globalThis.location.origin }), []);
  const [loaded, setLoaded] = useState<Loaded>(
    initial === undefined ? { state: 'loading' } : { state: 'ready', page: initial },
  );
  const load = useCallback(() => {
    const controller = new AbortController();
    client.page(handle, slug, controller.signal).then(
      (page) => {
        setLoaded({ state: 'ready', page });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        // A copy already drawn stays on a passing failure; a page gone since takes over from it.
        if (isDataError(error) && error.code === 'NOT_FOUND') setLoaded({ state: 'gone' });
        else setLoaded((was) => (was.state === 'ready' ? was : { state: 'failed' }));
      },
    );
    return () => {
      controller.abort();
    };
  }, [client, handle, slug]);
  useEffect(() => load(), [load]);
  const page = loaded.state === 'ready' ? loaded.page : undefined;
  // The address in the bar follows the page's current one; the tab says whose page it is.
  useEffect(() => {
    if (page === undefined) return;
    const path = pathOf(page);
    if (path !== globalThis.location.pathname) onMoved(path);
    document.title = tabTitle(page.name);
  }, [page, onMoved]);
  // The workspace's accent, from its brand kit (spec 0060), through our own api.
  const brandVersion = page?.brand?.version;
  useEffect(() => {
    if (page === undefined) return;
    const href =
      brandVersion !== undefined && VERSION.test(brandVersion)
        ? `/api/public/business/${encodeURIComponent(page.handle)}/look/brand.css?v=${brandVersion}`
        : undefined;
    void wearStylesheet(document, href);
  }, [page, brandVersion]);
  if (loaded.state === 'loading') return <BusinessPage {...EMPTY} isLoading />;
  if (loaded.state === 'gone') {
    return (
      <BookingMessage title={strings.notFoundTitle} page="business_page">
        {strings.notFoundText}
      </BookingMessage>
    );
  }
  if (loaded.state === 'failed') {
    return (
      <BookingMessage
        title={strings.failedTitle}
        page="business_page"
        onRetry={() => {
          setLoaded({ state: 'loading' });
          load();
        }}
      >
        {strings.failedText}
      </BookingMessage>
    );
  }
  const shown = loaded.page;
  const place = shown.places.find((each) => each.id === shown.placeId) ?? shown.places[0];
  if (place === undefined) {
    return (
      <BookingMessage title={strings.notFoundTitle} page="business_page">
        {strings.notFoundText}
      </BookingMessage>
    );
  }
  const logo = shown.brand?.logo;
  const directions = directionsLinks(place);
  return (
    <BusinessPage
      name={shown.name}
      {...(shown.places.length > 1 ? { placeName: place.name } : {})}
      kind={kindWord(shown.kind)}
      description={shown.description}
      about={shown.about}
      {...(logo !== undefined && VERSION.test(logo)
        ? { logo: `/api/public/business/${encodeURIComponent(shown.handle)}/look/logo?v=${logo}` }
        : {})}
      photos={shown.gallery}
      amenities={shown.amenities}
      // A place with no phone of its own takes the business's, so Call to book reaches somebody.
      place={{ ...place, phone: place.phone ?? shown.phone }}
      places={shown.places.map((each) => ({
        name: each.name,
        href: `/${encodeURIComponent(shown.handle)}/${encodeURIComponent(each.slug)}`,
        isCurrent: each.id === place.id,
      }))}
      menu={shown.menu?.sections}
      {...(shown.reserve === undefined
        ? {}
        : {
            reserve:
              shown.reserve === 'open'
                ? { kind: 'open' as const, href: `/${encodeURIComponent(shown.handle)}/reserve` }
                : { kind: 'soon' as const },
          })}
      directions={directions}
      website={shown.website}
      foot={<BookingFoot page="business_page" newTabLabel={businessStrings.poweredByNewTab} />}
    />
  );
}

/** The page's shape while nothing is read yet. */
const EMPTY = {
  name: '',
  kind: '',
  photos: [],
  amenities: [],
  place: { name: '', timeZone: 'UTC', hours: { weekly: {}, exceptions: [] } },
} as const;
