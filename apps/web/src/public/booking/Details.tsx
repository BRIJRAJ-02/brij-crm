// Step 2, Your details (spec 0025 experience, AC-670 to AC-672): the slot with
// Change time, name, email with guests, a phone number for a phone page, the
// note, then Confirm booking. Labels above inputs, "optional" after optional
// ones, errors under their field with the first focused, and one reserved line
// above the button for the rest, so the button never moves.
import { useEffect, useRef, useState } from 'react';
import { isDataError, type BookingClient, type PublicBooked, type PublicBookingPage } from '@crm/data/booking';
import styles from './booking.module.css';
import type { Prefill } from './prefill.ts';
import { strings } from './strings.ts';
import { slotLabel, zoneDisplay } from './time.ts';

/** A rough email shape; the server checks it properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldName = 'name' | 'email' | 'phone';

/** Props for the details step. */
export interface DetailsProps {
  readonly client: BookingClient;
  readonly page: PublicBookingPage;
  readonly start: string;
  readonly attempt: string;
  readonly duration: number;
  readonly zone: string;
  readonly locale: string;
  readonly hour12: boolean;
  readonly startedAt: number;
  readonly now: number;
  readonly prefill?: Prefill;
  /** Back to the times: with an error line when the time went meanwhile. */
  readonly onBack: (taken?: boolean) => void;
  readonly onBooked: (booked: PublicBooked) => void;
}

/** The form for the chosen slot. */
export function Details(props: DetailsProps) {
  const { client, page, start, attempt, duration, zone, locale, hour12, startedAt, now, prefill, onBack, onBooked } =
    props;
  const needsPhone = page.location.type === 'phone';
  const [values, setValues] = useState<Record<FieldName, string>>({
    name: prefill?.name ?? '',
    email: prefill?.email ?? '',
    phone: '',
  });
  const [guests, setGuests] = useState<readonly string[]>([]);
  const [note, setNote] = useState('');
  const [trap, setTrap] = useState('');
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [line, setLine] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [isPrefilled, setPrefilled] = useState(prefill?.name !== undefined && prefill.name !== '');
  const form = useRef<HTMLFormElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const addGuest = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  /** Focuses a guest row once it is drawn. */
  const focusGuest = (index: number) =>
    globalThis.requestAnimationFrame(() =>
      form.current?.querySelector<HTMLInputElement>(`[data-field="guest-${String(index)}"]`)?.focus(),
    );

  const check = (next: Record<FieldName, string>, nextGuests: readonly string[]): Partial<Record<string, string>> => {
    const found: Record<string, string> = {};
    if (next.name.trim() === '') found.name = strings.nameRequired;
    if (!EMAIL.test(next.email.trim())) found.email = strings.emailRequired;
    if (needsPhone && next.phone.trim() === '') found.phone = strings.phoneRequired;
    nextGuests.forEach((guest, index) => {
      if (guest.trim() !== '' && !EMAIL.test(guest.trim())) found[`guest-${String(index)}`] = strings.guestInvalid;
    });
    return found;
  };
  const focusFirst = (found: Partial<Record<string, string>>) => {
    const first = Object.keys(found)[0];
    if (first !== undefined) form.current?.querySelector<HTMLInputElement>(`[data-field="${first}"]`)?.focus();
  };
  const set = (field: FieldName, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    if (errors[field] !== undefined) setErrors((current) => ({ ...current, [field]: check(next, guests)[field] }));
  };

  const book = () => {
    if (isBusy) return;
    const found = check(values, guests);
    setErrors(found);
    setLine('');
    if (Object.keys(found).length > 0) {
      focusFirst(found);
      return;
    }
    setBusy(true);
    const invited = guests.map((guest) => guest.trim()).filter((guest) => guest !== '');
    client
      .book(page.publicKey, {
        idempotencyKey: attempt,
        start,
        duration: duration as 15 | 30 | 45 | 60 | 90,
        name: values.name.trim(),
        email: values.email.trim(),
        timeZone: zone,
        ...(needsPhone ? { phone: values.phone.trim() } : {}),
        ...(invited.length === 0 ? {} : { guests: invited }),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
        company_url: trap,
        startedAt,
      })
      .then(onBooked, (error: unknown) => {
        setBusy(false);
        if (!isDataError(error)) {
          setLine(strings.errors.failed);
          return;
        }
        if (error.code === 'SLOT_TAKEN') {
          onBack(true);
          return;
        }
        const fromServer: Record<string, string> = {};
        for (const issue of error.data?.issues ?? []) {
          const [field, index] = issue.path;
          const key = field === 'guests' && typeof index === 'number' ? `guest-${String(index)}` : field;
          if (typeof key === 'string' && fromServer[key] === undefined) fromServer[key] = issue.message;
        }
        for (const refusal of error.data?.refusals ?? []) {
          if (refusal.field !== undefined && fromServer[refusal.field] === undefined)
            fromServer[refusal.field] = refusal.message;
        }
        if (Object.keys(fromServer).length > 0) {
          setErrors(fromServer);
          focusFirst(fromServer);
          return;
        }
        setLine(
          error.code === 'RATE_LIMITED'
            ? strings.errors.tooMany
            : error.code === 'BOOKING_CLOSED' || error.code === 'NOT_FOUND'
              ? strings.errors.closed
              : error.code === 'CONFIG_INVALID'
                ? strings.errors.gone
                : error.code === 'API_UNAVAILABLE'
                  ? strings.errors.offline
                  : strings.errors.failed,
        );
      });
  };

  /** One labelled input with its error under it. */
  const field = (
    name: string,
    label: string,
    input: {
      readonly value: string;
      readonly onChange: (value: string) => void;
      readonly type?: string;
      readonly autoComplete?: string;
      readonly placeholder?: string;
      readonly maxLength: number;
    },
    extra?: React.ReactNode,
  ) => {
    const error = errors[name];
    const id = `booking-${name}`;
    return (
      <div className={styles.field}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        <div className={styles.inputRow}>
          <input
            id={id}
            data-field={name}
            className={styles.input}
            type={input.type ?? 'text'}
            autoComplete={input.autoComplete ?? 'off'}
            maxLength={input.maxLength}
            value={input.value}
            {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
            aria-invalid={error === undefined ? undefined : true}
            {...(error === undefined ? {} : { 'aria-describedby': `${id}-error` })}
            onChange={(event) => input.onChange(event.target.value)}
          />
          {extra}
        </div>
        {error !== undefined && (
          <p id={`${id}-error`} className={styles.error}>
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <form
      ref={form}
      className={styles.details}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        book();
      }}
    >
      <div className={styles.slotHead}>
        <button
          ref={back}
          type="button"
          className={styles.iconButton}
          aria-label={strings.changeTime}
          disabled={isBusy}
          onClick={() => onBack()}
        >
          <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <p className={styles.slotTitle}>{slotLabel(start, zone, locale, hour12)}</p>
          <p className={styles.muted}>{zoneDisplay(zone, now)}</p>
        </div>
      </div>
      {isPrefilled && (
        <p className={styles.muted}>
          {strings.bookingAs(values.name)}{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              setValues((current) => ({ ...current, name: '', email: '' }));
              setPrefilled(false);
              form.current?.querySelector<HTMLInputElement>('[data-field="name"]')?.focus();
            }}
          >
            {strings.notYou}
          </button>
        </p>
      )}
      {field('name', strings.yourName, {
        value: values.name,
        onChange: (value) => set('name', value),
        autoComplete: 'name',
        maxLength: 200,
      })}
      {field(
        'email',
        strings.email,
        {
          value: values.email,
          onChange: (value) => set('email', value),
          type: 'email',
          autoComplete: 'email',
          placeholder: strings.emailPlaceholder,
          maxLength: 254,
        },
        // "+ Add guest" opens the first guest row, and goes once the rows are open.
        guests.length === 0 ? (
          <button
            ref={addGuest}
            type="button"
            className={styles.ghost}
            onClick={() => {
              setGuests(['']);
              focusGuest(0);
            }}
          >
            {strings.addGuest}
          </button>
        ) : undefined,
      )}
      {guests.map((guest, index) => (
        <div key={`guest-${String(index)}`} className={styles.guestRow}>
          {field(
            `guest-${String(index)}`,
            strings.guest(index + 1),
            {
              value: guest,
              onChange: (value) => setGuests((current) => current.map((each, at) => (at === index ? value : each))),
              type: 'text',
              placeholder: strings.guestPlaceholder,
              maxLength: 254,
            },
            <>
              <button
                type="button"
                className={styles.roundButton}
                data-tone="remove"
                aria-label={strings.removeGuest(index + 1)}
                onClick={() => {
                  setGuests((current) => current.filter((_, at) => at !== index));
                  // The last row gone folds the guests away, and focus goes back to "+ Add guest".
                  if (guests.length === 1) globalThis.requestAnimationFrame(() => addGuest.current?.focus());
                  else focusGuest(Math.max(0, index - 1));
                }}
              >
                <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
              {guests.length < 10 && (
                <button
                  type="button"
                  className={styles.roundButton}
                  data-tone="add"
                  aria-label={strings.addAnotherGuest}
                  onClick={() => {
                    // A new row lands right after this one, and takes focus.
                    setGuests((current) => [...current.slice(0, index + 1), '', ...current.slice(index + 1)]);
                    focusGuest(index + 1);
                  }}
                >
                  <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
              )}
            </>,
          )}
        </div>
      ))}
      {needsPhone &&
        field('phone', strings.phone, {
          value: values.phone,
          onChange: (value) => set('phone', value),
          type: 'tel',
          autoComplete: 'tel',
          maxLength: 40,
        })}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="booking-note">
          {strings.note} <span className={styles.optional}>{strings.optional}</span>
        </label>
        <textarea
          id="booking-note"
          className={`${styles.input} ${styles.textarea}`}
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
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
      <p className={styles.errorLine} aria-live="polite">
        {line}
      </p>
      <button type="submit" className={styles.commit} disabled={isBusy}>
        {isBusy ? strings.booking : strings.confirm}
      </button>
    </form>
  );
}
