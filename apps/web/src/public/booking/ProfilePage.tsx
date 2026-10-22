// Brief
// Purpose: a person's public profile at /<handle> (22 Oct 2026, the Cal.com profile): who they are and what can be booked.
// Main task: pick one of their Public booking links; the whole row opens it at /<handle>/<slug>.
// Leaves out: Link only pages (they work by address but are never listed), booking itself (each link's page), and
// any count of links (read a page at a time, never all at once).
import { createHandleClient, isDataError, type PublicProfile, type PublicProfileLink } from '@crm/data/booking';
import {
  BookingMessage,
  BookingProfile,
  BookingProfileSection,
  Button,
  Callout,
  EmptyState,
  LinkList,
  LinkListToolbar,
  type LinkRow,
} from '@crm/ui/public-booking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { strings } from './strings.ts';

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
  | { readonly state: 'gone' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'ready';
      readonly profile: PublicProfile;
      readonly links: readonly PublicProfileLink[];
      readonly next?: string;
    };

/** The links grouped by their section, in the owner's order: each section where its first link is. */
export function sectionsOf(
  links: readonly PublicProfileLink[],
): readonly { readonly title?: string; readonly links: readonly PublicProfileLink[] }[] {
  const groups = new Map<string, PublicProfileLink[]>();
  for (const link of links) {
    const key = link.section ?? '';
    const group = groups.get(key) ?? [];
    group.push(link);
    groups.set(key, group);
  }
  return [...groups].map(([title, grouped]) => ({ ...(title === '' ? {} : { title }), links: grouped }));
}

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
            return { state: isDataError(error) && error.code === 'NOT_FOUND' ? 'gone' : 'failed' };
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
  useEffect(() => {
    if (loaded.state === 'ready') document.title = loaded.profile.name;
  }, [loaded]);

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

  if (loaded.state === 'gone') {
    return <BookingMessage title={strings.notFoundTitle}>{strings.profileNotFound}</BookingMessage>;
  }
  if (loaded.state === 'failed') {
    return (
      <BookingMessage title={strings.failedTitle} onRetry={() => load(searched)}>
        {strings.failedText}
      </BookingMessage>
    );
  }
  if (loaded.state === 'loading') {
    // The card and the rows as skeletons, so nothing moves when they arrive.
    return (
      <BookingProfile>
        <LinkList
          label={strings.profileLinks}
          searchLabel={strings.searchLinks}
          isToolbarHidden
          status="loading"
          rows={[]}
          onOpen={() => undefined}
        />
      </BookingProfile>
    );
  }

  const { profile, links } = loaded;
  const current = profile.handle;
  const open = (slug: string) => {
    globalThis.location.assign(`/${encodeURIComponent(current)}/${encodeURIComponent(slug)}`);
  };
  const sections = sectionsOf(links);
  return (
    <BookingProfile
      person={{
        name: profile.name,
        id: current,
        bio: profile.bio,
      }}
      claimHref="https://timefix.ai"
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
          <BookingProfileSection
            key={section.title ?? ''}
            {...(section.title === undefined ? {} : { title: section.title })}
          >
            <LinkList
              label={section.title === undefined ? strings.profileLinks : strings.sectionLinks(section.title)}
              searchLabel={strings.searchLinks}
              isToolbarHidden
              rows={section.links.map((link) => rowOf(current, link))}
              onOpen={open}
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
