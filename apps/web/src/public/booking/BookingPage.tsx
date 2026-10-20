// Brief
// Purpose: the visitor's booking page at /b/<publicKey> (spec 0025, 0025-experience.md): book time with a member.
// Main task: see the first open day's times at once, pick a time, press the bar that names it, give a name and email, confirm.
// Leaves out: questions (milestone 2), the forms hand off's signed prefill (milestone 3, a seam), analytics and captcha.
//
// Built by hand with plain markup and the compiled tokens (spec 0023's public bundle rules), laid out as the
// timefix booking page: a rail (the host, the title as the page's heading, the length, the place and the time
// zone, and Timefix pinned at its foot) beside the card on wide screens; stacked on a phone, Timefix at the end.
import { createBookingClient, isDataError, withPreviewDraft, type PublicBookingPage } from '@crm/data/booking';
import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './booking.module.css';
import { Details } from './Details.tsx';
import { Picker } from './Picker.tsx';
import type { Prefill } from './prefill.ts';
import { saveHour12, savedHour12, savedView, saveView, type SlotView } from './prefs.ts';
import { strings } from './strings.ts';
import { addDays, dayKey, localeUses12h, monthOf, startOfDay } from './time.ts';
import { ZoneMenu } from './ZoneMenu.tsx';

/** Props for the page: its key, the visitor's language and zone, the clock, a prefill, and where success goes. */
export interface BookingPageProps {
  readonly publicKey: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly now: () => number;
  readonly prefill?: Prefill;
  /** Opens the guest page once booked. */
  readonly onBooked: (manageToken: string) => void;
}

type Client = ReturnType<typeof createBookingClient>;

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly page: PublicBookingPage }
  | { readonly state: 'gone' | 'closed' | 'failed' };

/** One slots read covers 62 days (two months of the month view). */
const CHUNK_DAYS = 62;

/** The host's initials, for the rail's avatar. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** How the location reads in the facts: "Video call", "Phone call", or the address or words the host gave. */
const locationLabel = (location: PublicBookingPage['location']) =>
  location.type === 'video'
    ? strings.locations.video
    : location.type === 'phone'
      ? strings.locations.phone
      : location.value;

/** A clock, for the meeting's length (Lucide's shape, drawn here since the page loads no library). */
function ClockIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

/**
 * Timefix under the booking: "Powered by" over the wordmark, in a quiet card at the rail's foot on wide
 * screens and centred at the page's end on a phone. No workspace name: the visitor books the host, not the
 * workspace (the owner's call, 20 October 2026). The wordmark is one image
 * per theme, and CSS shows the one for the theme in use.
 */
export function Brand({ placement }: { readonly placement: 'rail' | 'page' }) {
  return (
    <footer className={styles.brand} data-placement={placement}>
      <a className={styles.brandLink} href="https://timefix.ai" rel="noopener noreferrer">
        <span className={styles.brandLabel}>{strings.poweredBy}</span>
        <img
          className={styles.wordmark}
          data-scheme="light"
          src="/brand/timefix-wordmark-light.png"
          alt={strings.product}
        />
        <img
          className={styles.wordmark}
          data-scheme="dark"
          src="/brand/timefix-wordmark-dark.png"
          alt={strings.product}
        />
      </a>
    </footer>
  );
}

/** The location's icon: video, pin or phone. */
function LocationIcon({ type }: { readonly type: PublicBookingPage['location']['type'] }) {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
      {type === 'video' ? (
        <path d="m22 8-6 4 6 4V8ZM2 7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7Z" />
      ) : type === 'phone' ? (
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
      ) : (
        <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Zm-8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      )}
    </svg>
  );
}

/** The page: its facts load once, then the steps; each state as the experience note writes it. */
export function BookingPage({ publicKey, locale, timeZone, now, prefill, onBooked }: BookingPageProps) {
  const client = useMemo(() => createBookingClient({ origin: globalThis.location.origin }), []);
  const [startedAt] = useState(now);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  // The last preview message, kept until the page loads to lay it over.
  const [preview, setPreview] = useState<unknown>(undefined);
  const load = useCallback(() => {
    client.page(publicKey).then(
      (page) => setLoaded({ state: 'ready', page }),
      (error: unknown) => {
        const code = isDataError(error) ? error.code : undefined;
        setLoaded({ state: code === 'NOT_FOUND' ? 'gone' : code === 'BOOKING_CLOSED' ? 'closed' : 'failed' });
      },
    );
  }, [client, publicKey]);
  useEffect(load, [load]);
  // Inside the editor's preview frame, the editor's unsaved draft shows over the saved page (AC-679):
  // only from the parent window on this same origin.
  useEffect(() => {
    if (globalThis.parent === globalThis.window) return;
    const listen = (event: MessageEvent) => {
      if (event.origin !== globalThis.location.origin || event.source !== globalThis.parent) return;
      setPreview(event.data);
    };
    globalThis.addEventListener('message', listen);
    return () => {
      globalThis.removeEventListener('message', listen);
    };
  }, []);

  if (loaded.state === 'ready') {
    return (
      <Booking
        client={client}
        page={withPreviewDraft(loaded.page, preview) ?? loaded.page}
        locale={locale}
        detected={timeZone}
        now={now}
        startedAt={startedAt}
        onBooked={onBooked}
        {...(prefill === undefined ? {} : { prefill })}
      />
    );
  }
  return (
    <main className={styles.page}>
      <div className={styles.solo}>
        {loaded.state === 'loading' ? (
          <div className={styles.card} aria-busy="true" aria-label={strings.loading}>
            <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
            <div className={`${styles.skeleton} ${styles.skeletonMonth}`} />
            <div className={`${styles.skeleton} ${styles.skeletonBar}`} />
          </div>
        ) : (
          <div className={styles.card}>
            <h1 className={styles.title}>
              {loaded.state === 'gone'
                ? strings.notFoundTitle
                : loaded.state === 'closed'
                  ? strings.paused
                  : strings.failedTitle}
            </h1>
            {loaded.state !== 'closed' && (
              <p className={styles.muted}>{loaded.state === 'gone' ? strings.notFoundText : strings.failedText}</p>
            )}
            {loaded.state === 'failed' && (
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  setLoaded({ state: 'loading' });
                  load();
                }}
              >
                {strings.retry}
              </button>
            )}
          </div>
        )}
        <Brand placement="page" />
      </div>
    </main>
  );
}

/** The loaded page: rail, headline, and the card with its two steps. */
function Booking({
  client,
  page,
  locale,
  detected,
  now,
  startedAt,
  prefill,
  onBooked,
}: {
  readonly client: Client;
  readonly page: PublicBookingPage;
  readonly locale: string;
  readonly detected: string;
  readonly now: () => number;
  readonly startedAt: number;
  readonly prefill?: Prefill;
  readonly onBooked: (manageToken: string) => void;
}) {
  const [zone, setZone] = useState(detected);
  const [hour12, setHour12] = useState(() => savedHour12() ?? localeUses12h(locale));
  const [view, setView] = useState<SlotView>(savedView);
  const [chosen, setDuration] = useState<number>(page.durations[0] ?? 30);
  // A length the page no longer offers (the editor's preview changed them) falls back to its first.
  const duration = page.durations.some((minutes) => minutes === chosen) ? chosen : (page.durations[0] ?? 30);
  const today = dayKey(now(), zone);
  const horizon = dayKey(now() + page.windowDays * 86_400_000, zone);
  const chunks = Math.max(1, Math.ceil(page.windowDays / CHUNK_DAYS));
  // Slots by chunk of 62 days from today, for the zone and length they were read in.
  const [read, setRead] = useState<{
    readonly key: string;
    readonly loaded: ReadonlyMap<number, readonly string[]>;
    readonly unreachable: boolean;
    readonly failed: boolean;
  }>({ key: '', loaded: new Map(), unreachable: false, failed: false });
  const [wanted, setWanted] = useState(0);
  const [reload, setReload] = useState(0);
  const readKey = `${zone}|${String(duration)}|${String(reload)}`;
  const [day, setDay] = useState<string | undefined>(undefined);
  const [month, setMonth] = useState(monthOf(today));
  const [time, setTime] = useState<string | undefined>(undefined);
  const [step, setStep] = useState<{
    readonly step: 'pick' | 'details';
    readonly attempt: string;
    readonly back: boolean;
  }>({
    step: 'pick',
    attempt: '',
    back: false,
  });
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // The tab names the meeting and the host: "Intro call with Ada · Timefix".
  useEffect(() => {
    document.title = `${page.title} with ${page.hostName} · ${strings.product}`;
  }, [page.title, page.hostName]);

  useEffect(() => {
    const current = read.key === readKey ? read.loaded : new Map<number, readonly string[]>();
    if (current.has(wanted)) return;
    const controller = new AbortController();
    const from = startOfDay(addDays(today, wanted * CHUNK_DAYS), zone);
    const to = startOfDay(addDays(today, (wanted + 1) * CHUNK_DAYS), zone);
    client
      .slots(
        page.publicKey,
        { from: new Date(Math.max(from, now())).toISOString(), to: new Date(to).toISOString(), duration, tz: zone },
        controller.signal,
      )
      .then(
        (answer) => {
          const next = new Map(current);
          next.set(
            wanted,
            answer.slots.map((slot) => slot.start),
          );
          setRead({ key: readKey, loaded: next, unreachable: answer.calendar === 'unreachable', failed: false });
          // The first open day is chosen on arrival (AC-665); further chunks on until one has times.
          const first = [...next.values()].flat().sort()[0];
          if (first === undefined && wanted + 1 < chunks) setWanted(wanted + 1);
          setDay((chosen) => chosen ?? (first === undefined ? undefined : dayKey(Date.parse(first), zone)));
          if (first !== undefined)
            setMonth((shown) => (shown === monthOf(today) ? monthOf(dayKey(Date.parse(first), zone)) : shown));
        },
        (error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setRead({ key: readKey, loaded: current, unreachable: false, failed: true });
        },
      );
    return () => controller.abort();
  }, [client, page.publicKey, zone, duration, wanted, readKey, read, today, chunks, now]);

  const loaded = read.key === readKey ? read.loaded : new Map<number, readonly string[]>();
  const starts = [...loaded.values()].flat().sort();
  const byDay = new Map<string, string[]>();
  for (const start of starts) {
    const key = dayKey(Date.parse(start), zone);
    byDay.set(key, [...(byDay.get(key) ?? []), start]);
  }
  const isLoading = !loaded.has(0) && !read.failed;
  // Moving to a month past what's read asks for its chunk.
  const showMonth = (next: string) => {
    setMonth(next);
    const offset = Math.floor((startOfDay(`${next}-01`, zone) - startOfDay(today, zone)) / 86_400_000 / CHUNK_DAYS);
    for (let chunk = 0; chunk <= Math.min(offset + 1, chunks - 1); chunk += 1) {
      if (!loaded.has(chunk)) {
        setWanted(chunk);
        break;
      }
    }
  };
  const resetChoice = () => {
    setDay(undefined);
    setTime(undefined);
    setMonth(monthOf(today));
    setWanted(0);
  };

  const card = (
    <section className={styles.card} aria-label={page.title}>
      {notice !== undefined && step.step === 'pick' && (
        <p className={styles.errorLine} role="alert">
          {notice}
        </p>
      )}
      {page.durations.length > 1 && step.step === 'pick' && (
        <div className={styles.segmented} role="radiogroup" aria-label={strings.length}>
          {page.durations.map((minutes) => (
            <button
              key={minutes}
              type="button"
              role="radio"
              aria-checked={duration === minutes}
              className={styles.segment}
              onClick={() => {
                setDuration(minutes);
                resetChoice();
              }}
            >
              {strings.minutesShort(minutes)}
            </button>
          ))}
        </div>
      )}
      {step.step === 'details' && time !== undefined ? (
        <div className={styles.swap} data-enter="forward">
          <Details
            client={client}
            page={page}
            start={time}
            attempt={step.attempt}
            duration={duration}
            zone={zone}
            locale={locale}
            hour12={hour12}
            startedAt={startedAt}
            now={now()}
            {...(prefill === undefined ? {} : { prefill })}
            onBack={(taken) => {
              setStep({ step: 'pick', attempt: '', back: true });
              if (taken === true) {
                setNotice(strings.errors.taken);
                setTime(undefined);
                setReload((count) => count + 1);
              } else {
                setNotice(undefined);
              }
            }}
            onBooked={(booked) => onBooked(booked.manageToken)}
          />
        </div>
      ) : isLoading ? (
        <div aria-busy="true" aria-label={strings.loading}>
          <div className={`${styles.skeleton} ${styles.skeletonMonth}`} />
          <div className={`${styles.skeleton} ${styles.skeletonBar}`} />
        </div>
      ) : read.unreachable ? (
        <p className={styles.state}>{strings.unreachable(page.hostName)}</p>
      ) : read.failed ? (
        <div className={styles.state}>
          <p role="alert">{strings.errors.failed}</p>
          <button type="button" className={styles.secondary} onClick={() => setReload((count) => count + 1)}>
            {strings.retry}
          </button>
        </div>
      ) : starts.length === 0 && loaded.size >= Math.min(chunks, 2) ? (
        <div className={styles.state}>
          <p className={styles.stateTitle}>{strings.noTimesTitle}</p>
          <p className={styles.muted}>{strings.noTimesText}</p>
        </div>
      ) : (
        <div className={styles.swap} data-enter={step.back ? 'back' : undefined}>
          <Picker
            byDay={byDay}
            today={today}
            lastMonth={monthOf(horizon)}
            zone={zone}
            locale={locale}
            hour12={hour12}
            onHour12={(next) => {
              setHour12(next);
              saveHour12(next);
            }}
            view={view}
            onView={(next) => {
              setView(next);
              saveView(next);
            }}
            duration={duration}
            day={day}
            onDay={(next) => {
              setDay(next);
              setTime(undefined);
            }}
            month={month}
            onMonth={showMonth}
            time={time}
            onTime={setTime}
            onCommit={() => {
              setNotice(undefined);
              setStep({ step: 'details', attempt: crypto.randomUUID(), back: false });
            }}
            focusDay={step.back}
          />
        </div>
      )}
    </section>
  );

  return (
    <main className={styles.page}>
      <div className={styles.layout}>
        <aside className={styles.rail}>
          <div className={styles.identity}>
            <span className={styles.avatar} aria-hidden="true">
              {initials(page.hostName)}
            </span>
            <p className={styles.hostName}>{page.hostName}</p>
            <h1 className={styles.headline}>{page.title}</h1>
            {page.description !== '' && <p className={styles.description}>{page.description}</p>}
            <ul className={styles.facts}>
              <li className={styles.fact}>
                <ClockIcon />
                <span>{strings.minutesShort(duration)}</span>
              </li>
              <li className={styles.fact}>
                <LocationIcon type={page.location.type} />
                <span>{locationLabel(page.location)}</span>
              </li>
              <li className={styles.fact}>
                <ZoneMenu
                  zone={zone}
                  now={now()}
                  onChange={(next) => {
                    setZone(next);
                    resetChoice();
                  }}
                />
              </li>
            </ul>
          </div>
          <Brand placement="rail" />
        </aside>
        <div className={styles.main}>{card}</div>
        <Brand placement="page" />
      </div>
    </main>
  );
}
