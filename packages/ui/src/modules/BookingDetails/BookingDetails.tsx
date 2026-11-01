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
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
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
  /**
   * Booked. `next` runs a beat later (one `--duration-move`, while Confirm shows Booked with a tick): where the page
   * moves on to the receipt (the owner, 1 November 2026). Without it, the page has already moved on.
   */
  | { readonly kind: 'done'; readonly next?: () => void }
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

/** One `--duration-move`, read from the page so it follows the token, in milliseconds. */
const beatOf = (element: Element | null): number => {
  const value = element === null ? '' : getComputedStyle(element).getPropertyValue('--duration-move').trim();
  const amount = Number.parseFloat(value);
  if (Number.isNaN(amount)) return 0;
  return value.endsWith('ms') ? amount : amount * 1000;
};

/** The field a question's error is on, before its key: the server names it the same way. */
const ANSWER_FIELD = 'answers.';

/** No questions, held once so a page that asks none draws and checks nothing more. */
const NO_QUESTIONS: readonly PublicQuestion[] = [];

/** The language a booking page speaks: its own words are English, and its questions' checks speak the same. */
const WORDS = formStrings('en');

/** A rough email shape; the server checks it properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** What ends one guest's address: a comma, a semicolon, a space or a new line (a pasted list). */
const GUEST_SEPARATORS = /[\s,;]+/;

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
  // Guests are chips (the owner, 1 November 2026): an address becomes one when Enter, a comma, a space or leaving the
  // field ends it, and whatever is still typed is taken on Confirm, so a guest is never dropped.
  const [guests, setGuestsState] = useState<readonly string[]>([]);
  // The latest guests, for a chip made after a render (the blur's timer).
  const latestGuests = useRef<readonly string[]>([]);
  const setGuests = (next: readonly string[] | ((current: readonly string[]) => readonly string[])) => {
    const value = typeof next === 'function' ? next(latestGuests.current) : next;
    latestGuests.current = value;
    setGuestsState(value);
  };
  const [guestDraft, setGuestDraft] = useState('');
  const [isAddingGuests, setAddingGuests] = useState(false);
  const [guestNote, setGuestNote] = useState('');
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
  // Each refused Confirm shakes the fields it found wrong once (transitions.dev's error state shake). The round flips
  // between two names so the same field shakes again on the next refusal.
  const [shake, setShake] = useState<{ readonly round: number; readonly fields: ReadonlySet<string> }>({
    round: 0,
    fields: new Set(),
  });
  const shakeOf = (field: string) => (shake.fields.has(field) ? (shake.round % 2 === 0 ? 'even' : 'odd') : undefined);
  const [line, setLine] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [isDone, setDone] = useState(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => globalThis.clearTimeout(doneTimer.current), []);
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

  /**
   * Takes typed text into chips: each well formed, new address joins the guests (up to the most a booking takes);
   * anything else stays in the field to fix, with what's wrong. Returns the guests and what is left.
   */
  const takeGuests = (
    text: string,
  ): { readonly taken: readonly string[]; readonly left: string; readonly problem?: string } => {
    const parts = text.split(GUEST_SEPARATORS).filter((part) => part !== '');
    const current = latestGuests.current;
    const known = new Set(current.map((guest) => guest.toLowerCase()));
    const added: string[] = [];
    const kept: string[] = [];
    let problem: string | undefined;
    for (const part of parts) {
      if (!EMAIL.test(part)) {
        kept.push(part);
        problem ??= strings.guestNotEmail(part);
      } else if (known.has(part.toLowerCase())) continue;
      else if (current.length + added.length >= maxGuests) {
        kept.push(part);
        problem ??= strings.guestsMax(maxGuests);
      } else {
        known.add(part.toLowerCase());
        added.push(part);
      }
    }
    const taken = [...current, ...added];
    if (added.length > 0) {
      setGuests(taken);
      setGuestNote(strings.guestAdded(added));
    }
    const left = kept.join(' ');
    setGuestDraft(left);
    setErrors((current) => {
      const { guests: _, ...rest } = current;
      return problem === undefined ? rest : { ...rest, guests: problem };
    });
    return problem === undefined ? { taken, left } : { taken, left, problem };
  };
  const removeGuest = (index: number) => {
    const gone = guests[index];
    if (gone === undefined) return;
    setGuests((current) => current.filter((_, at) => at !== index));
    setGuestNote(strings.guestRemoved(gone));
    // A server's word on a guest no longer applies once the list changes.
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([field]) => !field.startsWith('guest-'))),
    );
    focusField('guests');
  };

  const check = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = strings.nameRequired;
    if (!EMAIL.test(email.trim())) found.email = strings.emailRequired;
    if (needsPhone && phone.trim() === '') found.phone = strings.phoneRequired;
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
    setShake((current) => ({
      round: current.round + 1,
      fields: new Set(Object.keys(found).map((field) => (field.startsWith('guest-') ? 'guests' : field))),
    }));
    const first = [
      'name',
      'email',
      'guests',
      ...guests.map((_, index) => `guest-${String(index)}`),
      'phone',
      ...showing.map((question) => `${ANSWER_FIELD}${question.key}`),
    ].find((field) => found[field] !== undefined);
    if (first?.startsWith(ANSWER_FIELD) === true) {
      const key = first.slice(ANSWER_FIELD.length);
      globalThis.requestAnimationFrame(() => focusQuestion(form.current, key));
    } else if (first !== undefined) focusField(first.startsWith('guest-') ? 'guests' : first);
  };
  const clear = (field: string) => {
    if (errors[field] === undefined) return;
    const { [field]: _, ...rest } = errors;
    setErrors(rest);
  };

  const submit = () => {
    if (isBusy) return;
    setLine('');
    // An address still in the guests field goes with the booking: taken now, never dropped.
    const pending = guestDraft.trim() === '' ? { taken: guests, left: '' } : takeGuests(guestDraft);
    const found = {
      ...check(),
      ...('problem' in pending && pending.problem !== undefined ? { guests: pending.problem } : {}),
    };
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setErrors({});
    setBusy(true);
    const typed = pending.taken;
    // Every chip goes, in order: the server's guest-n is the n-th chip.
    const sentRows = typed.map((_, row) => row);
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      guests: typed,
      note: note.trim(),
      answers: Object.fromEntries(showing.map((question) => [question.key, given[question.key]])),
      trap,
    }).then(
      (outcome) => {
        if (outcome.kind === 'done') {
          // Confirm says Booked for one move's length, so the visitor sees it land before the receipt takes over.
          setDone(true);
          if (outcome.next !== undefined) doneTimer.current = globalThis.setTimeout(outcome.next, beatOf(form.current));
          return;
        }
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
      <div className={styles.shaker} data-shake={shakeOf('name')}>
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
      </div>
      <div className={styles.shaker} data-shake={shakeOf('email')}>
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
      </div>
      {isAddingGuests || guests.length > 0 ? (
        <div
          className={styles.guests}
          data-shake={shakeOf('guests')}
          // Opened by Add guests, it grows into place; guests a visitor came back with are simply there.
          data-opening={isAddingGuests || undefined}
        >
          {guests.length > 0 && (
            <ul className={styles.chips} aria-label={strings.guestsList}>
              {guests.map((guest, index) => (
                <li
                  key={guest}
                  className={styles.chip}
                  data-invalid={errors[`guest-${String(index)}`] === undefined ? undefined : ''}
                >
                  <span className={styles.chipText}>{guest}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="x"
                    label={strings.removeGuest(guest)}
                    onPress={() => removeGuest(index)}
                  />
                </li>
              ))}
            </ul>
          )}
          <Field
            label={strings.guests}
            name="guests"
            type="text"
            inputMode="email"
            autoComplete="off"
            placeholder={strings.guestPlaceholder}
            hint={strings.guestsHint}
            maxLength={2000}
            value={guestDraft}
            onChange={(next) => {
              // A separator ends an address: what comes before the last one is taken, the rest is still being typed.
              const end = next.search(/[\s,;]+[^\s,;]*$/);
              if (end < 0) {
                setGuestDraft(next);
                clear('guests');
                return;
              }
              const tail = next.slice(end).replace(GUEST_SEPARATORS, '');
              const { left } = takeGuests(next.slice(0, end));
              setGuestDraft([left, tail].filter((part) => part !== '').join(' '));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && guestDraft.trim() !== '') {
                // Enter ends the address here; with nothing typed it books, as everywhere else in the form.
                event.preventDefault();
                takeGuests(guestDraft);
              } else if (event.key === 'Backspace' && guestDraft === '' && guests.length > 0) {
                event.preventDefault();
                removeGuest(guests.length - 1);
              }
            }}
            onBlur={() => {
              if (guestDraft.trim() === '') return;
              const draft = guestDraft;
              // Layout only, never correctness: submit takes the draft itself, and taking an address already a chip
              // does nothing, so whichever runs first the booking carries each guest once. Waiting a task just keeps
              // the chip from moving Confirm under the pointer mid click.
              globalThis.setTimeout(() => takeGuests(draft), 0);
            }}
            {...(errors.guests === undefined
              ? Object.keys(errors).some((field) => field.startsWith('guest-'))
                ? { error: strings.guestInvalid }
                : {}
              : { error: errors.guests })}
          />
          <VisuallyHidden>
            <span role="status">{guestNote}</span>
          </VisuallyHidden>
        </div>
      ) : (
        <div className={styles.add} data-add-guest="">
          <Button
            variant="ghost"
            icon="user-plus"
            onPress={() => {
              setAddingGuests(true);
              focusField('guests');
            }}
          >
            {strings.addGuests}
          </Button>
        </div>
      )}
      {needsPhone && (
        <div className={styles.shaker} data-shake={shakeOf('phone')}>
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
        </div>
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
        <Button
          variant="primary"
          size="lg"
          type="submit"
          isPending={isBusy && !isDone}
          {...(isDone ? { icon: 'check' as const } : {})}
        >
          {isDone ? strings.booked : isBusy ? strings.confirming : strings.confirm}
        </Button>
      </div>
    </form>
  );
}
