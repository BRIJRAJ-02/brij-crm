// Brief
// Purpose: a person's public profile at /<handle> (22 Oct 2026, the Cal.com profile): who they are and what can be booked.
// Main task: pick one of their Public booking links; the whole row opens it at /<handle>/<slug>.
// Leaves out: Link only pages (they work by address but are never listed), booking itself (each link's page), and
// any count of links (read a page at a time, never all at once).
//
// An address nobody holds (25 Oct 2026): the page asks the server once, and only once a profile read answered
// NOT_FOUND, whether the address is free; `free` turns the dead end into the offer to claim it, and `absent` keeps
// the plain not found. A word kept for Timefix and a handle somebody holds (listed or not) both answer `absent`, so
// nothing here can say that a private account is behind an address.
import { createHandleClient, isDataError, type PublicProfile, type PublicProfileLink } from '@crm/data/booking';
import {
  BookingHandleOffer,
  BookingMessage,
  BookingProfile,
  BookingProfileSection,
  Button,
  Callout,
  claimPageHref,
  EmptyState,
  LinkList,
  LinkListToolbar,
  LoadingNow,
  type LinkRow,
} from '@crm/ui/public-booking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { claimHandleHref } from './claim.ts';
import { sectionsOf } from './sections.ts';
import { strings, tabTitle } from './strings.ts';

/** The address as the visitor reads it in the bar: the host they are on, then the handle. */
function addressOf(handle: string): string {
  return `${globalThis.location.host}/${handle}`;
}

/** Past this many links, a search sits above the list. */
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
      readonly links: readonly PublicProfileLink[];
      readonly next?: string;
    };

/** A link as a row: its title, description and lengths, and Team for a team page. */
function rowOf(handle: string, link: PublicProfileLink): LinkRow {
  return {
    id: link.slug,
    title: link.title,
    address: '',
    ...(link.description === '' ? {} : { description: link.description }),
    chips: [...link.durations.map((minutes) => strings.minutesShort(minutes)), ...(link.isTeam ? [strings.team] : [])],
    href: `/${encodeURIComponent(handle)}/${encodeURIComponent(link.slug)}`,
  };
}

/** The profile: the person's card, then their Public links a page at a time, with a search once there are many. */
export function ProfilePage({ handle, onMoved }: ProfilePageProps) {
  const client = useMemo(() => createHandleClient({ origin: globalThis.location.origin }), []);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [isMoreLoading, setMoreLoading] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  // A search that failed: said under the search, the profile stays.
  const [searchFailed, setSearchFailed] = useState(false);
  // Whether the unsearched list is long enough for a search: once true, it stays while the person searches.
  const [isLong, setLong] = useState(false);
  // Only the newest read lands: a slow answer to an older search never replaces a newer one.
  const latest = useRef(0);

  const load = useCallback(
    (search: string) => {
      const ticket = (latest.current += 1);
      client.profile(handle, search === '' ? {} : { q: search }).then(
        (profile) => {
          if (ticket !== latest.current) return;
          if (profile.handle !== handle) onMoved(profile.handle);
          if (search === '' && (profile.links.length > SEARCH_FROM || profile.next !== undefined)) setLong(true);
          setMoreFailed(false);
          setSearchFailed(false);
          setLoaded({
            state: 'ready',
            profile,
            links: profile.links,
            ...(profile.next === undefined ? {} : { next: profile.next }),
          });
        },
        (error: unknown) => {
          if (ticket !== latest.current) return;
          // Only the first read takes the page: a search that fails says so under the search.
          setLoaded((was) => {
            if (was.state === 'ready') {
              setSearchFailed(true);
              return was;
            }
            // Nothing to show: which of the three reasons comes next, from the server (the effect below).
            return { state: isDataError(error) && error.code === 'NOT_FOUND' ? 'checking' : 'failed' };
          });
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
  // offer does change the shape when it lands. If that read ever gets slow, the honest fix is to answer it in the
  // profile read itself rather than to dress up the swap.
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
      .profile(handle, { after: loaded.next, ...(searched === '' ? {} : { q: searched }) })
      .then(
        (page) => {
          if (ticket !== latest.current) return;
          setLoaded({
            state: 'ready',
            profile: loaded.profile,
            links: [...loaded.links, ...page.links],
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
  if (loaded.state === 'loading') {
    // The person's card and the links' own rows as skeletons, so nothing moves when they arrive. The rows are
    // drawn at once rather than after the loading delay: this is the page's first paint, so there is no content
    // for a skeleton to flash in front of.
    return (
      <BookingProfile claimHref={claimPageHref('booking_profile')}>
        <LoadingNow>
          <LinkList
            label={strings.profileLinks}
            searchLabel={strings.searchLinks}
            isToolbarHidden
            status="loading"
            rows={[]}
            onOpen={() => undefined}
          />
        </LoadingNow>
      </BookingProfile>
    );
  }

  const { profile, links } = loaded;
  const current = profile.handle;
  const sections = sectionsOf(links);
  return (
    <BookingProfile
      person={{
        name: profile.name,
        id: current,
        bio: profile.bio,
        // Our own origin's copy of their account picture; the initials show if it fails.
        ...(profile.image === undefined ? {} : { image: profile.image }),
        ...(profile.socials === undefined ? {} : { socials: profile.socials }),
      }}
      claimHref={claimPageHref('booking_profile')}
    >
      {isLong && <LinkListToolbar searchLabel={strings.searchLinks} query={query} onQueryChange={setQuery} />}
      {searchFailed && <Callout tone="danger">{strings.searchFailed}</Callout>}
      {links.length === 0 ? (
        <EmptyState
          title={searched === '' ? strings.noLinksTitle : strings.noMatchesTitle(searched)}
          icon={searched === '' ? 'calendar-clock' : 'search'}
        >
          {searched === '' ? strings.noLinksText : strings.noMatchesText}
        </EmptyState>
      ) : (
        sections.map((section) => (
          <BookingProfileSection key={section.key} {...(section.title === undefined ? {} : { title: section.title })}>
            <LinkList
              label={section.title === undefined ? strings.profileLinks : strings.sectionLinks(section.title)}
              searchLabel={strings.searchLinks}
              isToolbarHidden
              rowsAreLinks
              rows={section.links.map((link) => rowOf(current, link))}
              onOpen={() => undefined}
            />
          </BookingProfileSection>
        ))
      )}
      {moreFailed && <Callout tone="danger">{strings.moreFailed}</Callout>}
      {loaded.next !== undefined && (
        <Button isPending={isMoreLoading} onPress={more}>
          {strings.showMore}
        </Button>
      )}
    </BookingProfile>
  );
}
