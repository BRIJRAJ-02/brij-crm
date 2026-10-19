// Brief
// Purpose: the public booking page at /b/<publicKey> (spec 0025, AC-630, AC-632, AC-636): a visitor books time with a member.
// Main task: pick a day and a time in their own zone, give a name and email, book; a time taken meanwhile sends them back to fresh times.
// Leaves out: questions (milestone 2), cancel and reschedule (milestone 2), analytics, captcha and the CRM app itself.
//
// Spec 0023's visitor rules: plain inputs with the tokens compiled in (no library, no field editors), labels above
// inputs, errors under their field with the first focused, one role="alert" line for anything else, a honeypot
// and the load time instead of a captcha, and the thank you taking focus.
import { createBookingClient, isDataError, type PublicBooking, type PublicBookingPage } from '@crm/data/booking';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './booking.module.css';
import { strings } from './strings.ts';
import { addDays, dayKey, dayLabels, momentLabel, startOfDay, timeLabel, weekLabel } from './time.ts';

/** A visitor's name and email handed in by a form (spec 0023's "Book a quick meeting"); see `readPrefill`. */
export interface Prefill {
  readonly name?: string;
  readonly email?: string;
}

/** Props for the page: its key from the address, the visitor's language and zone, the clock and any prefill. */
export interface BookingPageProps {
  readonly publicKey: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly now: () => number;
  readonly prefill?: Prefill;
}

type Client = ReturnType<typeof createBookingClient>;

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly page: PublicBookingPage }
  | { readonly state: 'gone' | 'closed' | 'failed' };

type Step =
  | { readonly step: 'pick'; readonly notice?: string }
  | { readonly step: 'details'; readonly start: string; readonly attempt: string }
  | { readonly step: 'done'; readonly booking: PublicBooking };

/** Every zone this browser knows, the visitor's own first when it isn't listed. */
function zones(current: string): readonly string[] {
  const listed = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return listed.includes(current) ? listed : [current, ...listed];
}

const zoneName = (zone: string) => zone.replaceAll('_', ' ');

/** A heading that takes focus when it appears (a step's change, the thank you). */
function FocusedTitle({ children }: { readonly children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h1 ref={ref} tabIndex={-1} className={styles.title}>
      {children}
    </h1>
  );
}

/** The page: its facts load once; then the week, the details and the thank you. */
export function BookingPage({ publicKey, locale, timeZone, now, prefill }: BookingPageProps) {
  const client = useMemo(() => createBookingClient({ origin: globalThis.location.origin }), []);
  const [startedAt] = useState(now);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
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

  if (loaded.state === 'loading') {
    return (
      <main className={styles.page} aria-busy="true">
        <div className={styles.card}>
          <p className={styles.text}>{strings.loading}</p>
        </div>
      </main>
    );
  }
  if (loaded.state !== 'ready') {
    const [title, text] =
      loaded.state === 'gone'
        ? [strings.goneTitle, strings.goneText]
        : loaded.state === 'closed'
          ? [strings.closedTitle, strings.closedText]
          : [strings.failedTitle, strings.failedText];
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <FocusedTitle>{title}</FocusedTitle>
          <p className={styles.text}>{text}</p>
          {loaded.state === 'failed' && (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setLoaded({ state: 'loading' });
                load();
              }}
            >
              {strings.retry}
            </button>
          )}
        </div>
      </main>
    );
  }
  return (
    <Booking
      client={client}
      page={loaded.page}
      locale={locale}
      detected={timeZone}
      now={now}
      startedAt={startedAt}
      {...(prefill === undefined ? {} : { prefill })}
    />
  );
}

/** Where the meeting happens, as one sentence. */
function whereOf(page: PublicBookingPage): string {
  switch (page.location.type) {
    case 'video':
      return strings.location.video;
    case 'phone':
      return strings.location.phone;
    default:
      return page.location.value;
  }
}

/** The booking steps for a loaded page. */
function Booking({
  client,
  page,
  locale,
  detected,
  now,
  startedAt,
  prefill,
}: {
  readonly client: Client;
  readonly page: PublicBookingPage;
  readonly locale: string;
  readonly detected: string;
  readonly now: () => number;
  readonly startedAt: number;
  readonly prefill?: Prefill;
}) {
  const [zone, setZone] = useState(detected);
  const [duration, setDuration] = useState<number>(page.durations[0] ?? 30);
  const today = dayKey(now(), zone);
  const [weekStart, setWeekStart] = useState(today);
  const [step, setStep] = useState<Step>({ step: 'pick' });

  if (step.step === 'done') {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <p className={styles.host}>{page.hostName}</p>
          <FocusedTitle>{strings.confirmedTitle}</FocusedTitle>
          <p className={styles.text}>{strings.confirmedText(page.hostName)}</p>
          <dl className={styles.details}>
            <dt className={styles.term}>{strings.when}</dt>
            <dd
              className={styles.description}
            >{`${momentLabel(step.booking.start, zone, locale)} (${zoneName(zone)})`}</dd>
            <dt className={styles.term}>{strings.with}</dt>
            <dd className={styles.description}>{page.hostName}</dd>
            <dt className={styles.term}>{strings.where}</dt>
            <dd className={styles.description}>{whereOf(page)}</dd>
          </dl>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.host}>{page.hostName}</p>
        <h1 className={styles.title}>{page.title}</h1>
        {page.description !== '' && <p className={styles.text}>{page.description}</p>}
        <p className={styles.note}>{whereOf(page)}</p>
        {step.step === 'pick' ? (
          <>
            {step.notice !== undefined && (
              <p className={styles.alert} role="alert">
                {step.notice}
              </p>
            )}
            {page.durations.length > 1 && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="booking-length">
                  {strings.length}
                </label>
                <select
                  id="booking-length"
                  className={styles.input}
                  value={String(duration)}
                  onChange={(event) => setDuration(Number(event.target.value))}
                >
                  {page.durations.map((minutes) => (
                    <option key={minutes} value={String(minutes)}>
                      {strings.minutes(minutes)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="booking-zone">
                {strings.zone}
              </label>
              <select
                id="booking-zone"
                className={styles.input}
                value={zone}
                onChange={(event) => setZone(event.target.value)}
              >
                {zones(zone).map((each) => (
                  <option key={each} value={each}>
                    {zoneName(each)}
                  </option>
                ))}
              </select>
            </div>
            <Week
              client={client}
              page={page}
              zone={zone}
              duration={duration}
              locale={locale}
              today={today}
              horizon={dayKey(now() + page.windowDays * 86_400_000, zone)}
              weekStart={weekStart}
              onWeek={setWeekStart}
              reloadKey={step.notice ?? ''}
              onPick={(start) => setStep({ step: 'details', start, attempt: crypto.randomUUID() })}
            />
          </>
        ) : (
          <Details
            client={client}
            page={page}
            start={step.start}
            attempt={step.attempt}
            duration={duration}
            zone={zone}
            locale={locale}
            startedAt={startedAt}
            {...(prefill === undefined ? {} : { prefill })}
            onBack={(notice) => setStep(notice === undefined ? { step: 'pick' } : { step: 'pick', notice })}
            onBooked={(booking) => setStep({ step: 'done', booking })}
          />
        )}
      </div>
    </main>
  );
}

/** A week of days and the chosen day's times, read for the range shown; the next free day chosen. */
function Week({
  client,
  page,
  zone,
  duration,
  locale,
  today,
  horizon,
  weekStart,
  onWeek,
  reloadKey,
  onPick,
}: {
  readonly client: Client;
  readonly page: PublicBookingPage;
  readonly zone: string;
  readonly duration: number;
  readonly locale: string;
  readonly today: string;
  readonly horizon: string;
  readonly weekStart: string;
  readonly onWeek: (key: string) => void;
  readonly reloadKey: string;
  readonly onPick: (start: string) => void;
}) {
  const [reload, setReload] = useState(0);
  const requestKey = `${weekStart}|${zone}|${String(duration)}|${String(reload)}|${reloadKey}`;
  // The answer to the latest range asked for; another range still loading shows as loading.
  const [slots, setSlots] = useState<{
    readonly key: string;
    readonly ok: boolean;
    readonly starts: readonly string[];
  }>({
    key: '',
    ok: true,
    starts: [],
  });
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    client
      .slots(
        page.publicKey,
        {
          from: new Date(startOfDay(weekStart, zone)).toISOString(),
          to: new Date(startOfDay(addDays(weekStart, 7), zone)).toISOString(),
          duration,
          tz: zone,
        },
        controller.signal,
      )
      .then(
        (answer) => {
          const starts = answer.slots.map((slot) => slot.start);
          setSlots({ key: requestKey, ok: true, starts });
          const first = starts[0];
          setChosen(first === undefined ? undefined : dayKey(Date.parse(first), zone));
        },
        (error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setSlots({ key: requestKey, ok: false, starts: [] });
        },
      );
    return () => controller.abort();
  }, [client, page.publicKey, weekStart, zone, duration, requestKey]);
  const status = slots.key !== requestKey ? 'loading' : slots.ok ? 'ready' : 'error';
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const byDay = new Map<string, string[]>();
  for (const start of status === 'ready' ? slots.starts : []) {
    const key = dayKey(Date.parse(start), zone);
    byDay.set(key, [...(byDay.get(key) ?? []), start]);
  }
  const chosenTimes = chosen === undefined ? [] : (byDay.get(chosen) ?? []);
  const chosenLabel = chosen === undefined ? '' : dayLabels(chosen, locale).label;
  return (
    <section className={styles.picker} aria-label={strings.days}>
      <div className={styles.week}>
        <button
          type="button"
          className={`${styles.button} ${styles.arrow}`}
          aria-label={strings.previousWeek}
          disabled={weekStart <= today || status === 'loading'}
          onClick={() => onWeek(addDays(weekStart, -7) < today ? today : addDays(weekStart, -7))}
        >
          ‹
        </button>
        <h2 className={styles.weekLabel} aria-live="polite">
          {weekLabel(weekStart, days[6] ?? weekStart, locale)}
        </h2>
        <button
          type="button"
          className={`${styles.button} ${styles.arrow}`}
          aria-label={strings.nextWeek}
          disabled={addDays(weekStart, 7) > horizon || status === 'loading'}
          onClick={() => onWeek(addDays(weekStart, 7))}
        >
          ›
        </button>
      </div>
      {status === 'loading' ? (
        <p className={styles.text} aria-busy="true">
          {strings.timesLoading}
        </p>
      ) : status === 'error' ? (
        <>
          <p className={styles.alert} role="alert">
            {strings.timesFailed}
          </p>
          <button type="button" className={styles.button} onClick={() => setReload((count) => count + 1)}>
            {strings.retry}
          </button>
        </>
      ) : (
        <>
          <fieldset className={styles.days}>
            <legend className={styles.legend}>{strings.days}</legend>
            {days.map((key) => {
              const labels = dayLabels(key, locale);
              const open = (byDay.get(key) ?? []).length > 0;
              return (
                <label key={key} className={styles.day}>
                  <input
                    type="radio"
                    name="booking-day"
                    className={styles.radio}
                    value={key}
                    checked={chosen === key}
                    disabled={!open}
                    aria-label={open ? labels.label : `${labels.label}, ${strings.noTimesDay}`}
                    onChange={() => setChosen(key)}
                  />
                  <span className={styles.weekday} aria-hidden="true">
                    {labels.weekday}
                  </span>
                  <span className={styles.dayNumber} aria-hidden="true">
                    {labels.day}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {byDay.size === 0 ? (
            <p className={styles.text}>{strings.emptyWeek}</p>
          ) : (
            chosen !== undefined && (
              <ul className={styles.times} aria-label={strings.timesOn(chosenLabel)}>
                {chosenTimes.map((start) => (
                  <li key={start}>
                    <button type="button" className={styles.button} onClick={() => onPick(start)}>
                      {timeLabel(start, zone, locale)}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      )}
    </section>
  );
}

type FieldName = 'name' | 'email' | 'phone';

/** A rough email shape: the server checks it properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The visitor's details for the chosen time, and Book. */
function Details({
  client,
  page,
  start,
  attempt,
  duration,
  zone,
  locale,
  startedAt,
  prefill,
  onBack,
  onBooked,
}: {
  readonly client: Client;
  readonly page: PublicBookingPage;
  readonly start: string;
  readonly attempt: string;
  readonly duration: number;
  readonly zone: string;
  readonly locale: string;
  readonly startedAt: number;
  readonly prefill?: Prefill;
  readonly onBack: (notice?: string) => void;
  readonly onBooked: (booking: PublicBooking) => void;
}) {
  const needsPhone = page.location.type === 'phone';
  const [values, setValues] = useState<Record<FieldName, string>>({
    name: prefill?.name ?? '',
    email: prefill?.email ?? '',
    phone: '',
  });
  const [trap, setTrap] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [alert, setAlert] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const inputs = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({});
  const order: readonly FieldName[] = needsPhone ? ['name', 'email', 'phone'] : ['name', 'email'];

  const check = (next: Record<FieldName, string>): Partial<Record<FieldName, string>> => ({
    ...(next.name.trim() === '' ? { name: strings.nameRequired } : {}),
    ...(EMAIL.test(next.email.trim()) ? {} : { email: strings.emailRequired }),
    ...(needsPhone && next.phone.trim() === '' ? { phone: strings.phoneRequired } : {}),
  });
  const focusFirst = (found: Partial<Record<FieldName, string>>) => {
    const first = order.find((field) => found[field] !== undefined);
    if (first !== undefined) inputs.current[first]?.focus();
  };
  const set = (field: FieldName, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    // A field with an error is checked again on each change.
    if (errors[field] !== undefined) setErrors((current) => ({ ...current, [field]: check(next)[field] }));
  };

  const book = () => {
    if (isBusy) return;
    const found = check(values);
    setErrors(found);
    setAlert(undefined);
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    setBusy(true);
    client
      .book(page.publicKey, {
        idempotencyKey: attempt,
        start,
        duration: duration as 15 | 30 | 45 | 60 | 90,
        name: values.name.trim(),
        email: values.email.trim(),
        timeZone: zone,
        ...(needsPhone ? { phone: values.phone.trim() } : {}),
        company_url: trap,
        startedAt,
      })
      .then(onBooked, (error: unknown) => {
        setBusy(false);
        if (!isDataError(error)) {
          setAlert(strings.tryAgain);
          return;
        }
        if (error.code === 'SLOT_TAKEN') {
          onBack(strings.taken);
          return;
        }
        const fromServer: Partial<Record<FieldName, string>> = {};
        for (const issue of error.data?.issues ?? []) {
          const field = issue.path[0];
          if ((field === 'name' || field === 'email' || field === 'phone') && fromServer[field] === undefined) {
            fromServer[field] = issue.message;
          }
        }
        for (const refusal of error.data?.refusals ?? []) {
          const field = refusal.field;
          if ((field === 'name' || field === 'email' || field === 'phone') && fromServer[field] === undefined) {
            fromServer[field] = refusal.message;
          }
        }
        if (Object.keys(fromServer).length > 0) {
          setErrors(fromServer);
          focusFirst(fromServer);
          return;
        }
        setAlert(
          error.code === 'API_UNAVAILABLE'
            ? strings.offline
            : error.code === 'INPUT_INVALID'
              ? strings.tryAgain
              : error.message,
        );
      });
  };

  const field = (
    name: FieldName,
    label: string,
    type: 'text' | 'email' | 'tel',
    autoComplete: string,
    hint?: string,
  ) => {
    const error = errors[name];
    const describedBy = [
      hint === undefined ? undefined : `booking-${name}-hint`,
      error === undefined ? undefined : `booking-${name}-error`,
    ]
      .filter((id) => id !== undefined)
      .join(' ');
    return (
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`booking-${name}`}>
          {label}
        </label>
        {hint !== undefined && (
          <p id={`booking-${name}-hint`} className={styles.text}>
            {hint}
          </p>
        )}
        <input
          id={`booking-${name}`}
          ref={(element) => {
            inputs.current[name] = element;
          }}
          className={styles.input}
          type={type}
          name={name}
          autoComplete={autoComplete}
          maxLength={name === 'email' ? 254 : name === 'phone' ? 40 : 200}
          value={values[name]}
          aria-invalid={error === undefined ? undefined : true}
          {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
          onChange={(event) => set(name, event.target.value)}
        />
        {error !== undefined && (
          <p id={`booking-${name}-error`} className={styles.error}>
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <form
      className={styles.field}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        book();
      }}
    >
      <p className={styles.note}>
        {`${momentLabel(start, zone, locale)}, ${strings.minutes(duration)} (${zoneName(zone)})`}
      </p>
      {field('name', strings.name, 'text', 'name')}
      {field('email', strings.email, 'email', 'email')}
      {needsPhone && field('phone', strings.phone, 'tel', 'tel', strings.phoneHint)}
      <div className={styles.trap} aria-hidden="true">
        <label htmlFor="booking-company-url">{strings.trap}</label>
        <input
          id="booking-company-url"
          name="company_url"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={(event) => setTrap(event.target.value)}
        />
      </div>
      {alert !== undefined && (
        <p className={styles.alert} role="alert">
          {alert}
        </p>
      )}
      <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={isBusy}>
        {isBusy ? strings.booking : strings.book}
      </button>
      <button type="button" className={styles.link} disabled={isBusy} onClick={() => onBack()}>
        {strings.back}
      </button>
    </form>
  );
}
