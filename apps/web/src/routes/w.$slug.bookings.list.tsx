import { isDataError, type BookingPageView, type MeetingsQuery, type ObjectSummary } from '@crm/data';
import { LoadingNow, useFormatSettings } from '@crm/ui';
import { useEffect, useMemo } from 'react';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingsFailed, BookingsListScreen } from '../features/bookings/BookingsScreen.tsx';
import { bookingsSearchOf, parseBookingsSearch, rawOf, type BookingsSearch } from '../features/bookings/search.ts';
import { strings } from '../features/bookings/strings.ts';
import { hostActions } from '../features/bookings/hostActions.ts';
import { useFirstDay } from '../features/workspace/first-day.ts';
import { weekOf } from '../features/bookings/week.ts';
import { memberZone } from '../features/booking/zone.ts';
import { useBookingsHosts } from '../features/bookings/toolbarSlot.ts';
import { useCan } from '../features/workspace/WorkspacePage.tsx';

// Bookings › List (spec 0025, AC-646; every meeting, the owner's ask of 21 October 2026): Upcoming, Past (`tab=past`)
// or Cancelled (`tab=cancelled`), All, Bookings or Calendar (`src`), one booking page (`link`) and the calendars the
// panel picks (`cal`), a page at a time (More). The loader waits for the list's first page through the data layer;
// the screen holds it, so it is read again whenever the person comes back to the page. Changing the tab or the source
// changes only the search, never the loader's deps, so the screen stays. The Bookings layout draws the frame, the
// TopBar and the tabs.
export const Route = createFileRoute('/w/$slug/bookings/list')({
  validateSearch: parseBookingsSearch,
  loaderDeps: () => ({}),
  loader: async ({ context, params, location }) => {
    const { data } = context;
    // The list reads by tab and link, never by week; the week start and zone only fill the defaults.
    const search = bookingsSearchOf(parseBookingsSearch(location.search), new Date(), 1, memberZone(data, params.slug));
    const [objects, pages, visible] = await Promise.all([
      data.objects.list(params.slug),
      data.bookingPages.held(params.slug).catch(() => []),
      // Everyone the reader may see (the calendar reads the same), for whether Meetings' switch offers Team.
      data.scheduling
        .open()
        .then((scheduling) => scheduling.visible(params.slug))
        .catch(() => []),
      // Mine, the default whoever reads (an admin's kept Everyone is the screen's to ask for).
      data.bookings.meetings(params.slug, queryOf(search)).ready(),
    ]);
    return { objects, pages, seesTeam: visible.length >= 2 };
  },
  pendingComponent: ListPending,
  errorComponent: ListError,
  component: ListRoute,
});

/** The list's question from the address: the tab, the source and the calendars picked. */
function queryOf(search: BookingsSearch): MeetingsQuery {
  return {
    // Requests read on their own (the screen's); the list behind them is Upcoming's.
    when: search.tab === 'requests' ? 'upcoming' : search.tab,
    source: search.source,
    ...(search.cal === undefined ? {} : { calendarIds: search.cal }),
  };
}

/** What the loader read beside the lists. */
interface ListLoaded {
  readonly objects: readonly ObjectSummary[];
  readonly pages: readonly BookingPageView[];
  /** The reader sees a colleague's day, so Meetings' switch offers Team (as the calendar's does). */
  readonly seesTeam: boolean;
}

function ListRoute() {
  return <List {...Route.useLoaderData()} />;
}

/**
 * While the page loads (shown only once the loading delay passed, so its skeleton shows at once): the screen
 * itself, its list loading under its own bar, so the page lands exactly where its skeleton stood.
 */
function ListPending() {
  return (
    <LoadingNow>
      <List objects={[]} pages={[]} seesTeam={false} />
    </LoadingNow>
  );
}

function List({ objects, pages, seesTeam }: ListLoaded) {
  const { slug } = Route.useParams();
  const { timeZone } = useFormatSettings();
  const firstDay = useFirstDay();
  const search = bookingsSearchOf(Route.useSearch(), new Date(), firstDay, timeZone);
  const navigate = useNavigate();
  const { data, toasts } = Route.useRouteContext();
  // One set of calls per workspace: a dialog holding them never reads again because the route drew again.
  const actions = useMemo(() => hostActions(data, toasts, slug, objects), [data, toasts, slug, objects]);
  // Requests (spec 0062) through the data layer, one set per workspace, so the tab never reads again for a redraw.
  const requests = useMemo(
    () => ({
      list: (pageId: string) => data.bookingFlow.requests(slug, pageId),
      confirm: (bookingId: string) => data.bookingFlow.confirm(slug, bookingId),
      decline: (bookingId: string, reason?: string) => data.bookingFlow.decline(slug, bookingId, reason),
    }),
    [data, slug],
  );
  // Bookings guests make while the list is open, one listener per workspace (the toast's own is the layout's).
  const arrivals = useMemo(
    () => (listener: (arrival: { readonly bookingId: string }) => void) => data.bookings.arrivals(slug, listener),
    [data, slug],
  );
  // Mine or Everyone: an admin's choice, the layout's (its switch is on the strip); anyone else sees their own.
  const choice = useBookingsHosts();
  // Team where the calendar offers it: a colleague to see, or someone the reader could invite.
  const canInvite = useCan('members.invite');
  // An email's, the Inbox's or the arrival toast's link to one booking (B-20) opens its card, then leaves the
  // address, so a reload or Back doesn't open it again after it was closed.
  const asked = Route.useSearch().open;
  useEffect(() => {
    if (asked === undefined) return;
    void navigate({ to: '/w/$slug/bookings/list', params: { slug }, replace: true, search: rawOf('list', search) });
    // Only when a link asks: the rest of the address is already the screen's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  return (
    <BookingsListScreen
      slug={slug}
      hosts={choice}
      search={search}
      meetings={(query) => data.bookings.meetings(slug, query)}
      arrivals={arrivals}
      calendars={data.calendar.calendars(slug)}
      onDismissNotice={() => void data.calendar.dismissCalendarNotice(slug)}
      objects={objects}
      pages={pages}
      locale={navigator.languages[0] ?? 'en-GB'}
      actions={actions}
      requests={requests}
      openFirst={asked}
      calendarViews={seesTeam || canInvite ? ['day', 'week', 'team'] : ['day', 'week']}
      onCalendarView={(view, day) =>
        void navigate({
          to: '/w/$slug/bookings/calendar',
          params: { slug },
          search: rawOf('calendar', {
            ...search,
            view,
            ...(day === undefined ? {} : { day, week: weekOf(day, firstDay) }),
          }),
        })
      }
      onSearch={(next) =>
        void navigate({
          to: '/w/$slug/bookings/list',
          params: { slug },
          replace: true,
          search: rawOf('list', { ...search, ...next }),
        })
      }
    />
  );
}

function ListError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <BookingsFailed
      message={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
