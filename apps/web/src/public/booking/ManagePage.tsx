// Brief
// Purpose: the guest page at /b/<publicKey>/manage?t=<token> (spec 0025, 0025-experience.md, AC-674): the booking, kept without an account.
// Main task: see that it is booked, when, with whom and where, and add it to a calendar.
// Leaves out: Move to another time, Add guests and Cancel (AC-675 to AC-677): the public API has no endpoints for
// them yet, so the page offers none. A booking the host cancelled shows here as cancelled.
//
// Laid out as the timefix guest page: a centred header (the host's initials with a state badge, and the title
// by state), one facts card (the time band with its date chip, the range, the whole date and zone and a relative
// line; then What, Who, Where and the note; then Add to calendar), and the Timefix mark at the foot.
import { createBookingClient, isDataError, type PublicManagedBooking } from '@crm/data/booking';
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './booking.module.css';
import { Brand } from './BookingPage.tsx';
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

/** The host's initials, for the avatar. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** A heading that takes focus as the page arrives. */
function Title({ children }: { readonly children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h1 ref={ref} tabIndex={-1} className={styles.manageTitle}>
      {children}
    </h1>
  );
}

/** The state badge on the avatar: a tick, a cross or a clock. */
function StateMark({ state }: { readonly state: PublicManagedBooking['state'] }) {
  return (
    <span className={styles.stateBadge} data-state={state}>
      <svg className={styles.iconSmall} viewBox="0 0 24 24" aria-hidden="true">
        {state === 'confirmed' ? (
          <path d="M20 6 9 17l-5-5" />
        ) : state === 'cancelled' ? (
          <path d="M18 6 6 18M6 6l12 12" />
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        )}
      </svg>
    </span>
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

  if (loaded.state !== 'ready' || title === undefined) {
    return (
      <main className={styles.page}>
        <div className={styles.manage}>
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
          <Brand placement="page" />
        </div>
      </main>
    );
  }

  const { booking } = loaded;
  const zone = booking.timeZone;
  const isLive = booking.state === 'confirmed';
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
  const bookAgain = `/b/${encodeURIComponent(booking.publicKey)}`;
  return (
    <main className={styles.page}>
      <div className={styles.manage}>
        <header className={styles.manageHead}>
          <span className={styles.manageAvatar} aria-hidden="true">
            {initials(booking.hostName)}
            <StateMark state={booking.state} />
          </span>
          <Title>{title}</Title>
        </header>
        <article className={styles.factsCard} aria-label={strings.marks[booking.state]}>
          <div className={styles.timeBand} data-state={booking.state}>
            <div className={styles.dateChip} data-live={isLive ? '' : undefined} aria-hidden="true">
              <span className={styles.dateWeekday}>{parts.weekday}</span>
              <span className={styles.dateDay}>{parts.day}</span>
              <span className={styles.dateMonth}>{parts.month}</span>
            </div>
            <div className={styles.timeText}>
              <p className={styles.timeRange}>{rangeLabel(booking.start, booking.end, zone, locale)}</p>
              <p className={styles.muted}>{`${longDate(booking.start, zone, locale)} · ${zoneDisplay(zone, now())}`}</p>
              {isLive && <p className={styles.relative}>{relativeLabel(booking.start, now(), zone, locale)}</p>}
            </div>
          </div>
          <dl className={styles.factsList}>
            <dt className={styles.factTerm}>{strings.what}</dt>
            <dd className={styles.factValue}>{booking.title}</dd>
            <dt className={styles.factTerm}>{strings.who}</dt>
            <dd className={styles.factValue}>
              <span className={styles.person}>
                {booking.hostName} <span className={styles.tag}>{strings.host}</span>
              </span>
              <span className={styles.person}>
                {booking.visitorName} <span className={styles.personEmail}>{booking.visitorEmail}</span>
              </span>
              {booking.guests.length > 0 && (
                <span className={styles.personEmail}>{strings.alsoInvited(booking.guests.join(', '))}</span>
              )}
            </dd>
            {booking.videoUrl === undefined && (
              <>
                <dt className={styles.factTerm}>{strings.where}</dt>
                <dd className={styles.factValue}>{whereOf(booking)}</dd>
              </>
            )}
            {booking.note !== undefined && (
              <>
                <dt className={styles.factTerm}>{strings.yourNote}</dt>
                <dd className={styles.factValue}>{booking.note}</dd>
              </>
            )}
          </dl>
          {isLive ? (
            <section className={styles.actionBand} aria-label={strings.addToCalendar}>
              {booking.videoUrl === undefined ? (
                <span className={styles.actionLabel}>{strings.addToCalendar}</span>
              ) : (
                <a className={styles.join} href={booking.videoUrl} rel="noreferrer" target="_blank">
                  {strings.joinCall}
                </a>
              )}
              <div className={styles.linkRow}>
                <a
                  className={styles.secondary}
                  href={google}
                  rel="noreferrer"
                  target="_blank"
                  aria-label={strings.addTo(strings.google)}
                >
                  {strings.google}
                </a>
                <a
                  className={styles.secondary}
                  href={outlook}
                  rel="noreferrer"
                  target="_blank"
                  aria-label={strings.addTo(strings.outlook)}
                >
                  {strings.outlook}
                </a>
                <a
                  className={styles.secondary}
                  href={client.icsUrl(token)}
                  download="booking.ics"
                  aria-label={strings.icsFile}
                >
                  {strings.apple}
                </a>
              </div>
            </section>
          ) : (
            <p className={styles.nextLine}>
              {booking.state === 'cancelled' ? strings.cancelledNext : strings.pastNext}{' '}
              <a className={styles.anchor} href={bookAgain}>
                {booking.state === 'cancelled' ? strings.bookAnother(booking.hostName) : strings.bookAgain}
              </a>
            </p>
          )}
        </article>
        <Brand placement="page" />
      </div>
    </main>
  );
}
