import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import styles from './BookingDetails.module.css';
import { strings } from './strings.ts';

/** What a visitor gives for their booking. */
export interface BookingDetailsValues {
  readonly name: string;
  readonly email: string;
  /** Only on a page that phones the visitor. */
  readonly phone: string;
  /** More people to invite, by email, blanks left out. */
  readonly guests: readonly string[];
  readonly note: string;
  /** The honeypot: a person never fills it. */
  readonly trap: string;
}

/** What sending the details answered, as the page's client words it. */
export type BookingDetailsOutcome =
  | { readonly kind: 'done' }
  /** Errors by field: `name`, `email`, `phone`, `guest-<n>`. */
  | { readonly kind: 'invalid'; readonly fields: Readonly<Record<string, string>> }
  /** One line above the buttons ("Too many attempts just now."). */
  | { readonly kind: 'failed'; readonly message: string };

/** Props for BookingDetails. */
export interface BookingDetailsProps {
  /** Asks for a number to call: a phone page. */
  readonly needsPhone?: boolean;
  /** Filled in from the visitor's sign in or a form hand off. */
  readonly prefill?: { readonly name?: string; readonly email?: string };
  /** The most guests a booking takes. */
  readonly maxGuests?: number;
  readonly onBack: () => void;
  readonly onSubmit: (values: BookingDetailsValues) => Promise<BookingDetailsOutcome>;
}

/** A rough email shape; the server checks it properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A booking page's second step (spec 0025, AC-670 to AC-672): your name and
 * email, guests to invite, a number to call on a phone page, and a note for
 * the host; then Back and Confirm. Labels sit above, errors under their
 * field with the first one focused, and anything else in one line above the
 * buttons. A prefilled visitor sees "Booking as Ada. Not you?".
 */
export function BookingDetails({ needsPhone = false, prefill, maxGuests = 10, onBack, onSubmit }: BookingDetailsProps) {
  const [name, setName] = useState(prefill?.name ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [phone, setPhone] = useState('');
  const [guests, setGuests] = useState<readonly string[]>([]);
  const [note, setNote] = useState('');
  const [trap, setTrap] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [line, setLine] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [bookingAs, setBookingAs] = useState(
    prefill?.name !== undefined && prefill.name !== '' ? prefill.name : undefined,
  );
  const form = useRef<HTMLFormElement>(null);
  const headingId = useId();
  const trapId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // The step's heading takes focus as it arrives: no field grabs it, so a phone keeps its keyboard down.
  useEffect(() => heading.current?.focus(), []);
  const focusField = (field: string) =>
    globalThis.requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus());

  const check = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = strings.nameRequired;
    if (!EMAIL.test(email.trim())) found.email = strings.emailRequired;
    if (needsPhone && phone.trim() === '') found.phone = strings.phoneRequired;
    guests.forEach((guest, index) => {
      if (guest.trim() !== '' && !EMAIL.test(guest.trim())) found[`guest-${String(index)}`] = strings.guestInvalid;
    });
    return found;
  };
  const showErrors = (found: Readonly<Record<string, string>>) => {
    setErrors(found);
    const first = ['name', 'email', ...guests.map((_, index) => `guest-${String(index)}`), 'phone'].find(
      (field) => found[field] !== undefined,
    );
    if (first !== undefined) focusField(first);
  };
  const clear = (field: string) => {
    if (errors[field] === undefined) return;
    const { [field]: _, ...rest } = errors;
    setErrors(rest);
  };

  const submit = () => {
    if (isBusy) return;
    setLine('');
    const found = check();
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setErrors({});
    setBusy(true);
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      guests: guests.map((guest) => guest.trim()).filter((guest) => guest !== ''),
      note: note.trim(),
      trap,
    }).then(
      (outcome) => {
        if (outcome.kind === 'done') return;
        setBusy(false);
        if (outcome.kind === 'invalid') showErrors(outcome.fields);
        else setLine(outcome.message);
      },
      () => {
        setBusy(false);
        setLine(strings.failed);
      },
    );
  };

  return (
    <form
      ref={form}
      className={styles.root}
      noValidate
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 ref={heading} id={headingId} className={styles.heading} tabIndex={-1}>
        {strings.heading}
      </h2>
      {bookingAs !== undefined && (
        <p className={styles.as}>
          {strings.bookingAs(bookingAs)}
          <button
            type="button"
            className={styles.inline}
            onClick={() => {
              setName('');
              setEmail('');
              setBookingAs(undefined);
              focusField('name');
            }}
          >
            {strings.notYou}
          </button>
        </p>
      )}
      <Field
        label={strings.name}
        name="name"
        autoComplete="name"
        maxLength={200}
        isRequired
        value={name}
        onChange={(next) => {
          setName(next);
          clear('name');
        }}
        {...(errors.name === undefined ? {} : { error: errors.name })}
      />
      <Field
        label={strings.email}
        name="email"
        type="email"
        autoComplete="email"
        placeholder={strings.emailPlaceholder}
        maxLength={254}
        isRequired
        value={email}
        onChange={(next) => {
          setEmail(next);
          clear('email');
        }}
        {...(errors.email === undefined ? {} : { error: errors.email })}
      />
      {guests.length > 0 && (
        <div className={styles.guests}>
          {guests.map((guest, index) => {
            const field = `guest-${String(index)}`;
            return (
              <Field
                key={field}
                label={strings.guest(index + 1)}
                name={field}
                type="email"
                placeholder={strings.guestPlaceholder}
                maxLength={254}
                value={guest}
                onChange={(next) => {
                  setGuests((current) => current.map((each, at) => (at === index ? next : each)));
                  clear(field);
                }}
                suffix={
                  <Button
                    variant="ghost"
                    icon="x"
                    label={strings.removeGuest(index + 1)}
                    onPress={() => {
                      setGuests((current) => current.filter((_, at) => at !== index));
                      setErrors({});
                      // The row goes with its button: focus the row before it, or Add guests.
                      if (guests.length > 1) focusField(`guest-${String(Math.max(0, index - 1))}`);
                      else
                        globalThis.requestAnimationFrame(() =>
                          form.current?.querySelector<HTMLElement>('[data-add-guest] button')?.focus(),
                        );
                    }}
                  />
                }
                {...(errors[field] === undefined ? {} : { error: errors[field] })}
              />
            );
          })}
        </div>
      )}
      {guests.length < maxGuests && (
        <div className={styles.add} data-add-guest="">
          <Button
            variant="ghost"
            icon="user-plus"
            onPress={() => {
              setGuests((current) => [...current, '']);
              focusField(`guest-${String(guests.length)}`);
            }}
          >
            {guests.length === 0 ? strings.addGuests : strings.addAnotherGuest}
          </Button>
        </div>
      )}
      {needsPhone && (
        <Field
          label={strings.phone}
          name="phone"
          type="tel"
          autoComplete="tel"
          maxLength={40}
          isRequired
          value={phone}
          onChange={(next) => {
            setPhone(next);
            clear('phone');
          }}
          {...(errors.phone === undefined ? {} : { error: errors.phone })}
        />
      )}
      <Field
        label={strings.note}
        hint={strings.optional}
        name="note"
        isMultiline
        maxLength={2000}
        value={note}
        onChange={setNote}
      />
      <div className={styles.trap} aria-hidden="true">
        <label htmlFor={trapId}>{strings.trap}</label>
        <input
          id={trapId}
          name="company_url"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={(event) => setTrap(event.target.value)}
        />
      </div>
      <p className={styles.line} role="alert">
        {line}
      </p>
      <div className={styles.actions}>
        <Button variant="ghost" isDisabled={isBusy} onPress={onBack}>
          {strings.back}
        </Button>
        <Button variant="primary" size="lg" type="submit" isPending={isBusy}>
          {isBusy ? strings.confirming : strings.confirm}
        </Button>
      </div>
    </form>
  );
}
