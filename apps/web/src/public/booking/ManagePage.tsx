// Brief
// Purpose: the guest page at /b/<publicKey>/manage?t=<token> (spec 0025, 0025-experience.md, AC-674): the booking, kept without an account.
// Main task: see when, with whom and where, and add it to a calendar.
// Leaves out: Move to another time, Add guests and Cancel (milestone 2, with their endpoints, AC-675 to AC-677).
import { createBookingClient, isDataError, type PublicManagedBooking } from '@crm/data/booking';
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './booking.module.css';
import { strings } from './strings.ts';
import { longDate, relativeLabel, timeLabel, zoneDisplay } from './time.ts';

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

/** A heading that takes focus as the page arrives. */
function Title({ children }: { readonly children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h1 ref={ref} tabIndex={-1} className={styles.title}>
      {children}
    </h1>
  );
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

  if (loaded.state !== 'ready') {
    return (
      <main className={styles.page}>
        <div className={styles.solo}>
          <div className={styles.card} {...(loaded.state === 'loading' ? { 'aria-busy': true } : {})}>
            {loaded.state === 'loading' ? (
              <>
                <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
                <div className={`${styles.skeleton} ${styles.skeletonCard}`} />
              </>
            ) : (
              <>
                <Title>{loaded.state === 'gone' ? strings.linkGone : strings.failedTitle}</Title>
                {loaded.state === 'failed' && <p className={styles.muted}>{strings.failedText}</p>}
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  const { booking } = loaded;
  const zone = booking.timeZone;
  const title =
    booking.state === 'cancelled'
      ? strings.titles.cancelled
      : booking.state === 'past'
        ? strings.titles.past
        : isWelcome
          ? strings.titles.welcome
          : strings.titles.confirmed;
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
  return (
    <main className={styles.page}>
      <div className={styles.solo}>
        <div className={styles.card}>
          <p className={styles.mark} data-state={booking.state}>
            {strings.marks[booking.state]}
          </p>
          <Title>{title}</Title>
          <div className={styles.timeCard} data-state={booking.state}>
            <div className={styles.dateBlock} aria-hidden="true">
              <span className={styles.dateWeekday}>{parts.weekday}</span>
              <span className={styles.dateDay}>{parts.day}</span>
              <span className={styles.dateMonth}>{parts.month}</span>
            </div>
            <div>
              <p className={styles.timeRange}>
                {`${timeLabel(booking.start, zone, locale)} – ${timeLabel(booking.end, zone, locale)}`}
              </p>
              <p className={styles.muted}>{`${longDate(booking.start, zone, locale)} · ${zoneDisplay(zone, now())}`}</p>
              {booking.state === 'confirmed' && (
                <p className={styles.muted}>{relativeLabel(booking.start, now(), zone, locale)}</p>
              )}
            </div>
          </div>
          <dl className={styles.factsList}>
            <dt className={styles.factTerm}>{strings.what}</dt>
            <dd className={styles.factValue}>{booking.title}</dd>
            <dt className={styles.factTerm}>{strings.who}</dt>
            <dd className={styles.factValue}>
              <span>
                {booking.hostName} <span className={styles.tag}>{strings.host}</span>
              </span>
              <span>{booking.visitorName}</span>
              {booking.guests.map((guest) => (
                <span key={guest}>{guest}</span>
              ))}
            </dd>
            <dt className={styles.factTerm}>{strings.where}</dt>
            <dd className={styles.factValue}>
              {booking.videoUrl === undefined ? (
                whereOf(booking)
              ) : (
                <a className={styles.anchor} href={booking.videoUrl} rel="noreferrer" target="_blank">
                  {booking.videoUrl}
                </a>
              )}
            </dd>
            {booking.note !== undefined && (
              <>
                <dt className={styles.factTerm}>{strings.yourNote}</dt>
                <dd className={styles.factValue}>{booking.note}</dd>
              </>
            )}
          </dl>
          {booking.state === 'confirmed' && (
            <section className={styles.calendarLinks} aria-label={strings.addToCalendar}>
              <h2 className={styles.label}>{strings.addToCalendar}</h2>
              <div className={styles.linkRow}>
                <a className={styles.secondary} href={google} rel="noreferrer" target="_blank">
                  {strings.google}
                </a>
                <a className={styles.secondary} href={outlook} rel="noreferrer" target="_blank">
                  {strings.outlook}
                </a>
                <a className={styles.secondary} href={client.icsUrl(token)} download="booking.ics">
                  {strings.apple}
                </a>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
