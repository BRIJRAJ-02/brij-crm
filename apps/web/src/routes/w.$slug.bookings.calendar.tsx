import {
  isDataError,
  type BookingAvailability,
  type BookingHosts,
  type BookingPageView,
  type BookingsCalendarHeld,
  type CalendarConnectionView,
  type DataLayer,
  type ObjectSummary,
} from '@crm/data';
import { LoadingNow, useFormatSettings } from '@crm/ui';
import { useEffect, useMemo, useRef } from 'react';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BookingsCalendarScreen, BookingsFailed } from '../features/bookings/BookingsScreen.tsx';
import { bookingsSearchOf, parseBookingsSearch, rawOf } from '../features/bookings/search.ts';
import { strings } from '../features/bookings/strings.ts';
import { hostActions } from '../features/bookings/hostActions.ts';
import { openHoursOf, workingStartOf } from '../features/bookings/span.ts';
import { addDays, weekRange } from '../features/bookings/week.ts';
import { memberZone } from '../features/booking/zone.ts';
import { firstDayFor, useFirstDay } from '../features/workspace/first-day.ts';
import { peopleSearchOf } from '../features/bookings/people.ts';
import { useBookingsHosts } from '../features/bookings/toolbarSlot.ts';

// Bookings › Calendar (spec 0025, AC-646): the week (`w`, its Monday; `d`, the day picked) with the reader's own
// calendar events beside the bookings, filtered by `link` (one booking page) and `cal` (the calendars the panel shows). The
// loader waits for the week's first read through the data layer; the screen holds it, so it is read again whenever
// the person comes back to the page (bookings have no change event yet). The Bookings layout draws the frame, the
// TopBar and the tabs. Paging weeks changes only the search, never the loader's deps: the screen stays and holds the
// next week's read (primed on entry for the weeks either side), so the toolbar never gives way to the pending page.
export const Route = createFileRoute('/w/$slug/bookings/calendar')({
  // One chunk for the page, its loading and its failure (the first load carries one import for it, not three).
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  validateSearch: parseBookingsSearch,
  loaderDeps: () => ({}),
  loader: async ({ context, params, location }) => {
    const { data } = context;
    // The member's week start (read by the workspace frame already); a failed read starts on Monday's rule.
    const preferences = await data.preferences.load(params.slug).catch(() => undefined);
    // The member's zone (their Preferences, else the browser's): the week's days, its range and its hours.
    const zone = memberZone(data, params.slug);
    const shown = bookingsSearchOf(
      parseBookingsSearch(location.search),
      new Date(),
      firstDayFor(preferences?.weekStart),
      zone,
    ).week;
    // Mine, the default whoever reads (an admin's kept Everyone is the screen's to ask for).
    const week = heldWeek(shown, data, params.slug, zone);
    // The weeks either side, read behind, so Previous and Next show at once.
    for (const step of [-7, 7])
      heldWeek(addDays(shown, step), data, params.slug, zone)
        .ready()
        .catch(() => undefined);
    const calendar = data.calendar.view(params.slug);
    const [objects, pages, hours, , , visible] = await Promise.all([
      data.objects.list(params.slug),
      // The Link filter's choices; a member without booking pages has none.
      data.bookingPages.held(params.slug).catch(() => []),
      // Where a day starts when time is drawn from the keyboard; without it, 9:00.
      data.bookings.hours(params.slug, zone).catch(() => undefined),
      week.ready(),
      calendar.ready().catch(() => undefined),
      // Whom the member Manages, for For on Block time and New meeting (spec 0037, AC-1272); none when it fails.
      data.scheduling
        .open()
        .then((scheduling) => scheduling.visible(params.slug))
        .catch(() => []),
    ]);
    const state = calendar.getSnapshot();
    const connections = state.status === 'ready' ? state.connections.filter((each) => each.status !== 'revoked') : [];
    // The caller comes first in their own reach: For lists the others they Manage.
    const forPeople = visible.slice(1).filter((member) => member.canManage);
    return { objects, pages, connections, availability: hours?.availability, forPeople };
  },
  pendingComponent: CalendarPending,
  errorComponent: CalendarError,
  component: CalendarRoute,
});

/**
 * The data layer's held read of the week starting on `monday` in `zone`, of `hosts`' bookings: the same one for the
 * same week, every time.
 */
function heldWeek(
  monday: string,
  data: DataLayer,
  slug: string,
  zone: string,
  hosts?: BookingHosts,
): BookingsCalendarHeld {
  const range = weekRange(monday, zone);
  return data.bookings.calendar(slug, range.from, range.to, hosts);
}

/** What the loader read beside the week. */
interface CalendarLoaded {
  readonly objects: readonly ObjectSummary[];
  readonly pages: readonly BookingPageView[];
  readonly connections: readonly CalendarConnectionView[];
  readonly availability: BookingAvailability | undefined;
  /** The colleagues the member Manages: For on Block time and New meeting (AC-1272). */
  readonly forPeople: readonly { readonly id: string; readonly name: string }[];
}

function CalendarRoute() {
  return <Calendar {...Route.useLoaderData()} />;
}

/**
 * While the page loads (shown only once the loading delay passed, so its skeleton shows at once): the screen
 * itself, its week loading under its own toolbar, so the page lands exactly where its skeleton stood.
 */
function CalendarPending() {
  return (
    <LoadingNow>
      <Calendar objects={[]} pages={[]} connections={[]} availability={undefined} forPeople={[]} />
    </LoadingNow>
  );
}

function Calendar({ objects, pages, connections, availability, forPeople }: CalendarLoaded) {
  const { slug } = Route.useParams();
  // The member's zone, as the workspace frame's FormatScope holds it (their Preferences, else the browser's).
  const { timeZone } = useFormatSettings();
  const search = bookingsSearchOf(Route.useSearch(), new Date(), useFirstDay(), timeZone);
  const navigate = useNavigate();
  const { data, toasts } = Route.useRouteContext();
  // One set of calls per workspace: a dialog holding them never reads again because the route drew again.
  const actions = useMemo(() => hostActions(data, toasts, slug, objects), [data, toasts, slug, objects]);
  // Mine or Everyone: an admin's choice, the layout's (its switch is on the strip); anyone else sees their own.
  const choice = useBookingsHosts();
  const hosts = choice?.value ?? 'mine';
  const week = heldWeek(search.week, data, slug, timeZone, hosts);
  // The member's zone changed in Preferences while the page is open: the loader primed the weeks either side in the
  // old one, so prime them again in the new one (each held read is the same one for the same range).
  // Mine or Everyone changed too: the weeks either side of the new choice.
  const primed = useRef({ timeZone, hosts });
  useEffect(() => {
    if (primed.current.timeZone === timeZone && primed.current.hosts === hosts) return;
    primed.current = { timeZone, hosts };
    for (const step of [-7, 7])
      heldWeek(addDays(search.week, step), data, slug, timeZone, hosts)
        .ready()
        .catch(() => undefined);
  }, [data, slug, timeZone, search.week, hosts]);
  return (
    <BookingsCalendarScreen
      slug={slug}
      hosts={choice}
      search={search}
      week={week}
      objects={objects}
      pages={pages}
      connections={connections}
      calendars={data.calendar.calendars(slug)}
      onDismissNotice={() => void data.calendar.dismissCalendarNotice(slug)}
      locale={navigator.languages[0] ?? 'en-GB'}
      onRemoveBlock={(blockId) => data.bookings.blocks.remove(slug, blockId)}
      onBlock={(draft, preview) => data.bookings.blocks.create(slug, draft, preview)}
      workingStart={(dayKey) => workingStartOf(availability, dayKey)}
      openHours={(dayKey) => openHoursOf(availability, dayKey, timeZone)}
      onBookAsHost={(meeting) => data.bookings.bookAsHost(slug, { ...meeting, guests: [...meeting.guests] })}
      peopleSearch={peopleSearchOf(data, slug, objects)}
      pageDestination={(pageId) => data.calendar.pageDestination(slug, pageId)}
      newBookingKey={data.bookings.newKey}
      forPeople={forPeople}
      toasts={toasts}
      actions={actions}
      onSearch={(next) =>
        void navigate({
          to: '/w/$slug/bookings/calendar',
          params: { slug },
          replace: true,
          search: rawOf('calendar', { ...search, ...next }),
        })
      }
    />
  );
}

function CalendarError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <BookingsFailed
      message={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
