// Brief
// Purpose: the guest page at /b/<publicKey>/manage?t=<token> (spec 0025, 0025-experience.md, AC-674 to AC-677): the
// booking, kept without an account, and the guest's own changes to it.
// Main task: see that it is booked, when, with whom and where; join or add it to a calendar; and, when plans change,
// move it, invite more people or cancel it.
// Leaves out: the host's suggested times (timefix has them; not in this milestone), and the booking page itself,
// which is frozen: Move reuses its DayStrip and SlotList unchanged.
//
// Drawn by the library's BookingReceipt and BookingChanges (`@crm/ui/public-booking`); this file reads the booking,
// formats it, and turns the client's answers into what the modules show.
import { createBookingClient, isDataError, type PublicManagedBooking } from '@crm/data/booking';
import { createManageClient, type ManageClient } from '@crm/data/booking/manage';
import {
  BookingChanges,
  BookingMessage,
  BookingReceipt,
  Button,
  Callout,
  DayStrip,
  SlotList,
  type CancelOutcome,
  type GuestsOutcome,
  poweredByHref,
} from '@crm/ui/public-booking';
import { useEffect, useMemo, useState } from 'react';
import { saveHour12, savedHour12 } from './prefs.ts';
import { changeStrings } from './change-strings.ts';
import { strings, tabTitle } from './strings.ts';
import {
  dayKey,
  dayLabels,
  localeUses12h,
  longDate,
  rangeLabel,
  relativeLabel,
  timeLabel,
  zoneDisplay,
} from './time.ts';

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

/** How far ahead Move looks: three weeks, as the timefix guest page does. */
const MOVE_DAYS = 21;

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
      return strings.video(booking.hostName);
    case 'phone':
      return strings.phoneCall;
    default:
      return booking.location.value;
  }
}

/** A refusal's sentence for the guest. */
function messageOf(error: unknown): string {
  if (!isDataError(error)) return strings.errors.failed;
  if (error.code === 'RATE_LIMITED') return strings.errors.tooMany;
  if (error.code === 'API_UNAVAILABLE') return strings.errors.offline;
  if (error.code === 'SLOT_TAKEN') return changeStrings.taken;
  // The server's own sentence says why (already happened, moved 5 times, the page stopped taking bookings).
  if (['BOOKING_CLOSED', 'LIMIT_REACHED', 'NOT_FOUND'].includes(error.code) && error.message !== '') {
    return error.message;
  }
  return strings.errors.failed;
}

/** The guest page. */
export function ManagePage({ token, isWelcome, locale, now }: ManagePageProps) {
  const client = useMemo(() => createBookingClient({ origin: globalThis.location.origin }), []);
  const changes = useMemo(() => createManageClient({ origin: globalThis.location.origin }), []);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  // Try again after a failed load reads it once more.
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<'moved' | 'cancelled' | undefined>(undefined);
  // The page the Timefix link names in its tags: the guest's page just after booking, or when they come back to it.
  const brandPage = isWelcome ? 'booking_confirmation' : 'booking_manage';
  useEffect(() => {
    client.managed(token).then(
      (booking) => setLoaded({ state: 'ready', booking }),
      (error: unknown) => setLoaded({ state: isDataError(error) && error.code === 'NOT_FOUND' ? 'gone' : 'failed' }),
    );
  }, [client, token, attempt]);
  const titleOf = (state: Loaded): string | undefined => {
    if (state.state !== 'ready') {
      if (state.state === 'loading') return undefined;
      return state.state === 'gone' ? strings.linkGone : strings.failedTitle;
    }
    if (state.booking.state === 'cancelled') return strings.titles.cancelled;
    if (state.booking.state === 'past') return strings.titles.past;
    return isWelcome && notice === undefined ? strings.titles.welcome : strings.titles.confirmed;
  };
  const title = titleOf(loaded);
  // The tab says what the heading says.
  useEffect(() => {
    if (title !== undefined) document.title = tabTitle(title);
  }, [title]);

  if (loaded.state === 'loading') return <BookingMessage title={strings.loading} page={brandPage} isLoading />;
  if (loaded.state !== 'ready') {
    return (
      <BookingMessage
        title={loaded.state === 'gone' ? strings.linkGone : strings.failedTitle}
        page={brandPage}
        {...(loaded.state === 'failed'
          ? {
              onRetry: () => {
                setLoaded({ state: 'loading' });
                setAttempt((count) => count + 1);
              },
            }
          : {})}
      >
        {loaded.state === 'failed' ? strings.failedText : strings.linkGoneText}
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
  // The host is named in the summary above ("with Ada Lovelace"), so Who is the guest who booked: their name, then their
  // email on a line of its own, kept whole.
  const who = { description: booking.visitorName, address: booking.visitorEmail };
  const changed = (next: PublicManagedBooking, kind: 'moved' | 'cancelled') => {
    setLoaded({ state: 'ready', booking: next });
    setNotice(kind);
  };

  /** The booking with its guests as the server now has them, kept with whatever else changed meanwhile. */
  const withGuests = (guests: readonly string[]) =>
    setLoaded((current) =>
      current.state === 'ready' ? { state: 'ready', booking: { ...current.booking, guests: [...guests] } } : current,
    );
  const invite = (email: string): Promise<GuestsOutcome> =>
    changes.addGuests(token, [email]).then(
      (answer): GuestsOutcome => {
        withGuests(answer.guests);
        return { kind: 'done', added: answer.added };
      },
      (error: unknown): GuestsOutcome => {
        const issue = isDataError(error) ? error.data?.issues?.[0] : undefined;
        return issue === undefined
          ? { kind: 'failed', message: messageOf(error) }
          : { kind: 'invalid', message: issue.message };
      },
    );
  const remove = (email: string): Promise<CancelOutcome> =>
    changes.removeGuest(token, email).then(
      (answer): CancelOutcome => {
        withGuests(answer.guests);
        return { kind: 'done' };
      },
      (error: unknown): CancelOutcome => ({ kind: 'failed', message: messageOf(error) }),
    );
  const cancel = (reason: string): Promise<CancelOutcome> =>
    changes.cancel(token, reason).then(
      (answer): CancelOutcome => {
        changed(answer.booking, 'cancelled');
        return { kind: 'done' };
      },
      (error: unknown): CancelOutcome => ({ kind: 'failed', message: messageOf(error) }),
    );

  return (
    <BookingReceipt
      // A move or a cancel draws the receipt again, its changes closed.
      key={`${booking.start}|${booking.state}`}
      state={booking.state}
      isWelcome={isWelcome && notice === undefined}
      hostName={booking.hostName}
      date={{ weekday: parts.weekday ?? '', day: parts.day ?? '', month: parts.month ?? '' }}
      range={rangeLabel(booking.start, booking.end, zone, locale)}
      when={`${longDate(booking.start, zone, locale)} · ${zoneDisplay(zone, now())}`}
      relative={relativeLabel(booking.start, now(), zone, locale)}
      // The summary leads (spec 0058, AC-19): what, when and who, from the booking already loaded.
      summary={{ what: booking.title, who: strings.withHost(booking.hostName) }}
      facts={[
        { term: strings.who, ...who },
        ...(booking.guests.length === 0
          ? []
          : [{ term: changeStrings.guestsTerm, description: booking.guests.join(', ') }]),
        ...(booking.videoUrl === undefined ? [{ term: strings.where, description: whereOf(booking) }] : []),
        ...(booking.note === undefined ? [] : [{ term: strings.yourNote, description: booking.note }]),
        ...(booking.cancelReason === undefined
          ? []
          : [{ term: changeStrings.reason, description: booking.cancelReason }]),
      ]}
      {...(booking.videoUrl === undefined ? {} : { joinUrl: booking.videoUrl })}
      brand={{
        href: poweredByHref(brandPage, booking.workspaceSlug),
        label: changeStrings.poweredBy,
      }}
      calendars={{ google, outlook, ics: client.icsUrl(token) }}
      again={{
        label: booking.state === 'cancelled' ? strings.bookAnother(booking.hostName) : strings.bookAgain,
        href: `/b/${encodeURIComponent(booking.publicKey)}`,
      }}
      {...(notice === undefined
        ? {}
        : {
            notice: (
              <Callout
                tone="success"
                isAnnounced
                title={notice === 'moved' ? changeStrings.moved : changeStrings.cancelled}
              >
                {notice === 'moved'
                  ? changeStrings.movedText(booking.hostName)
                  : changeStrings.cancelledText(booking.hostName)}
              </Callout>
            ),
          })}
      {...(booking.canChange
        ? {
            changes: (
              <BookingChanges
                title={booking.title}
                hostName={booking.hostName}
                guests={booking.guests}
                canMove={booking.canMove}
                moveNote={changeStrings.timesIn(zoneDisplay(zone, now()))}
                move={
                  <MovePicker
                    client={changes}
                    token={token}
                    booking={booking}
                    locale={locale}
                    timeZone={zone}
                    now={now}
                    onMove={(start) => changes.move(token, start).then((answer) => changed(answer.booking, 'moved'))}
                  />
                }
                onInvite={invite}
                onRemove={remove}
                onCancel={cancel}
              />
            ),
          }
        : {})}
    />
  );
}

type Times =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly starts: readonly string[] }
  | { readonly state: 'failed' };

/**
 * Move to another time: the page's free times for the next three weeks in
 * the zone the guest booked in (the receipt's), days over times (the booking page's List view), and a
 * commit bar that names the new time. Picking a time never moves; only the
 * bar does.
 */
function MovePicker({
  client,
  token,
  booking,
  locale,
  timeZone,
  now,
  onMove,
}: {
  readonly client: ManageClient;
  readonly token: string;
  readonly booking: PublicManagedBooking;
  readonly locale: string;
  readonly timeZone: string;
  readonly now: () => number;
  readonly onMove: (start: string) => Promise<void>;
}) {
  const [times, setTimes] = useState<Times>({ state: 'loading' });
  const [reload, setReload] = useState(0);
  const [pickedDay, setDay] = useState<string | undefined>(undefined);
  const [time, setTime] = useState<string | undefined>(undefined);
  const [hour12, setHour12] = useState(() => savedHour12() ?? localeUses12h(locale));
  const [error, setError] = useState('');
  const [isMoving, setMoving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const from = new Date(now()).toISOString();
    const to = new Date(now() + MOVE_DAYS * 86_400_000).toISOString();
    client.moveSlots(token, { from, to, tz: timeZone }, controller.signal).then(
      (answer) => {
        // Its own time is offered back (moving onto it changes nothing): left out here.
        setTimes({
          state: 'ready',
          starts: answer.slots.map((slot) => slot.start).filter((at) => at !== booking.start),
        });
      },
      (caught: unknown) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setTimes({ state: 'failed' });
        setError(messageOf(caught));
      },
    );
    return () => controller.abort();
  }, [client, token, timeZone, now, booking.start, reload]);

  const starts = times.state === 'ready' ? times.starts : [];
  const byDay = new Map<string, string[]>();
  for (const start of starts) {
    const key = dayKey(Date.parse(start), timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), start]);
  }
  const days = [...byDay.keys()].sort();
  const day = pickedDay !== undefined && byDay.has(pickedDay) ? pickedDay : days[0];
  const dayHeading = day === undefined ? '' : dayLabels(day, locale).short;
  const minutes = Math.round((Date.parse(booking.end) - Date.parse(booking.start)) / 60_000);

  if (times.state === 'failed') {
    return (
      <Callout
        tone="danger"
        isAnnounced
        actions={
          <Button
            onPress={() => {
              setError('');
              setTimes({ state: 'loading' });
              setReload((count) => count + 1);
            }}
          >
            {strings.retry}
          </Button>
        }
      >
        {error}
      </Callout>
    );
  }
  if (times.state === 'ready' && days.length === 0) {
    return (
      <Callout tone="info" title={changeStrings.pickNewTime}>
        {changeStrings.noTimes(booking.hostName)}
      </Callout>
    );
  }
  return (
    <>
      <DayStrip
        days={days}
        value={day}
        onChange={(next) => {
          setDay(next);
          setTime(undefined);
        }}
      />
      <SlotList
        heading={times.state === 'loading' ? changeStrings.finding(booking.hostName) : dayHeading}
        slots={(day === undefined ? [] : (byDay.get(day) ?? [])).map((start) => {
          const label = timeLabel(start, timeZone, locale, hour12);
          return { id: start, label, name: strings.timeName(label, dayHeading, minutes) };
        })}
        value={time}
        onChange={(next) => {
          setTime(next);
          setError('');
        }}
        hour12={hour12}
        onHour12Change={(next) => {
          setHour12(next);
          saveHour12(next);
        }}
        layout="grid"
        isLoading={times.state === 'loading'}
        drawKey={`${day ?? ''}|${timeZone}`}
      />
      {error !== '' && (
        <Callout tone="danger" isAnnounced>
          {error}
        </Callout>
      )}
      <Button
        variant="primary"
        size="lg"
        isFullWidth="center"
        isDisabled={time === undefined}
        isPending={isMoving}
        onPress={() => {
          if (time === undefined) return;
          setMoving(true);
          setError('');
          onMove(time).catch((caught: unknown) => {
            setMoving(false);
            setError(messageOf(caught));
            // A time that just went: fresh times, the day kept.
            if (isDataError(caught) && caught.code === 'SLOT_TAKEN') {
              setTime(undefined);
              setTimes({ state: 'loading' });
              setReload((count) => count + 1);
            }
          });
        }}
      >
        {isMoving
          ? changeStrings.moving
          : time === undefined
            ? changeStrings.pickNewTime
            : changeStrings.moveTo(timeLabel(time, timeZone, locale, hour12), dayHeading)}
      </Button>
    </>
  );
}
