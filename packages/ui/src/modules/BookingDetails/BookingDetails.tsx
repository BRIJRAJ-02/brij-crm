import {
  checkAnswers,
  formStrings,
  HONEYPOT_IGNORE_ATTRIBUTES,
  HONEYPOT_INPUT_NAME,
  visibleQuestions,
  type PublicQuestion,
} from '@crm/contracts/forms';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { countriesIn } from '../../lib/countries.ts';
import { Field } from '../../molecules/Field/Field.tsx';
import { answerOf, focusQuestion, Question } from '../../public-form/Question.tsx';
import { prefillAnswer } from '../../public-form/use-hosted-form.ts';
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
  /**
   * The answers to the page's own questions (spec 0057), by question key, as forms send them: only the questions
   * showing, each in the shape `checkAnswers` takes. Empty on a page that asks none.
   */
  readonly answers: Readonly<Record<string, unknown>>;
  /** The honeypot: a person never fills it. */
  readonly trap: string;
}

/** What sending the details answered, as the page's client words it. */
export type BookingDetailsOutcome =
  | { readonly kind: 'done' }
  /**
   * Errors by field: `name`, `email`, `phone`, `guest-<n>` (the n-th guest
   * sent, blanks left out), `answers.<key>` (a question's). `message` is the answer's own sentence, said in
   * the line above the buttons when none of `fields` is one the form draws.
   */
  | { readonly kind: 'invalid'; readonly fields: Readonly<Record<string, string>>; readonly message?: string }
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
  /**
   * The page's own questions (spec 0057, AC-5709), drawn after the note with the hosted form's controls and checked
   * with its `checkAnswers`; Show when decides which show. None draws nothing more (AC-5704).
   */
  readonly questions?: readonly PublicQuestion[];
  /** Answers handed over by a form (AC-5713), by question key: each starts its question filled in. */
  readonly prefillAnswers?: Readonly<Record<string, string>>;
  /** The visitor's country, guessed: a phone question's code and a country question's start. */
  readonly countryGuess?: string;
  readonly onBack: () => void;
  readonly onSubmit: (values: BookingDetailsValues) => Promise<BookingDetailsOutcome>;
}

/** The field a question's error is on, before its key: the server names it the same way. */
const ANSWER_FIELD = 'answers.';

/** No questions, held once so a page that asks none draws and checks nothing more. */
const NO_QUESTIONS: readonly PublicQuestion[] = [];

/** The language a booking page speaks: its own words are English, and its questions' checks speak the same. */
const WORDS = formStrings('en');

/** A rough email shape; the server checks it properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The answer's errors the form can show under a field. A guest's `guest-<n>`
 * counts only the filled rows that went, so it moves to its row in the form.
 * Anything the form doesn't draw an error on (a time zone, a phone the page
 * never asked for, the note, the guest list as a whole) is left out.
 */
function drawnErrors(
  fields: Readonly<Record<string, string>>,
  needsPhone: boolean,
  sentRows: readonly number[],
  shownKeys: ReadonlySet<string>,
): Record<string, string> {
  const drawn: Record<string, string> = {};
  for (const [field, message] of Object.entries(fields)) {
    const guest = /^guest-(\d+)$/.exec(field);
    const row = guest === null ? undefined : sentRows[Number(guest[1])];
    if (row !== undefined) drawn[`guest-${String(row)}`] ??= message;
    else if (
      field === 'name' ||
      field === 'email' ||
      (field === 'phone' && needsPhone) ||
      (field.startsWith(ANSWER_FIELD) && shownKeys.has(field.slice(ANSWER_FIELD.length)))
    )
      drawn[field] = message;
  }
  return drawn;
}

/**
 * A booking page's second step (spec 0025, AC-670 to AC-672): your name and
 * email, guests to invite, a number to call on a phone page, and a note for
 * the host; then Back and Confirm. Labels sit above, errors under their
 * field with the first one focused, and anything else in one line above the
 * buttons. A prefilled visitor sees "Booking as Ada. Not you?".
 */
export function BookingDetails({
  needsPhone = false,
  prefill,
  maxGuests = 10,
  questions = NO_QUESTIONS,
  prefillAnswers,
  countryGuess,
  onBack,
  onSubmit,
}: BookingDetailsProps) {
  const [name, setName] = useState(prefill?.name ?? '');
  const [email, setEmail] = useState(prefill?.email ?? '');
  const [phone, setPhone] = useState('');
  const [guests, setGuests] = useState<readonly string[]>([]);
  const [note, setNote] = useState('');
  const [trap, setTrap] = useState('');
  const countryNames = useMemo(
    () => new Map(countriesIn('en').map((country) => [country.code, country.name] as const)),
    [],
  );
  // Each question's answer as its control holds it: a form's hand off fills in what it asked by the same key.
  const [held, setHeld] = useState<Readonly<Record<string, unknown>>>(() =>
    Object.fromEntries(
      questions.flatMap((question) => {
        // As a hosted form takes a prefill: words for a text question, a choice by its words or key, nothing else.
        const given = prefillAnswer(question, prefillAnswers?.[question.key]);
        return given === undefined ? [] : [[question.key, given]];
      }),
    ),
  );
  // What each question sends, and which show now (Show when reads only earlier questions, as on a form).
  const given = Object.fromEntries(questions.map((question) => [question.key, answerOf(question, held[question.key])]));
  const shown = questions.length === 0 ? new Set<string>() : visibleQuestions(questions, given);
  const showing = questions.filter((question) => shown.has(question.key));
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
    // The questions showing, checked as the server will (its Show when already decided here).
    if (showing.length > 0) {
      const visible = showing.map(({ showWhen: _decided, ...question }) => question);
      const checked = checkAnswers({ language: 'en', questions: visible }, given);
      if (!checked.ok) {
        for (const [key, message] of Object.entries(checked.fields)) found[`${ANSWER_FIELD}${key}`] = message;
      }
    }
    return found;
  };
  const showErrors = (found: Readonly<Record<string, string>>) => {
    setErrors(found);
    const first = [
      'name',
      'email',
      ...guests.map((_, index) => `guest-${String(index)}`),
      'phone',
      ...showing.map((question) => `${ANSWER_FIELD}${question.key}`),
    ].find((field) => found[field] !== undefined);
    if (first?.startsWith(ANSWER_FIELD) === true) {
      const key = first.slice(ANSWER_FIELD.length);
      globalThis.requestAnimationFrame(() => focusQuestion(form.current, key));
    } else if (first !== undefined) focusField(first);
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
    const typed = guests.map((guest) => guest.trim());
    // The row each guest that goes sits on: blank rows stay behind.
    const sentRows = typed.flatMap((guest, row) => (guest === '' ? [] : [row]));
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      guests: typed.filter((guest) => guest !== ''),
      note: note.trim(),
      answers: Object.fromEntries(showing.map((question) => [question.key, given[question.key]])),
      trap,
    }).then(
      (outcome) => {
        if (outcome.kind === 'done') return;
        setBusy(false);
        if (outcome.kind === 'failed') {
          setLine(outcome.message);
          return;
        }
        const drawn = drawnErrors(outcome.fields, needsPhone, sentRows, shown);
        // A refusal on nothing the form draws still says why, in the line, so the visitor isn't left guessing.
        if (Object.keys(drawn).length > 0) showErrors(drawn);
        else setLine(outcome.message === undefined || outcome.message === '' ? strings.failed : outcome.message);
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
        // Beside the page's own questions, the note says it is optional as they do; alone, it keeps its hint.
        {...(questions.length === 0 ? { hint: strings.optional } : { labelAside: WORDS.optional })}
        name="note"
        isMultiline
        maxLength={2000}
        value={note}
        onChange={setNote}
      />
      {showing.map((question) => {
        const field = `${ANSWER_FIELD}${question.key}`;
        return (
          <div key={question.key} className={styles.question} data-question={question.key}>
            <Question
              question={question}
              words={WORDS}
              value={held[question.key]}
              error={errors[field]}
              countryGuess={countryGuess}
              countryNames={countryNames}
              onChange={(value) => {
                setHeld((current) => ({ ...current, [question.key]: value }));
                clear(field);
              }}
            />
          </div>
        );
      })}
      <div className={styles.trap} aria-hidden="true">
        <label htmlFor={trapId}>{strings.trap}</label>
        <input
          id={trapId}
          name={HONEYPOT_INPUT_NAME}
          tabIndex={-1}
          autoComplete="off"
          {...HONEYPOT_IGNORE_ATTRIBUTES}
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
