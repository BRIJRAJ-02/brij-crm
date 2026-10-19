// Brief
// Purpose: Bookings (spec 0025, AC-646), on the reference product's bookings page: a week calendar (bookings and the member's own calendar events) and a list (Upcoming, Past, Canceled) with sort and pages.
// Main task: see the week at a glance, open a booking or an event for its details, or page through the list.
// Leaves out: changing a booking from here (the actions arrive next), the new meeting dialog, team views and filing, and live arrival (it reads again when the page is shown again).
import type {
  BookingListItem,
  BookingPageView,
  BookingsCalendarHeld,
  BookingsTab,
  BookingsView,
  CalendarConnectionView,
  CalendarEventItem,
  ObjectSummary,
} from '@crm/data';
import { useBookings, useBookingsCalendar } from '@crm/data/react';
import {
  Badge,
  BookingList,
  Button,
  Callout,
  DescriptionList,
  EmptyState,
  Link,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  PageColumn,
  Pagination,
  Panel,
  SectionBar,
  SegmentedControl,
  Skeleton,
  TabPanel,
  Tabs,
  TopBar,
  WeekCalendar,
  type BookingListGroup,
  type Hue,
  type WeekCalendarBlock,
} from '@crm/ui';
import { useEffect, useState } from 'react';
import { availabilityHref } from '../booking/links.ts';
import { linksHref } from '../captures/tabs.ts';
import { recordLinks, type RecordLink } from '../records/timeline.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';
import {
  addDays,
  bookingPieces,
  dayKeyOf,
  eventPieces,
  rangeLabel,
  scrollMinute,
  timeRange,
  weekDays,
  weekOf,
} from './week.ts';

export type { BookingsTab };

/** The list's tabs, in order. */
export const TABS: readonly BookingsTab[] = ['upcoming', 'past', 'cancelled'];

/** Rows per page the list offers. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;

/** What the address holds: the view, the week and day, the tab, the page, the sort and the filters. */
export interface BookingsSearch {
  readonly view: 'week' | 'list';
  /** The Monday of the week shown (`yyyy-MM-dd`). */
  readonly week: string;
  /** The day selected (a narrow screen shows it alone). */
  readonly day: string;
  readonly tab: BookingsTab;
  readonly page: number;
  readonly per: number;
  /** `asc` soonest first; `desc` latest first. Upcoming defaults to asc, Past to desc. */
  readonly sort?: 'asc' | 'desc';
  /** One booking page's bookings only. */
  readonly link?: string;
  /** The connections whose events show; absent is all of them. */
  readonly conn?: readonly string[];
}

/** Props for Bookings: the held reads, the address, and what the filters offer. */
export interface BookingsScreenProps {
  readonly slug: string;
  readonly search: BookingsSearch;
  readonly lists: Readonly<Record<BookingsTab, BookingsView>>;
  readonly week: BookingsCalendarHeld;
  readonly objects: readonly ObjectSummary[];
  readonly pages: readonly BookingPageView[];
  readonly connections: readonly CalendarConnectionView[];
  readonly locale: string;
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
}

/** Each connection's hue, in the order they were connected. */
const CALENDAR_HUES: readonly Hue[] = ['blue', 'green', 'purple', 'orange', 'sky', 'yellow', 'red', 'lime'];

/** Who provides a meeting link, from its host. */
function providerOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return strings.providers.other;
  }
  if (host === 'meet.google.com') return strings.providers.google;
  if (host.endsWith('teams.microsoft.com') || host.endsWith('teams.live.com')) return strings.providers.microsoft;
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) return strings.providers.zoom;
  return strings.providers.other;
}

/** Where a booking happens, as a line. */
function whereOf(booking: BookingListItem): string {
  switch (booking.location.type) {
    case 'video':
      return booking.videoUrl ?? strings.video;
    case 'phone':
      return strings.phone;
    default:
      return booking.location.value;
  }
}

/** The person's page, when the booking names one and the reader can open People. */
function personHrefOf(booking: BookingListItem, link: RecordLink, people: ObjectSummary | undefined) {
  return booking.personRecordId === undefined || people === undefined
    ? undefined
    : link(people.id, booking.personRecordId);
}

/** "Monday, 19 October · 9:00 – 9:30 AM". */
function whenOf(startsAt: string, endsAt: string, locale: string): string {
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(startsAt),
  );
  return `${day} · ${timeRange(startsAt, endsAt, locale)}`;
}

/** The filters in force: a link, and the calendars shown. */
function filterCount(search: BookingsSearch): number {
  return (search.link === undefined ? 0 : 1) + (search.conn === undefined ? 0 : 1);
}

/** Filter: one link's bookings, and which calendars' events show. */
function FilterMenu({
  search,
  pages,
  connections,
  onSearch,
}: {
  readonly search: BookingsSearch;
  readonly pages: readonly BookingPageView[];
  readonly connections: readonly CalendarConnectionView[];
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
}) {
  if (pages.length < 2 && connections.length < 2) return null;
  const shown = new Set(search.conn ?? connections.map((connection) => connection.id));
  const count = filterCount(search);
  const selected = [
    ...(search.link === undefined ? ['link:all'] : [`link:${search.link}`]),
    ...[...shown].map((id) => `conn:${id}`),
  ];
  return (
    <MenuTrigger>
      <Button icon="list-filter">{count === 0 ? strings.filter : strings.filterCount(count)}</Button>
      <Menu
        label={strings.filterMenu}
        selectionMode="multiple"
        selectedKeys={selected}
        onSelectionChange={(keys) => {
          const next = new Set([...keys].map(String));
          const added = [...next].find((key) => !selected.includes(key));
          const removed = selected.find((key) => !next.has(key));
          const touched = added ?? removed;
          if (touched === undefined) return;
          if (touched.startsWith('link:')) {
            const id = touched.slice(5);
            onSearch({ link: id === 'all' || added === undefined ? undefined : id, page: 1 });
            return;
          }
          const id = touched.slice(5);
          const conn = new Set(shown);
          if (added === undefined) conn.delete(id);
          else conn.add(id);
          onSearch({ conn: conn.size === connections.length ? undefined : [...conn] });
        }}
        onAction={(key) => {
          if (key === 'clear') onSearch({ link: undefined, conn: undefined, page: 1 });
        }}
      >
        {pages.length >= 2 && (
          <MenuSection label={strings.links}>
            <MenuItem id="link:all">{strings.allLinks}</MenuItem>
            {pages.map((page) => (
              <MenuItem key={page.id} id={`link:${page.id}`}>
                {page.title}
              </MenuItem>
            ))}
          </MenuSection>
        )}
        {connections.length >= 2 && (
          <MenuSection label={strings.calendars}>
            {connections.map((connection) => (
              <MenuItem key={connection.id} id={`conn:${connection.id}`}>
                {connection.accountEmail}
              </MenuItem>
            ))}
          </MenuSection>
        )}
        {count > 0 && (
          <>
            <MenuSeparator />
            <MenuItem id="clear">{strings.clearFilters}</MenuItem>
          </>
        )}
      </Menu>
    </MenuTrigger>
  );
}

/** A booking's card: its state, the guest, when, who, the note, and Join call. */
function BookingCard({
  booking,
  personHref,
  locale,
}: {
  readonly booking: BookingListItem;
  readonly personHref: string | undefined;
  readonly locale: string;
}) {
  return (
    <>
      <Badge text={strings.status[booking.status]} tone={booking.status === 'confirmed' ? 'accent' : 'neutral'} />
      {booking.eventFailed && booking.status === 'confirmed' && <Callout tone="warning">{strings.eventFailed}</Callout>}
      <DescriptionList
        layout="stacked"
        items={[
          {
            term: booking.pageTitle,
            description:
              personHref === undefined ? booking.visitorName : <Link href={personHref}>{booking.visitorName}</Link>,
          },
          { term: strings.when, description: whenOf(booking.startsAt, booking.endsAt, locale) },
          {
            term: strings.who,
            description: <Link href={`mailto:${booking.visitorEmail}`}>{booking.visitorEmail}</Link>,
          },
          ...(booking.guests.length === 0 ? [] : [{ term: strings.guests, description: booking.guests.join(', ') }]),
          {
            term: strings.where,
            description:
              booking.videoUrl === undefined ? (
                whereOf(booking)
              ) : (
                <Link href={booking.videoUrl}>{booking.videoUrl}</Link>
              ),
          },
          ...(booking.note === undefined ? [] : [{ term: strings.note, description: strings.quoted(booking.note) }]),
          ...(booking.cancelReason === undefined
            ? []
            : [{ term: strings.cancelReason, description: booking.cancelReason }]),
        ]}
      />
      {booking.status === 'confirmed' && booking.videoUrl !== undefined && (
        <Link href={booking.videoUrl}>{`${strings.joinCall}: ${providerOf(booking.videoUrl)}`}</Link>
      )}
    </>
  );
}

/** One of the member's own calendar events: what, when, which calendar, and that Timefix doesn't manage it. */
function EventCard({
  event,
  connection,
  locale,
}: {
  readonly event: CalendarEventItem;
  readonly connection: CalendarConnectionView | undefined;
  readonly locale: string;
}) {
  return (
    <>
      <DescriptionList
        layout="stacked"
        items={[
          { term: strings.when, description: whenOf(event.startsAt, event.endsAt, locale) },
          { term: event.title, description: strings.fromCalendar },
          ...(connection === undefined ? [] : [{ term: strings.calendar, description: connection.accountEmail }]),
          ...(event.location === undefined ? [] : [{ term: strings.where, description: event.location }]),
        ]}
      />
      {event.videoUrl !== undefined && (
        <Link href={event.videoUrl}>{`${strings.joinCall}: ${providerOf(event.videoUrl)}`}</Link>
      )}
    </>
  );
}

/** Calendar | List. */
function ViewSwitch({
  view,
  onSearch,
}: {
  readonly view: 'week' | 'list';
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
}) {
  return (
    <SegmentedControl
      label={strings.viewLabel}
      value={view}
      onChange={(value) => onSearch({ view: value === 'list' ? 'list' : 'week' })}
      segments={[
        { value: 'week', label: strings.views.week, icon: 'calendar-days' },
        { value: 'list', label: strings.views.list, icon: 'list' },
      ]}
    />
  );
}

/** The minute now, kept up to date while the week shows: on the minute, and when the tab is shown again. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}

/** The week view: Today, previous and next, the range, Filter, then the grid and the week's count. */
function WeekView(
  props: BookingsScreenProps & { readonly personHref: (booking: BookingListItem) => string | undefined },
) {
  const { search, week, pages, connections, locale, onSearch, personHref } = props;
  const state = useBookingsCalendar(week);
  const now = useNow();
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const days = weekDays(search.week);
  const today = dayKeyOf(now);
  const isThisWeek = weekOf(today) === search.week;
  const range = rangeLabel(search.week, locale);
  const shownConnections = new Set(search.conn ?? connections.map((connection) => connection.id));
  const hueOf = new Map(
    connections.map((connection, index) => [connection.id, CALENDAR_HUES[index % CALENDAR_HUES.length] ?? 'blue']),
  );
  const toolbar = (
    <SectionBar
      start={<ViewSwitch view="week" onSearch={onSearch} />}
      title={range}
      end={
        <>
          <Button
            variant="ghost"
            icon="chevron-left"
            label={strings.previousWeek}
            onPress={() => onSearch({ week: addDays(search.week, -7), day: addDays(search.day, -7) })}
          />
          <Button
            variant={isThisWeek ? 'primary' : 'secondary'}
            onPress={() => onSearch({ week: weekOf(today), day: today })}
          >
            {isThisWeek
              ? strings.today
              : strings.todayOn(new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(now))}
          </Button>
          <Button
            variant="ghost"
            icon="chevron-right"
            label={strings.nextWeek}
            onPress={() => onSearch({ week: addDays(search.week, 7), day: addDays(search.day, 7) })}
          />
          <FilterMenu search={search} pages={pages} connections={connections} onSearch={onSearch} />
        </>
      }
    />
  );
  if (state.status === 'loading') {
    return (
      <>
        {toolbar}
        <Skeleton shape="block" />
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        {toolbar}
        <EmptyState tone="error" title={strings.failedTitle} onRetry={() => week.reload()}>
          {state.message === '' ? strings.failedText : state.message}
        </EmptyState>
      </>
    );
  }
  const bookings = state.bookings.filter((booking) => search.link === undefined || booking.pageId === search.link);
  const events = state.events.filter((event) => shownConnections.has(event.connectionId));
  const byBooking = new Map(bookings.map((booking) => [booking.id, booking]));
  const byEvent = new Map(events.map((event) => [event.id, event]));
  const pieces = [
    ...bookingPieces(bookings, days).map((piece) => ({ piece, kind: 'booking' as const })),
    ...eventPieces(events, days).map((piece) => ({ piece, kind: 'event' as const })),
  ];
  const blocks: WeekCalendarBlock[] = pieces.flatMap(({ piece, kind }): WeekCalendarBlock[] => {
    if (kind === 'booking') {
      const booking = byBooking.get(piece.sourceId);
      if (booking === undefined) return [];
      return [
        {
          id: piece.id,
          dayKey: piece.dayKey,
          startMinute: piece.startMinute,
          endMinute: piece.endMinute,
          title: booking.visitorName,
          time: timeRange(booking.startsAt, booking.endsAt, locale),
          detail: booking.pageTitle,
          kind: 'booking',
          isCancelled: booking.status === 'cancelled',
        },
      ];
    }
    const event = byEvent.get(piece.sourceId);
    if (event === undefined) return [];
    const hue = hueOf.get(event.connectionId);
    return [
      {
        id: piece.id,
        dayKey: piece.dayKey,
        startMinute: piece.startMinute,
        endMinute: piece.endMinute,
        title: event.title,
        time: timeRange(event.startsAt, event.endsAt, locale),
        kind: 'event',
        ...(hue === undefined ? {} : { hue }),
      },
    ];
  });
  const open = pieces.find(({ piece }) => piece.id === openId);
  const openBooking = open?.kind === 'booking' ? byBooking.get(open.piece.sourceId) : undefined;
  const openEvent = open?.kind === 'event' ? byEvent.get(open.piece.sourceId) : undefined;
  const live = bookings.filter((booking) => booking.status === 'confirmed').length;
  const hourFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric' });
  return (
    <>
      {toolbar}
      {search.conn !== undefined && search.conn.length === 0 && connections.length > 0 && (
        <Callout tone="info" title={strings.noCalendarsTitle}>
          {strings.noCalendarsText}
        </Callout>
      )}
      <WeekCalendar
        label={strings.weekLabel(range)}
        days={days.map((key) => {
          const date = new Date(`${key}T12:00:00`);
          return {
            key,
            weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date),
            dayNumber: String(date.getDate()),
            label: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(date),
            isToday: key === today,
            isPast: key < today,
          };
        })}
        blocks={blocks}
        selectedDay={days.includes(search.day) ? search.day : (days[0] ?? search.week)}
        onSelectDay={(day) => onSearch({ day })}
        hourLabel={(hour) => hourFormat.format(new Date(2000, 0, 1, hour))}
        now={{ dayKey: today, minute: now.getHours() * 60 + now.getMinutes() }}
        scrollToMinute={scrollMinute(
          days,
          now,
          pieces.map(({ piece }) => piece),
        )}
        {...(openId === undefined ? {} : { openId })}
        detail={
          openBooking === undefined ? (
            openEvent === undefined ? undefined : (
              <EventCard
                event={openEvent}
                connection={connections.find((connection) => connection.id === openEvent.connectionId)}
                locale={locale}
              />
            )
          ) : (
            <BookingCard booking={openBooking} personHref={personHref(openBooking)} locale={locale} />
          )
        }
        onOpen={setOpenId}
        onClose={() => setOpenId(undefined)}
      />
      <p>{strings.weekSummary(live)}</p>
    </>
  );
}

/** The local day a booking starts on, as a key. */
const dayKeyOfInstant = (instant: string) => dayKeyOf(new Date(instant));

/** The bookings under their day bands (Today, Tomorrow, then the date), in the order given. */
function groupsOf(
  bookings: readonly BookingListItem[],
  personHref: (booking: BookingListItem) => string | undefined,
  locale: string,
): readonly BookingListGroup[] {
  const now = new Date();
  const today = dayKeyOf(now);
  const tomorrow = addDays(today, 1);
  const shortDate = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    }).format(date);
  const groups: { id: string; label: string; rows: BookingListGroup['rows'][number][] }[] = [];
  for (const booking of bookings) {
    const start = new Date(booking.startsAt);
    const id = dayKeyOfInstant(booking.startsAt);
    const href = personHref(booking);
    const row = {
      id: booking.id,
      date: shortDate(start),
      time: timeRange(booking.startsAt, booking.endsAt, locale),
      ...(booking.videoUrl === undefined || booking.status === 'cancelled'
        ? {}
        : { join: { href: booking.videoUrl, provider: providerOf(booking.videoUrl) } }),
      title: booking.pageTitle,
      ...(booking.note === undefined ? {} : { note: booking.note }),
      guestName: booking.visitorName,
      ...(href === undefined ? {} : { guestHref: href }),
      ...(booking.status === 'cancelled' ? { badge: strings.cancelled } : {}),
    };
    const last = groups.at(-1);
    if (last?.id === id) last.rows.push(row);
    else
      groups.push({
        id,
        label: id === today ? strings.today : id === tomorrow ? strings.tomorrow : shortDate(start),
        rows: [row],
      });
  }
  return groups;
}

/** One tab's list: loading, failed, its own empty state, or a page of bookings under their day bands. */
function ListTab({
  slug,
  tab,
  view,
  search,
  locale,
  personHref,
  onSearch,
  onOpen,
}: {
  readonly slug: string;
  readonly tab: BookingsTab;
  readonly view: BookingsView;
  readonly search: BookingsSearch;
  readonly locale: string;
  readonly personHref: (booking: BookingListItem) => string | undefined;
  readonly onSearch: (next: Partial<BookingsSearch>) => void;
  readonly onOpen: (booking: BookingListItem) => void;
}) {
  const state = useBookings(view);
  if (state.status === 'loading') return <Skeleton shape="block" />;
  if (state.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => view.reload()}>
        {state.message === '' ? strings.failedText : state.message}
      </EmptyState>
    );
  }
  // The server answers upcoming soonest first, past and canceled latest first; the toggle flips it.
  const natural = tab === 'upcoming' ? 'asc' : 'desc';
  const sort = tab === 'cancelled' ? 'desc' : (search.sort ?? natural);
  const filtered = state.bookings.filter((booking) => search.link === undefined || booking.pageId === search.link);
  const ordered = sort === natural ? filtered : [...filtered].reverse();
  const pages = Math.max(1, Math.ceil(ordered.length / search.per));
  const page = Math.min(search.page, pages);
  const shown = ordered.slice((page - 1) * search.per, page * search.per);
  const byId = new Map(shown.map((booking) => [booking.id, booking]));
  const sortLabel =
    tab === 'upcoming'
      ? sort === 'asc'
        ? strings.sortSoonest
        : strings.sortLatest
      : sort === 'desc'
        ? strings.sortRecent
        : strings.sortOldest;
  return (
    <>
      {tab !== 'cancelled' && ordered.length >= 2 && (
        <Button
          variant="ghost"
          icon="chevrons-up-down"
          onPress={() => onSearch({ sort: sort === 'asc' ? 'desc' : 'asc', page: 1 })}
        >
          {sortLabel}
        </Button>
      )}
      <BookingList
        label={strings.listLabel[tab]}
        groups={groupsOf(shown, personHref, locale)}
        onOpen={(id) => {
          const booking = byId.get(id);
          if (booking !== undefined) onOpen(booking);
        }}
        emptyState={
          <EmptyState
            icon="calendar-days"
            title={strings.empty[tab].title}
            {...(tab === 'upcoming'
              ? {
                  actions: (
                    <>
                      <Link href={linksHref(slug)}>{strings.openLinks}</Link>
                      <Link href={availabilityHref(slug)}>{strings.openAvailability}</Link>
                    </>
                  ),
                }
              : {})}
          >
            {strings.empty[tab].text}
          </EmptyState>
        }
      />
      <Pagination
        label={strings.listLabel[tab]}
        page={page}
        pageSize={search.per}
        total={ordered.length}
        pageSizes={PAGE_SIZES}
        onPage={(next) => onSearch({ page: next })}
        onPageSize={(per) => onSearch({ per, page: 1 })}
      />
    </>
  );
}

/** The list view: the view switch, the tabs, Filter, then the tab's list. */
function ListView(
  props: BookingsScreenProps & { readonly personHref: (booking: BookingListItem) => string | undefined },
) {
  const { slug, search, lists, pages, locale, onSearch, personHref } = props;
  const [open, setOpen] = useState<BookingListItem | undefined>(undefined);
  return (
    <>
      <SectionBar
        start={<ViewSwitch view="list" onSearch={onSearch} />}
        end={<FilterMenu search={search} pages={pages} connections={[]} onSearch={onSearch} />}
      />
      <Tabs
        label={strings.tabsLabel}
        selectedKey={search.tab}
        onSelectionChange={(next) => {
          const tab = TABS.find((each) => each === next);
          if (tab !== undefined && tab !== search.tab) onSearch({ tab, page: 1, sort: undefined });
        }}
        tabs={TABS.map((id) => ({ id, label: strings.tabs[id] }))}
      >
        {TABS.map((id) => (
          <TabPanel key={id} id={id}>
            {search.tab === id && (
              <ListTab
                slug={slug}
                tab={id}
                view={lists[id]}
                search={search}
                locale={locale}
                personHref={personHref}
                onSearch={onSearch}
                onOpen={setOpen}
              />
            )}
          </TabPanel>
        ))}
      </Tabs>
      {open !== undefined && (
        <DetailPanel booking={open} personHref={personHref(open)} locale={locale} onClose={() => setOpen(undefined)} />
      )}
    </>
  );
}

/** A list row's details, in the page's side panel. */
function DetailPanel({
  booking,
  personHref,
  locale,
  onClose,
}: {
  readonly booking: BookingListItem;
  readonly personHref: string | undefined;
  readonly locale: string;
  readonly onClose: () => void;
}) {
  return (
    <Panel title={strings.details} isOpen onClose={onClose}>
      <BookingCard booking={booking} personHref={personHref} locale={locale} />
    </Panel>
  );
}

/** Bookings: the week calendar or the list, filling the page's width. */
export function BookingsScreen(props: BookingsScreenProps) {
  const { slug, objects, search } = props;
  const link = recordLinks(slug, objects);
  const people = objects.find((object) => object.standardKey === 'people');
  const personHref = (booking: BookingListItem) => personHrefOf(booking, link, people);
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.title} icon="calendar-days" />,
        body: (
          <PageColumn width="full">
            {search.view === 'week' ? (
              <WeekView {...props} personHref={personHref} />
            ) : (
              <ListView {...props} personHref={personHref} />
            )}
          </PageColumn>
        ),
      }}
    />
  );
}

/** Bookings while its first read loads. */
export function BookingsPending() {
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.title} icon="calendar-days" />,
        body: (
          <PageColumn width="full">
            <Skeleton shape="block" />
          </PageColumn>
        ),
      }}
    />
  );
}

/** Bookings when its first read failed, with Try again. */
export function BookingsFailed({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.title} icon="calendar-days" />,
        body: (
          <PageColumn width="full">
            <EmptyState tone="error" title={strings.failedTitle} onRetry={onRetry}>
              {message}
            </EmptyState>
          </PageColumn>
        ),
      }}
    />
  );
}
