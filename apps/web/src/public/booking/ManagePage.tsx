// Brief
// Purpose: the guest page at /b/<publicKey>/manage?t=<token> (spec 0025, 0025-experience.md, AC-674): the booking, kept without an account.
// Main task: see that it is booked, when, with whom and where, join the call, and add it to a calendar.
// Leaves out: Move to another time, Add guests and Cancel (AC-675 to AC-677): the public API has no endpoints for
// them yet, so the page offers none. A booking the host cancelled shows here as cancelled.
//
// Drawn by the library's BookingReceipt (`@crm/ui/public-booking`); this file reads the booking and formats it.
import { createBookingClient, isDataError, type PublicManagedBooking } from '@crm/data/booking';
import { BookingMessage, BookingReceipt } from '@crm/ui/public-booking';
import { useEffect, useMemo, useState } from 'react';
import { strings } from './strings.ts';
import { longDate, rangeLabel, relativeLabel, zoneDisplay } from './time.ts';

/** Props for the guest page: the token from the address, whether it is the welcome right after booking, and the clock. */
export interface ManagePageProps {
  readonly token: string;
  readonly isWelcome: boolean;
  readonly locale: string;
  readonly now: () => number;
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly booking: PublicManagedBooking }
  | { readonly state: 'gone' | 'failed' };

/** `yyyyMMddTHHmmssZ` for calendar links. */
const compact = (instant: string) =>
  new Date(instant)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Where it happens, as one line. */
function whereOf(booking: PublicManagedBooking): string {
  if (booking.videoUrl !== undefined) return booking.videoUrl;
  switch (booking.location.type) {
    case 'video':
      return strings.video;
    case 'phone':
      return strings.phoneCall;
    default:
      return booking.location.value;
  }
}

/** The guest page. */
export function ManagePage({ token, isWelcome, locale, now }: ManagePageProps) {
  const client = useMemo(() => createBookingClient({ origin: globalThis.location.origin }), []);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  useEffect(() => {
    client.managed(token).then(
      (booking) => setLoaded({ state: 'ready', booking }),
      (error: unknown) => setLoaded({ state: isDataError(error) && error.code === 'NOT_FOUND' ? 'gone' : 'failed' }),
    );
  }, [client, token]);
  const title =
    loaded.state !== 'ready'
      ? undefined
      : loaded.booking.state === 'cancelled'
        ? strings.titles.cancelled
        : loaded.booking.state === 'past'
          ? strings.titles.past
          : isWelcome
            ? strings.titles.welcome
            : strings.titles.confirmed;
  // The tab says what the heading says.
  useEffect(() => {
    if (title !== undefined) document.title = `${title} · ${strings.product}`;
  }, [title]);

  if (loaded.state === 'loading') return <BookingMessage title={strings.loading} isLoading />;
  if (loaded.state !== 'ready') {
    return (
      <BookingMessage title={loaded.state === 'gone' ? strings.linkGone : strings.failedTitle}>
        {loaded.state === 'failed' ? strings.failedText : undefined}
      </BookingMessage>
    );
  }

  const { booking } = loaded;
  const zone = booking.timeZone;
  const parts = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' })
    .formatToParts(new Date(booking.start))
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  const summary = `${booking.title} with ${booking.hostName}`;
  const details = booking.note ?? '';
  const google = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE',
    text: summary,
    dates: `${compact(booking.start)}/${compact(booking.end)}`,
    details,
    location: whereOf(booking),
  }).toString()}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?${new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: summary,
    startdt: booking.start,
    enddt: booking.end,
    body: details,
    location: whereOf(booking),
  }).toString()}`;
  const who = [
    `${booking.hostName} (${strings.host})`,
    `${booking.visitorName} (${booking.visitorEmail})`,
    ...(booking.guests.length > 0 ? [strings.alsoInvited(booking.guests.join(', '))] : []),
  ].join(', ');
  return (
    <BookingReceipt
      state={booking.state}
      isWelcome={isWelcome}
      hostName={booking.hostName}
      date={{ weekday: parts.weekday ?? '', day: parts.day ?? '', month: parts.month ?? '' }}
      range={rangeLabel(booking.start, booking.end, zone, locale)}
      when={`${longDate(booking.start, zone, locale)} · ${zoneDisplay(zone, now())}`}
      relative={relativeLabel(booking.start, now(), zone, locale)}
      facts={[
        { term: strings.what, description: booking.title },
        { term: strings.who, description: who },
        ...(booking.videoUrl === undefined ? [{ term: strings.where, description: whereOf(booking) }] : []),
        ...(booking.note === undefined ? [] : [{ term: strings.yourNote, description: booking.note }]),
      ]}
      {...(booking.videoUrl === undefined ? {} : { joinUrl: booking.videoUrl })}
      calendars={{ google, outlook, ics: client.icsUrl(token) }}
      again={{
        label: booking.state === 'cancelled' ? strings.bookAnother(booking.hostName) : strings.bookAgain,
        href: `/b/${encodeURIComponent(booking.publicKey)}`,
      }}
    />
  );
}
