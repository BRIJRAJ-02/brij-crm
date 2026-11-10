import {
  checkAnswers,
  formStrings,
  HONEYPOT_IGNORE_ATTRIBUTES,
  HONEYPOT_INPUT_NAME,
  visibleQuestions,
  type PublicQuestion,
} from '@crm/contracts/forms';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { countriesIn } from '../../lib/countries.ts';
import { Field } from '../../molecules/Field/Field.tsx';
import { answerOf, focusQuestion, Question } from '../../public-form/Question.tsx';
import { prefillAnswer } from '../../public-form/use-hosted-form.ts';
import { InviteRows } from '../InviteRows/InviteRows.tsx';
import type { InviteRow } from '../InviteRows/invite-rows.ts';
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

/**
 * What a guest has typed so far, kept by the page while the step is away (a one page's Back, a time taken meanwhile)
 * and handed back as `draft`, so nothing typed is lost.
 */
export interface BookingDetailsDraft {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly note: string;
  /** The page's own questions' answers, by key, as their controls hold them. */
  readonly answers: Readonly<Record<string, unknown>>;
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

/**
 * The words a page may put in place of the built in ones: a table reservation (spec 0066 B7) confirms with
 * "Reserve", not "Confirm booking". Anything left out keeps the built in copy.
 */
export interface BookingDetailsLabels {
  /** The step's heading ("Your details"). */
  readonly heading?: string;
  /** The send button ("Confirm booking"). */
  readonly confirm?: string;
  /** The send button while it sends ("Booking"). */
  readonly confirming?: string;
  /** The send button once it went through ("Booked"). */
  readonly done?: string;
  /** The note's label ("Anything the host should know?"). */
  readonly note?: string;
  /** The note's placeholder: a reservation's "Dietary, high chair, accessibility…". */
  readonly notePlaceholder?: string;
  /** The name's label ("Your name"); a reservation's "Full name". */
  readonly name?: string;
  /** The phone's label ("Number to call"); a reservation's "Phone". */
  readonly phone?: string;
}

/** Props for BookingDetails. */
export interface BookingDetailsProps {
  /** The host confirms each booking first (spec 0062, AC-6203): the button says Send request, then Requested. */
  readonly isRequest?: boolean;
  /** The page's own words for the heading, the send button and the note (see BookingDetailsLabels). */
  readonly labels?: BookingDetailsLabels;
  /**
   * The page's own controls, drawn after the note and before the questions: a table reservation's occasion as
   * ChoiceChips, held and sent by the page. The form neither reads nor checks them.
   */
  readonly extra?: ReactNode;
  /** Asks for a number to call: a phone page. */
  readonly needsPhone?: boolean;
  /** Filled in from the visitor's sign in or a form hand off. */
  readonly prefill?: { readonly name?: string; readonly email?: string };
  /**
   * The most guests a booking takes. `0` leaves the invites out altogether: a table reservation (spec 0066 B7)
   * counts its party instead and invites nobody.
   */
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
  /**
   * Back to the times. Left out on a page that keeps the times and the details on one page (a table reservation,
   * after checklabs' one page booking form): the send button stands alone, the width of the form.
   */
  readonly onBack?: () => void;
  /**
   * What the page still needs before anything is checked (a one page form's time not picked yet): words for the line
   * above the button, the page moving focus itself; undefined lets the form check and send.
   */
  readonly blocked?: () => string | undefined;
  readonly onSubmit: (values: BookingDetailsValues) => Promise<BookingDetailsOutcome>;
  /**
   * A guest page's fields (a table reservation, after checklabs): `lg` draws every field at Field's 42px guest size.
   * Left out, the booking page's own 30px fields.
   */
  readonly fieldSize?: 'md' | 'lg';
  /** Asks for the phone straight after the name, before the email (checklabs' reservation order). */
  readonly isPhoneFirst?: boolean;
  /** One quiet line under the heading: a reservation's "We'll send your confirmation here. Free to cancel…". */
  readonly intro?: string;
  /**
   * One quiet line under the send button, centred ("Free cancellation · No prepayment required"); the send button then
   * takes the row beside Back.
   */
  readonly confirmNote?: string;
  /**
   * What the guest typed when the step was last open (see `onDraft`): every field starts there, with no "Booking as"
   * line, since the guest typed it themselves. Wins over `prefill`.
   */
  readonly draft?: BookingDetailsDraft;
  /** Each change to what is typed, so the page can keep it while the step is away and hand it back as `draft`. */
  readonly onDraft?: (draft: BookingDetailsDraft) => void;
  /**
   * `paired` (a booking page, the owner's v5 mock, 9 November 2026): Name and Email side by side at the public
   * pages' taller field, then the number to call, the page's own questions, the guests and the note. Left out
   * (`stacked`), one column in the order a table reservation asks.
   */
  readonly arrangement?: 'stacked' | 'paired';
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
  isRequest = false,
  labels,
  extra,
  needsPhone = false,
  prefill,
  maxGuests = 10,
  questions = NO_QUESTIONS,
  prefillAnswers,
  countryGuess,
  onBack,
  blocked,
  onSubmit,
  fieldSize = 'md',
  isPhoneFirst = false,
  intro,
  confirmNote,
  draft,
  onDraft,
  arrangement = 'stacked',
}: BookingDetailsProps) {
  const isPaired = arrangement === 'paired';
  // The guest size only when asked for, so the booking page's fields carry no size at all, as before; its buttons
  // are then a thumb's 44px, as the Book bar before them.
  const sized = fieldSize === 'lg' ? { size: 'guest' as const } : isPaired ? { size: 'lg' as const } : {};
  const actionSize = fieldSize === 'lg' ? 'touch' : 'lg';
  const [name, setName] = useState(draft?.name ?? prefill?.name ?? '');
  const [email, setEmail] = useState(draft?.email ?? prefill?.email ?? '');
  const [phone, setPhone] = useState(draft?.phone ?? '');
  // Guests are rows, one email each with its × (the owner, 9 November 2026: "more guests should be added, instead of
  // just one"), as New meeting and the guest's own page add them. Blank rows are never sent.
  const [guestRows, setGuestRows] = useState<readonly InviteRow[]>([]);
  const [guestNote, setGuestNote] = useState('');
  const [note, setNote] = useState(draft?.note ?? '');
  const [trap, setTrap] = useState('');
  const countryNames = useMemo(
    () => new Map(countriesIn('en').map((country) => [country.code, country.name] as const)),
    [],
  );
  // Each question's answer as its control holds it: a form's hand off fills in what it asked by the same key.
  const [held, setHeld] = useState<Readonly<Record<string, unknown>>>(
    () =>
      draft?.answers ??
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
  // The last long text box showing runs the form down to its buttons on a wide page: the note, unless a question follows.
  // Paired, the note is always last, so it is the one that fills.
  const fillingKey = isPaired ? undefined : showing.findLast((question) => question.answerType === 'long_text')?.key;
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
  // The fields a refused Confirm marked wrong: once one is right again it says so with a calm tick (stageshow's
  // form-error), so the visitor sees the fix land rather than only the red going away.
  const [wasWrong, setWasWrong] = useState<ReadonlySet<string>>(new Set());
  const fixed = (field: 'name' | 'email', isRight: boolean) =>
    wasWrong.has(field) && errors[field] === undefined && isRight
      ? {
          suffix: (
            <span className={styles.fixed}>
              <Icon name="check" size="sm" tone="success" />
            </span>
          ),
        }
      : {};
  const [isDone, setDone] = useState(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => globalThis.clearTimeout(doneTimer.current), []);
  const [bookingAs, setBookingAs] = useState(
    draft === undefined && prefill?.name !== undefined && prefill.name !== '' ? prefill.name : undefined,
  );
  // What is typed goes to the page as it changes (`onDraft`), read through a ref so a new callback each render never
  // sends it again by itself.
  const draftTo = useRef(onDraft);
  useEffect(() => {
    draftTo.current = onDraft;
  });
  useEffect(() => {
    draftTo.current?.({ name, email, phone, note, answers: held });
  }, [name, email, phone, note, held]);
  const form = useRef<HTMLFormElement>(null);
  const headingId = useId();
  const trapId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // The first empty field takes focus as the step arrives, so a visitor at a keyboard just types (the owner,
  // 2 November 2026); under a finger the heading takes it instead, so a phone keeps its keyboard down until a field is
  // tapped.
  // On a one page form (no Back) nothing arrives: the page keeps its own focus, at its top.
  const isStep = onBack !== undefined;
  useEffect(() => {
    if (!isStep) return;
    const first = globalThis.matchMedia('(pointer: fine)').matches
      ? [...(form.current?.querySelectorAll<HTMLInputElement>('input[name="name"], input[name="email"]') ?? [])].find(
          (input) => input.value === '',
        )
      : undefined;
    (first ?? heading.current)?.focus();
  }, [isStep]);
  const focusField = (field: string) =>
    globalThis.requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus());

  // The rows as they would go: each filled row trimmed, in order, a repeat of an earlier one left out.
  const filledRows = (() => {
    const seen = new Set<string>();
    return guestRows.flatMap((row, index) => {
      const email = row.email.trim();
      if (email === '' || seen.has(email.toLowerCase())) return [];
      seen.add(email.toLowerCase());
      return [{ row, index, email }];
    });
  })();
  const changeGuests = (next: readonly InviteRow[]) => {
    if (next.length !== guestRows.length) {
      const gone = guestRows.find((row) => !next.some((each) => each.id === row.id));
      setGuestNote(gone === undefined || gone.email.trim() === '' ? '' : strings.guestRemoved(gone.email.trim()));
      // A server's word on a guest no longer applies once the list changes.
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([field]) => !field.startsWith('guest-'))),
      );
    }
    setGuestRows(next);
  };

  const check = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (name.trim() === '') found.name = strings.nameRequired;
    if (!EMAIL.test(email.trim())) found.email = strings.emailRequired;
    if (needsPhone && phone.trim() === '') found.phone = strings.phoneRequired;
    // Each filled guest row must be an address; an empty one is simply left out.
    for (const { index, email: guest } of filledRows) {
      if (!EMAIL.test(guest)) found[`guest-${String(index)}`] = strings.guestNotEmail(guest);
    }
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
  // A booking the server turned down with no field to blame: Confirm shakes its head once, beside the line saying why,
  // the same no as a field's (transitions.dev's error shake).
  const refused = () => setShake((current) => ({ round: current.round + 1, fields: new Set(['actions']) }));
  const showErrors = (found: Readonly<Record<string, string>>) => {
    setErrors(found);
    setWasWrong((current) => new Set([...current, ...Object.keys(found)]));
    setShake((current) => ({
      round: current.round + 1,
      fields: new Set(Object.keys(found).map((field) => (field.startsWith('guest-') ? 'guests' : field))),
    }));
    const first = [
      'name',
      ...(isPhoneFirst ? ['phone'] : []),
      'email',
      ...guestRows.map((_, index) => `guest-${String(index)}`),
      ...(isPhoneFirst ? [] : ['phone']),
      ...showing.map((question) => `${ANSWER_FIELD}${question.key}`),
    ].find((field) => found[field] !== undefined);
    if (first?.startsWith(ANSWER_FIELD) === true) {
      const key = first.slice(ANSWER_FIELD.length);
      globalThis.requestAnimationFrame(() => focusQuestion(form.current, key));
    } else if (first?.startsWith('guest-') === true) {
      const row = guestRows[Number(first.slice('guest-'.length))];
      if (row !== undefined) focusField(`invite-${row.id}`);
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
    const missing = blocked?.();
    if (missing !== undefined) {
      setLine(missing);
      return;
    }
    const found = check();
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setErrors({});
    setBusy(true);
    const typed = filledRows.slice(0, maxGuests).map((each) => each.email);
    // The filled rows go, in order: the server's guest-n is the row the n-th address came from.
    const sentRows = filledRows.map((each) => each.index);
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
          refused();
          return;
        }
        const drawn = drawnErrors(outcome.fields, needsPhone, sentRows, shown);
        // A refusal on nothing the form draws still says why, in the line, so the visitor isn't left guessing.
        if (Object.keys(drawn).length > 0) showErrors(drawn);
        else {
          setLine(outcome.message === undefined || outcome.message === '' ? strings.failed : outcome.message);
          refused();
        }
      },
      () => {
        setBusy(false);
        setLine(strings.failed);
        refused();
      },
    );
  };

  // A number to call, on a page that phones the visitor: after the guests, or straight after the name when asked.
  const phoneField = needsPhone ? (
    <div className={styles.shaker} data-shake={shakeOf('phone')}>
      <Field
        label={labels?.phone ?? strings.phone}
        {...sized}
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
  ) : null;

  // Guests, one email a row (InviteRows' guest rows): Add guests, then Add another guest, up to the most a booking takes.
  const guestsField =
    maxGuests === 0 ? null : (
      <div className={styles.guests} data-shake={shakeOf('guests')}>
        <InviteRows
          rows={guestRows}
          onChange={changeGuests}
          max={maxGuests}
          fieldSize={isPaired || fieldSize === 'lg' ? 'lg' : 'md'}
          guests={{
            label: strings.guests,
            aside: strings.upTo(maxGuests),
            first: strings.addGuests,
            another: strings.addAnotherGuest,
            rowLabel: strings.guestRow,
            full: strings.guestsMax(maxGuests),
          }}
          errors={Object.fromEntries(
            guestRows.flatMap((row, index) => {
              const error = errors[`guest-${String(index)}`];
              return error === undefined ? [] : [[row.id, error]];
            }),
          )}
          onSubmit={submit}
        />
        <VisuallyHidden>
          <span role="status">{guestNote}</span>
        </VisuallyHidden>
      </div>
    );

  const noteField = (
    <div className={fillingKey === undefined ? styles.filling : styles.shaker}>
      <Field
        // Optional in its own words, in the label where it is read first (critics C14, A11).
        label={labels?.note ?? strings.note}
        {...(fieldSize === 'lg' ? sized : {})}
        {...(labels?.notePlaceholder === undefined ? {} : { placeholder: labels.notePlaceholder })}
        name="note"
        isMultiline
        isFilling={fillingKey === undefined}
        maxLength={2000}
        value={note}
        onChange={setNote}
      />
    </div>
  );
  const questionFields = showing.map((question) => {
    const field = `${ANSWER_FIELD}${question.key}`;
    return (
      <div
        key={question.key}
        className={question.key === fillingKey ? styles.filling : styles.question}
        data-question={question.key}
      >
        <Question
          question={question}
          isFilling={question.key === fillingKey}
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
  });

  return (
    <form
      ref={form}
      className={styles.root}
      data-arrangement={arrangement}
      noValidate
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 ref={heading} id={headingId} className={styles.heading} tabIndex={-1}>
        {labels?.heading ?? strings.heading}
      </h2>
      {intro !== undefined && <p className={styles.intro}>{intro}</p>}
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
      {/* Paired, Name and Email share a row (they stack again where the card is narrow). */}
      <div className={isPaired ? styles.pair : styles.question}>
        <div className={styles.shaker} data-shake={shakeOf('name')}>
          <Field
            label={labels?.name ?? strings.name}
            {...sized}
            name="name"
            autoComplete="name"
            maxLength={200}
            isRequired
            value={name}
            onChange={(next) => {
              setName(next);
              clear('name');
            }}
            {...fixed('name', name.trim() !== '')}
            {...(errors.name === undefined ? {} : { error: errors.name })}
          />
        </div>
        {isPhoneFirst && phoneField}
        <div className={styles.shaker} data-shake={shakeOf('email')}>
          <Field
            label={strings.email}
            {...sized}
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
            {...fixed('email', EMAIL.test(email.trim()))}
            {...(errors.email === undefined ? {} : { error: errors.email })}
          />
        </div>
      </div>
      {isPaired ? (
        <>
          {!isPhoneFirst && phoneField}
          {questionFields}
          {guestsField}
          {noteField}
          {extra}
        </>
      ) : (
        <>
          {guestsField}
          {!isPhoneFirst && phoneField}
          {noteField}
          {extra}
          {questionFields}
        </>
      )}
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
      <div className={styles.actions} data-shake={shakeOf('actions')}>
        {/* One foot band on both steps (critic C6): Back a secondary of Confirm's size, Confirm Book's own bar; a one
            page form (a reservation's) has no Back. */}
        {onBack !== undefined && (
          <Button size={actionSize} isDisabled={isBusy} onPress={onBack}>
            {strings.back}
          </Button>
        )}
        <Button
          variant="primary"
          size={actionSize}
          isFullWidth="center"
          type="submit"
          isPending={isBusy && !isDone}
          {...(isDone ? { icon: 'check' as const } : {})}
        >
          {isRequest
            ? isDone
              ? strings.requested
              : isBusy
                ? strings.requesting
                : strings.request
            : isDone
              ? (labels?.done ?? strings.booked)
              : isBusy
                ? (labels?.confirming ?? strings.confirming)
                : (labels?.confirm ?? strings.confirm)}
        </Button>
      </div>
      {confirmNote !== undefined && <p className={styles.confirmNote}>{confirmNote}</p>}
    </form>
  );
}
