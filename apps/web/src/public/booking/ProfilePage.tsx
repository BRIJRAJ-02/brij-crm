// Brief
// Purpose: a person's link page at /<handle> (spec 0051, built as blocks): the one address they hand over at an event,
// who they are, how to book them, and where else to find them.
// Main task: a visitor presses one block (a booking page, a link) and lands where they meant to go.
// Leaves out: Link only booking pages (never listed), booking itself (each page's own), the contact card and the
// press counter (later phases), and any count of blocks (read a page at a time, never all at once).
import { createHandleClient, isDataError, type PublicProfile, type PublicProfileItem } from '@crm/data/booking';
import {
  BookingFoot,
  BookingMessage,
  Button,
  Callout,
  claimPageHref,
  EmptyState,
  LinkListToolbar,
  LinkPage,
  SocialLinks,
} from '@crm/ui/public-booking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blocksOf } from './link-page.ts';
import { strings, tabTitle } from './strings.ts';

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
  | { readonly state: 'gone' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'ready';
      readonly profile: PublicProfile;
      readonly items: readonly PublicProfileItem[];
      readonly next?: string;
    };

/** The link page: the person, then their blocks a page at a time, with a search once there are many. */
/** The page's foot: "Powered by Timefix", tagged as the profile, and Claim your free page. */
const foot = <BookingFoot page="booking_profile" claimHref={claimPageHref('booking_profile')} />;

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
          setLoaded({ state: isDataError(error) && error.code === 'NOT_FOUND' ? 'gone' : 'failed' });
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
  useEffect(() => {
    // The tab says what the heading says, with the product, as the booking pages' tabs do (QA Q76).
    if (loaded.state === 'ready') document.title = tabTitle(loaded.profile.name);
    else if (loaded.state === 'gone') document.title = tabTitle(strings.notFoundTitle);
    else if (loaded.state === 'failed') document.title = tabTitle(strings.failedTitle);
  }, [loaded]);

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
  if (loaded.state === 'loading') return <LinkPage foot={foot} />;

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
      // Their own set of networks, the row of icons under the bio (booking socials): never a block.
      {...(profile.socials === undefined || profile.socials.length === 0
        ? {}
        : { socials: <SocialLinks links={profile.socials} label={strings.socials(profile.name)} /> })}
      blocks={blocks}
      {...(isSearching ? { summary: strings.matches(blocks.length) } : {})}
      foot={foot}
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
