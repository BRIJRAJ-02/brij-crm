// Brief
// Purpose: a person's link page at /<handle> (spec 0051, built as blocks): the one address they hand over at an event,
// who they are, how to book them, and where else to find them.
// Main task: a visitor presses one block (a booking page, a link) and lands where they meant to go.
// Leaves out: Link only booking pages (never listed), booking itself (each page's own), and any count of blocks
// (read a page at a time, never all at once).
//
// An address nobody holds (25 Oct 2026): the page asks the server once, and only once a profile read answered
// NOT_FOUND, whether the address is free; `free` turns the dead end into the offer to claim it, and `absent` keeps
// the plain not found. A word kept for Timefix and a handle somebody holds (listed or not) both answer `absent`, so
// nothing here can say that a private account is behind an address.
import { createHandleClient, isDataError, type PublicProfile, type PublicProfileItem } from '@crm/data/booking';
import {
  BookingFoot,
  BookingHandleOffer,
  BookingMessage,
  Button,
  Callout,
  claimPageHref,
  EmptyState,
  LinkListToolbar,
  LinkPage,
  SocialLinks,
  useToasts,
} from '@crm/ui/public-booking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { claimHandleHref } from './claim.ts';
import { blocksOf } from './link-page.ts';
import { strings, tabTitle } from './strings.ts';

/** The address as the visitor reads it in the bar: the host they are on, then the handle. */
function addressOf(handle: string): string {
  return `${globalThis.location.host}/${handle}`;
}

/**
 * Share this page: the device's own share sheet where there is one (the Web Share API), else the address on the
 * clipboard with a toast saying so. A cancelled sheet is not a failure, so nothing is said and nothing is copied.
 */
function ShareButton({ address, name }: { readonly address: string; readonly name: string }) {
  const toasts = useToasts();
  const [isSharing, setSharing] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(address).then(
      () => toasts.toast({ tone: 'success', message: strings.shareCopied }),
      () => toasts.toast({ tone: 'danger', message: strings.shareFailed }),
    );
  const share = () => {
    if (isSharing) return;
    setSharing(true);
    const card = { title: name, url: address };
    // A title and a URL is the one shape every browser with a share sheet accepts, so there is nothing to ask canShare.
    const sheet = typeof navigator.share === 'function' ? navigator.share(card) : undefined;
    const done =
      sheet === undefined
        ? copy()
        : sheet.catch((error: unknown) => {
            // The person closed the sheet: they chose not to share, so nothing is copied and nothing is said.
            if (error instanceof Error && error.name === 'AbortError') return undefined;
            return copy();
          });
    void done.finally(() => setSharing(false));
  };
  return <Button variant="secondary" size="touch" icon="upload" label={strings.sharePage} onPress={share} />;
}

/** Past this many rows (headings aside), a search sits above them (AC-5133). */
const SEARCH_FROM = 8;
/** How long typing rests before the search reads. */
const SEARCH_WAIT_MS = 250;

/** Props for the profile page. */
export interface ProfilePageProps {
  /** The handle in the address, as typed: an old one moves to the current one (`onMoved`). */
  readonly handle: string;
  /** The person's current handle differs from the address's: the page puts it in the address. */
  readonly onMoved: (handle: string) => void;
}

type Loaded =
  | { readonly state: 'loading' }
  /** The profile read found nothing: which of the three reasons it was is still being asked. */
  | { readonly state: 'checking' }
  | { readonly state: 'gone' }
  /** Nobody holds this address: the page offers it. */
  | { readonly state: 'free' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'ready';
      readonly profile: PublicProfile;
      readonly items: readonly PublicProfileItem[];
      readonly next?: string;
    };

/**
 * The folded section the address names (spec 0054, AC-5417): `#<block id>`, and nothing else. A hash that isn't a
 * block's id is dropped here rather than handed on, and an id naming no live folded heading simply opens nothing,
 * so the page draws as it would with no hash at all.
 */
function folderInAddress(): string | undefined {
  const named = globalThis.location.hash.slice(1);
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(named) ? named : undefined;
}

/**
 * The page's foot: "Powered by Timefix", tagged as the profile, and Claim your free page. The mark is pinned to
 * the look its owner picked, not the visitor's own (26 October 2026): a light page read on a phone in dark mode
 * drew the white mark on white, so the foot showed "POWERED BY" over nothing.
 */
const footOf = (mode: 'light' | 'dark') => (
  <BookingFoot page="booking_profile" claimHref={claimPageHref('booking_profile')} scheme={mode} />
);

/** The link page: the person, then their blocks a page at a time, with a search once there are many. */
export function ProfilePage({ handle, onMoved }: ProfilePageProps) {
  const client = useMemo(() => createHandleClient({ origin: globalThis.location.origin }), []);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [isMoreLoading, setMoreLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // A search that failed: said under the search, the page stays.
  const [searchFailed, setSearchFailed] = useState(false);
  // Whether the unsearched page is long enough for a search: once true, it stays while the person searches.
  const [isLong, setLong] = useState(false);
  // Only the newest read lands: a slow answer to an older search never replaces a newer one.
  const latest = useRef(0);
  // Whether the page has drawn once, read by a failed search without a state updater's side effect.
  const loadedRef = useRef<Loaded['state']>('loading');
  // The open folded section lives in the address, so a link opens one and the back button closes it (AC-5417).
  const [openFolder, setOpenFolder] = useState(folderInAddress);
  // Only the section the page was opened at is scrolled to; one a visitor presses is already under their thumb.
  const scrollTo = useRef(folderInAddress());
  useEffect(() => {
    loadedRef.current = loaded.state;
  }, [loaded.state]);

  const load = useCallback(
    (search: string) => {
      const ticket = (latest.current += 1);
      // The page's first read is its view (AC-5124); a cleared search reads it again as a search, never a view.
      const isFirst = loadedRef.current !== 'ready';
      client.profile(handle, search === '' && isFirst ? {} : { q: search }).then(
        (profile) => {
          if (ticket !== latest.current) return;
          if (profile.handle !== handle) onMoved(profile.handle);
          // Rows, not headings: a page of eight links under two headings needs no search.
          const rows = profile.items.filter((item) => item.kind !== 'heading').length;
          if (search === '' && (rows > SEARCH_FROM || profile.next !== undefined)) setLong(true);
          setMoreFailed(false);
          setSearchFailed(false);
          setLoaded({
            state: 'ready',
            profile,
            items: profile.items,
            ...(profile.next === undefined ? {} : { next: profile.next }),
          });
        },
        (error: unknown) => {
          if (ticket !== latest.current) return;
          // Only the first read takes the page: a search that fails says so under the search.
          if (loadedRef.current === 'ready') {
            setSearchFailed(true);
            return;
          }
          // Nothing to show: which of the three reasons comes next, from the server (the effect below).
          setLoaded({ state: isDataError(error) && error.code === 'NOT_FOUND' ? 'checking' : 'failed' });
        },
      );
    },
    [client, handle, onMoved],
  );
  useEffect(() => {
    load(searched);
  }, [load, searched]);
  // Typing rests a moment before it reads.
  useEffect(() => {
    const wanted = query.trim();
    if (wanted === searched) return;
    const timer = globalThis.setTimeout(() => setSearched(wanted), SEARCH_WAIT_MS);
    return () => globalThis.clearTimeout(timer);
  }, [query, searched]);
  // Nothing to show: ask once whether the address is free. Only `free` from the server ever shows the offer, so a
  // read that failed, and every other reason, settle on the plain not found. The not found card holds its loading
  // shape while the answer is out: it is the likelier of the two, and the page cannot know which is coming, so the
  // offer does change the shape when it lands.
  useEffect(() => {
    if (loaded.state !== 'checking') return;
    let isLive = true;
    client.offer(handle).then(
      (offer) => {
        if (isLive) setLoaded({ state: offer.status === 'free' ? 'free' : 'gone' });
      },
      () => {
        if (isLive) setLoaded({ state: 'gone' });
      },
    );
    return () => {
      isLive = false;
    };
  }, [client, handle, loaded.state]);
  // The back and forward buttons move between open sections, so the page follows the address rather than owning it.
  useEffect(() => {
    const follow = () => {
      setOpenFolder(folderInAddress());
    };
    globalThis.addEventListener('hashchange', follow);
    return () => {
      globalThis.removeEventListener('hashchange', follow);
    };
  }, []);
  // A page opened at `#<block id>` scrolls that section into view once its row has drawn (AC-5417).
  useEffect(() => {
    const wanted = scrollTo.current;
    if (wanted === undefined || loaded.state !== 'ready') return;
    const row = document.getElementById(wanted);
    if (row === null) return;
    scrollTo.current = undefined;
    row.scrollIntoView({ block: 'center' });
  }, [loaded.state]);
  useEffect(() => {
    // The tab says what the heading says, with the product, as the booking pages' tabs do (QA Q76).
    if (loaded.state === 'ready') document.title = tabTitle(loaded.profile.name);
    else if (loaded.state === 'free') document.title = tabTitle(strings.handleFreeTab(addressOf(handle)));
    // Nothing while the free read is out: the tab is the one place a premature answer would be read as words.
    else if (loaded.state === 'gone') document.title = tabTitle(strings.notFoundTitle);
    else if (loaded.state === 'failed') document.title = tabTitle(strings.failedTitle);
  }, [handle, loaded]);

  const more = () => {
    if (loaded.state !== 'ready' || loaded.next === undefined || isMoreLoading) return;
    const ticket = latest.current;
    setMoreLoading(true);
    setMoreFailed(false);
    client
      .profile(handle, { after: loaded.next })
      .then(
        (page) => {
          if (ticket !== latest.current) return;
          setLoaded({
            state: 'ready',
            profile: loaded.profile,
            // A block the owner moved since the last page can come back: each shows once.
            items: [...loaded.items, ...page.items.filter((item) => !loaded.items.some((each) => each.id === item.id))],
            ...(page.next === undefined ? {} : { next: page.next }),
          });
        },
        () => {
          if (ticket === latest.current) setMoreFailed(true);
        },
      )
      .finally(() => setMoreLoading(false));
  };

  if (loaded.state === 'free') {
    return <BookingHandleOffer address={addressOf(handle)} handle={handle} claimHref={claimHandleHref(handle)} />;
  }
  if (loaded.state === 'checking') {
    // The not found card's own shape while the one remaining question is asked.
    return <BookingMessage title={strings.notFoundTitle} page="booking_profile" isLoading />;
  }
  if (loaded.state === 'gone') {
    return (
      <BookingMessage title={strings.notFoundTitle} page="booking_profile">
        {strings.profileNotFound}
      </BookingMessage>
    );
  }
  if (loaded.state === 'failed') {
    return (
      <BookingMessage title={strings.failedTitle} page="booking_profile" onRetry={() => load(searched)}>
        {strings.failedText}
      </BookingMessage>
    );
  }
  // While loading: the person's and the blocks' own shapes at once (this is the page's first paint, so there is no
  // content for a skeleton to flash in front of), so nothing moves when they arrive.
  if (loaded.state === 'loading')
    return <LinkPage foot={<BookingFoot page="booking_profile" claimHref={claimPageHref('booking_profile')} />} />;

  const { profile, items } = loaded;
  const current = profile.handle;
  const isSearching = searched !== '';
  const blocks = blocksOf(current, items);
  return (
    <LinkPage
      person={{
        name: profile.name,
        id: current,
        bio: profile.bio,
        // Our own origin's copy of their account picture; the initials show if it fails.
        ...(profile.image === undefined ? {} : { image: profile.image }),
      }}
      // The page's own address, as a visitor reads it, with a press to copy it.
      address={{ label: addressOf(current), value: `${globalThis.location.origin}/${current}` }}
      share={<ShareButton address={`${globalThis.location.origin}/${current}`} name={profile.name} />}
      // Their own set of networks, the row of circles under the actions (booking socials): never a block.
      {...(profile.socials === undefined || profile.socials.length === 0
        ? {}
        : {
            socials: <SocialLinks variant="round" links={profile.socials} label={strings.socials(profile.name)} />,
          })}
      blocks={blocks}
      // The look its owner picked (spec 0054), which lands with the content, in one step.
      theme={profile.theme}
      // The open section, and the address it is kept in. `pushState` so the back button closes it (AC-5417).
      {...(openFolder === undefined ? {} : { openFolder })}
      onOpenFolder={(id) => {
        setOpenFolder(id);
        const { pathname, search } = globalThis.location;
        globalThis.history.pushState(
          null,
          '',
          id === undefined ? `${pathname}${search}` : `${pathname}${search}#${id}`,
        );
      }}
      {...(isSearching ? { summary: strings.matches(blocks.length) } : {})}
      foot={footOf(profile.theme.mode)}
      // A press is counted by a beacon (AC-5125): the navigation never waits for it.
      onPress={(id) => client.press(current, id)}
      {...(isLong
        ? {
            toolbar: <LinkListToolbar searchLabel={strings.searchLinks} query={query} onQueryChange={setQuery} />,
          }
        : {})}
      empty={
        <EmptyState
          title={isSearching ? strings.noMatchesTitle(searched) : strings.noLinksTitle}
          icon={isSearching ? 'search' : 'link'}
        >
          {isSearching ? strings.noMatchesText : strings.noLinksText}
        </EmptyState>
      }
      after={
        <>
          {searchFailed && <Callout tone="danger">{strings.searchFailed}</Callout>}
          {moreFailed && <Callout tone="danger">{strings.moreFailed}</Callout>}
          {!isSearching && loaded.next !== undefined && (
            <Button isPending={isMoreLoading} onPress={more}>
              {strings.showMore}
            </Button>
          )}
        </>
      }
    />
  );
}
