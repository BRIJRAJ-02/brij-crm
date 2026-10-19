// Brief
// Purpose: Bookings (spec 0025, AC-646, 0025-calcom-alignment.md 5): every booking the member may see, Upcoming, Past or Canceled, under day bands.
// Main task: see what is coming up (when, the Join link, the title, who) and open one for its details.
// Leaves out: Cancel and the Edit menu (Reschedule, Add guests) until the host's endpoints exist, filters and saved chips, and live arrival (it reads again when the page is shown again).
import type { BookingListItem, BookingsTab, BookingsView, ObjectSummary } from '@crm/data';
import { useBookings } from '@crm/data/react';
import {
  BookingList,
  Callout,
  DescriptionList,
  EmptyState,
  Link,
  PageColumn,
  Panel,
  Skeleton,
  TabPanel,
  Tabs,
  TopBar,
  type BookingListGroup,
} from '@crm/ui';
import { useState } from 'react';
import { availabilityHref } from '../booking/links.ts';
import { linksHref } from '../captures/tabs.ts';
import { recordLinks, type RecordLink } from '../records/timeline.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

export type { BookingsTab };

/** The tabs, in order. */
const TABS: readonly BookingsTab[] = ['upcoming', 'past', 'cancelled'];

/** True for one of the tabs. */
export const isBookingsTab = (value: unknown): value is BookingsTab => TABS.some((tab) => tab === value);

/** Props for Bookings: the held lists, the tab in the address, and the workspace's objects (for the person's link). */
export interface BookingsScreenProps {
  readonly slug: string;
  readonly tab: BookingsTab;
  readonly views: Readonly<Record<BookingsTab, BookingsView>>;
  readonly objects: readonly ObjectSummary[];
  readonly onTab: (tab: BookingsTab) => void;
}

/** The local day a booking starts on, as a key. */
const dayKey = (date: Date) =>
  `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const shortDate = (date: Date, now: Date) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(date);

/** A day band's label: Today, Tomorrow, or the date. */
function bandLabel(date: Date, now: Date): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (dayKey(date) === dayKey(now)) return strings.today;
  if (dayKey(date) === dayKey(tomorrow)) return strings.tomorrow;
  return shortDate(date, now);
}

const clock = (instant: string) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(instant));

/** "9:30 – 10:00 AM". */
const timeRange = (booking: BookingListItem) => `${clock(booking.startsAt)} – ${clock(booking.endsAt)}`;

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

/** Where it happens, as a line. */
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

/** The bookings under their day bands, in the list's order. */
function groupsOf(
  bookings: readonly BookingListItem[],
  personHref: (booking: BookingListItem) => string | undefined,
): readonly BookingListGroup[] {
  const now = new Date();
  const groups: { id: string; label: string; rows: BookingListGroup['rows'][number][] }[] = [];
  for (const booking of bookings) {
    const start = new Date(booking.startsAt);
    const id = dayKey(start);
    const href = personHref(booking);
    const row = {
      id: booking.id,
      date: shortDate(start, now),
      time: timeRange(booking),
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
    else groups.push({ id, label: bandLabel(start, now), rows: [row] });
  }
  return groups;
}

/** One tab's list: loading, failed, its own empty state, or the bookings under their day bands. */
function BookingsTabList({
  slug,
  tab,
  view,
  personHref,
  onOpen,
}: {
  readonly slug: string;
  readonly tab: BookingsTab;
  readonly view: BookingsView;
  readonly personHref: (booking: BookingListItem) => string | undefined;
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
  const byId = new Map(state.bookings.map((booking) => [booking.id, booking]));
  return (
    <BookingList
      label={strings.listLabel[tab]}
      groups={groupsOf(state.bookings, personHref)}
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
  );
}

/** One booking in full: when, which page, who, where, their note, and their person. */
function BookingDetail({
  booking,
  personHref,
}: {
  readonly booking: BookingListItem;
  readonly personHref: string | undefined;
}) {
  const when = `${new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date(booking.startsAt))}, ${timeRange(booking)}`;
  return (
    <>
      {booking.eventFailed && booking.status === 'confirmed' && <Callout tone="warning">{strings.eventFailed}</Callout>}
      <DescriptionList
        items={[
          { term: strings.status, description: booking.status === 'cancelled' ? strings.cancelled : strings.confirmed },
          { term: strings.when, description: when },
          { term: strings.page, description: booking.pageTitle },
          {
            term: strings.guest,
            description:
              personHref === undefined ? booking.visitorName : <Link href={personHref}>{booking.visitorName}</Link>,
          },
          {
            term: strings.email,
            description: <Link href={`mailto:${booking.visitorEmail}`}>{booking.visitorEmail}</Link>,
          },
          ...(booking.guests.length === 0 ? [] : [{ term: strings.guests, description: booking.guests.join(', ') }]),
          { term: strings.timeZone, description: booking.visitorTimeZone },
          {
            term: strings.where,
            description:
              booking.videoUrl === undefined ? (
                whereOf(booking)
              ) : (
                <Link href={booking.videoUrl}>{booking.videoUrl}</Link>
              ),
          },
          ...(booking.note === undefined ? [] : [{ term: strings.note, description: booking.note }]),
          ...(booking.cancelReason === undefined
            ? []
            : [{ term: strings.cancelReason, description: booking.cancelReason }]),
        ]}
      />
    </>
  );
}

/** Bookings: Upcoming, Past and Canceled, each under day bands, and the open booking in a Panel. */
export function BookingsScreen({ slug, tab, views, objects, onTab }: BookingsScreenProps) {
  const [open, setOpen] = useState<BookingListItem | undefined>(undefined);
  const link = recordLinks(slug, objects);
  const people = objects.find((object) => object.standardKey === 'people');
  const personHref = (booking: BookingListItem) => personHrefOf(booking, link, people);
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.title} icon="calendar-days" />,
        body: (
          <PageColumn>
            <Tabs
              label={strings.tabsLabel}
              selectedKey={tab}
              onSelectionChange={(next) => {
                if (isBookingsTab(next) && next !== tab) onTab(next);
              }}
              tabs={TABS.map((id) => ({ id, label: strings.tabs[id] }))}
            >
              {TABS.map((id) => (
                <TabPanel key={id} id={id}>
                  {tab === id && (
                    <BookingsTabList slug={slug} tab={id} view={views[id]} personHref={personHref} onOpen={setOpen} />
                  )}
                </TabPanel>
              ))}
            </Tabs>
            {open !== undefined && (
              <Panel title={strings.details} isOpen onClose={() => setOpen(undefined)}>
                <BookingDetail booking={open} personHref={personHref(open)} />
              </Panel>
            )}
          </PageColumn>
        ),
      }}
    />
  );
}

/** Bookings while its first list loads. */
export function BookingsPending() {
  return (
    <WorkspacePage
      currentPage="bookings"
      page={{
        topBar: <TopBar title={strings.title} icon="calendar-days" />,
        body: (
          <PageColumn>
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
          <PageColumn>
            <EmptyState tone="error" title={strings.failedTitle} onRetry={onRetry}>
              {message}
            </EmptyState>
          </PageColumn>
        ),
      }}
    />
  );
}
