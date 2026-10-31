// The hosted form's state, shared by every layout (spec 0023,
// 0023-form-design.md, The field checker): the answers, the field checker
// (a question is checked when it loses focus with something in it, and every
// question on submit; a shown error clears the moment it is fixed, but a new
// one never appears while typing), the email typo hint, the send and what
// follows it. No markup: Classic and the step layouts draw from it.
import {
  checkAnswers,
  formStrings,
  isBlank,
  pathOf,
  SHORT_ANSWER_MAX,
  suggestEmail,
  type FormPath,
  type FormStrings,
  type PublicForm,
  type PublicQuestion,
  type SubmitNext,
} from '@crm/contracts/forms';
import { useEffect, useMemo, useRef, useState, type ComponentType, type FocusEvent, type RefObject } from 'react';
import type { FormBookingProps } from './FormBooking.tsx';
import { countriesIn } from '../lib/countries.ts';
import type { HostedFileHandlers, HostedRemoveUpload, HostedUpload } from './files.ts';
import { answerOf, focusQuestion } from './Question.tsx';

/** Where the form is drawn: alone on its page, inside a site's iframe, or as the builder's inert preview. */
export type HostedFormMode = 'page' | 'embed' | 'preview';

/** What a visitor sent: answers by question key, the trap field, and how long they took. */
export interface HostedSubmission {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly trap: string;
  readonly fillMs: number;
  /** Counts up with each "Send another": one idempotency key per round, so a retry sends the same one. */
  readonly round: number;
}

/** What sending answered, as the page's client words it. */
export type HostedSubmitOutcome =
  | { readonly kind: 'done'; readonly next: SubmitNext }
  | { readonly kind: 'invalid'; readonly fields: Readonly<Record<string, string>> }
  | { readonly kind: 'closed' }
  | { readonly kind: 'limited' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'offline' };

/** What the state needs from the page. */
export interface HostedFormSettings {
  readonly form: PublicForm;
  readonly mode: HostedFormMode;
  readonly countryGuess?: string | undefined;
  /** Answers to start with, by question key (HostedFormProps' `prefill`). */
  readonly prefill?: Readonly<Record<string, PrefillValue>> | undefined;
  readonly onSubmit?: ((submission: HostedSubmission) => Promise<HostedSubmitOutcome>) | undefined;
  readonly onRedirect?: ((url: string) => void) | undefined;
  /** Sends a file for a file question (#32); without it the file question is drawn and disabled. */
  readonly onUpload?: HostedUpload | undefined;
  readonly onRemoveUpload?: HostedRemoveUpload | undefined;
  readonly now: () => number;
  /**
   * Reads the form again and draws its new version in place, keeping the answers given by question key; answers
   * whether it could. Asked when a refusal names a question this page never drew (late trap #18).
   */
  readonly onStale?: (() => Promise<boolean>) | undefined;
  /** Told the keys a refusal named, before their errors show: a step layout goes to the first one's step. */
  readonly onRefused?: (keys: readonly string[]) => void;
}

type Answers = Readonly<Record<string, unknown>>;
type Messages = Readonly<Record<string, string>>;

/** Which view the form shows. */
export type HostedFormView =
  | { readonly kind: 'form' }
  | { readonly kind: 'thanks'; readonly text: string }
  | { readonly kind: 'closed' }
  /** Sent, and going on to a booking page after a countdown (AC-1059). */
  | { readonly kind: 'booking'; readonly url: string; readonly seconds: number; readonly text: string };

/** The state and the handlers every layout draws with. */
export interface HostedFormState {
  readonly words: FormStrings;
  readonly preview: boolean;
  readonly countryNames: ReadonlyMap<string, string>;
  readonly answers: Answers;
  readonly errors: Messages;
  /** The email typo hints shown, by key: the address the visitor probably meant. */
  readonly hints: Messages;
  /** The questions a submit found problems with, in order, while any remain: the error summary. */
  readonly summary: readonly PublicQuestion[];
  /** The questions that show for the answers so far (spec 0043, AC-1614): one whose Show when fails is hidden. */
  readonly shown: ReadonlySet<string>;
  /** The visitor's path (spec 0063, `pathOf`): the steps they see for the answers so far, each with its questions. */
  readonly path: FormPath;
  /** What a polite live line says after an answer shows or hides questions; empty otherwise. */
  readonly shownNote: string;
  readonly alert: string;
  readonly isSending: boolean;
  /** The page's file calls for a file question, where it has them (never in a preview). */
  readonly files: HostedFileHandlers | undefined;
  readonly isClosed: boolean;
  readonly view: HostedFormView;
  /**
   * The countdown on to book, once its own chunk has loaded (spec 0063, AC-6331): only a form that sends visitors on
   * to book draws it, so the hosted page's first load never carries it. The view turns to `booking` only after.
   */
  readonly bookingView: ComponentType<FormBookingProps> | undefined;
  readonly round: number;
  readonly trap: string;
  readonly setTrap: (value: string) => void;
  readonly change: (question: PublicQuestion, value: unknown) => void;
  /** The question's wrapper's blur: checks it once focus has left the whole question. */
  readonly blur: (question: PublicQuestion, event: FocusEvent<HTMLElement>) => void;
  /** Takes the suggested address and focuses the field again. */
  readonly takeHint: (question: PublicQuestion) => void;
  /** Checks `questions` (a step), shows their errors and focuses the first; true when they all pass. */
  readonly checkStep: (questions: readonly PublicQuestion[]) => boolean;
  /** Checks every question, then sends. */
  readonly submit: () => void;
  readonly sendAnother: () => void;
  /** Goes to an address the form sends visitors to (a redirect, a booking page); nothing in a preview. */
  readonly goTo: (url: string) => void;
  /** Moves focus to the first control of a question. */
  readonly focus: (key: string) => void;
}

/** Where focus goes: the form's frame (its questions) and the view's heading. Kept apart from the state, which renders. */
export interface HostedFormRefs {
  readonly container: RefObject<HTMLDivElement | null>;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}

/** The types a prefill's words fill as they are. */
const PREFILLED_AS_TEXT: ReadonlySet<string> = new Set([
  'short_text',
  'long_text',
  'email',
  'website',
  'number',
  'hidden',
]);

/** A prefill's value as the page reads it: a key's words, or several for a key the address repeats. */
export type PrefillValue = string | readonly string[];

/** A choice by its words or its key, as the question's own words; undefined when it names none. */
function choiceOf(question: PublicQuestion, given: string): string | undefined {
  const choices = question.choices ?? [];
  if (choices.includes(given)) return given;
  const at = (question.choiceKeys ?? []).indexOf(given);
  return at === -1 ? undefined : choices[at];
}

/**
 * A question's start from a prefill (spec 0023; spec 0063, AC-6309): the words for text and a hidden question, a
 * choice by its words or its key, a real day for a date, `HH:MM` for a time, a number in range for a rating or a
 * scale, and each of a repeated key's choices for a multi select. Anything that doesn't fit is ignored, never an
 * error: a link is untrusted, and the answer check runs on it again as on any answer.
 */
export function prefillAnswer(question: PublicQuestion, given: PrefillValue | undefined): unknown {
  if (given === undefined) return undefined;
  const all = (typeof given === 'string' ? [given] : given)
    .map((each) => each.trim().slice(0, 500))
    .filter((each) => each !== '');
  const [words] = all;
  if (words === undefined) return undefined;
  // A hidden value longer than its answer takes would be refused where nobody can fix it: its default stands instead.
  if (question.answerType === 'hidden') return words.length > SHORT_ANSWER_MAX ? undefined : words;
  if (PREFILLED_AS_TEXT.has(question.answerType)) return words;
  switch (question.answerType) {
    case 'dropdown':
    case 'choice':
      return choiceOf(question, words);
    case 'multi_select': {
      const picked = [...new Set(all.flatMap((each) => choiceOf(question, each) ?? []))];
      return picked.length === 0 ? undefined : { picked };
    }
    case 'date':
    case 'time':
    case 'rating':
    case 'scale': {
      // Checked alone, so its own Show when (which reads other questions) is no part of it.
      const { showWhen: _decided, ...alone } = question;
      const checked = checkAnswers({ language: 'en', questions: [alone] }, { [question.key]: words });
      return checked.ok ? checked.answers[question.key] : undefined;
    }
    default:
      return undefined;
  }
}

/** The answers a form starts with: the guessed country for a country question, and the prefill's answers. */
function firstAnswers(
  form: PublicForm,
  countryGuess: string | undefined,
  countryNames: ReadonlyMap<string, string>,
  prefill: Readonly<Record<string, PrefillValue>> | undefined,
): Answers {
  return Object.fromEntries(
    form.questions.flatMap((question): [string, unknown][] => {
      const given = prefillAnswer(question, prefill?.[question.key]);
      if (given !== undefined) return [[question.key, given]];
      // A hidden question the link leaves out takes its default (AC-6309).
      if (question.answerType === 'hidden' && question.options?.default !== undefined) {
        return [[question.key, question.options.default]];
      }
      return question.answerType === 'country' && countryGuess !== undefined && countryNames.has(countryGuess)
        ? [[question.key, countryNames.get(countryGuess)]]
        : [];
    }),
  );
}

/** One question's message for an answer, as the server would give it; undefined when it passes. */
function messageOf(form: PublicForm, question: PublicQuestion, value: unknown): string | undefined {
  const result = checkAnswers({ language: form.language, questions: [question] }, { [question.key]: value });
  return result.ok ? undefined : result.fields[question.key];
}

/** Without `key`. */
function without(messages: Messages, key: string): Messages {
  if (messages[key] === undefined) return messages;
  return Object.fromEntries(Object.entries(messages).filter(([each]) => each !== key));
}

/** True when focus moved into a list or dialog the question opened (a dropdown's options, the dial codes). */
function intoItsPopover(next: EventTarget | null): boolean {
  return next instanceof Element && next.closest('[role="listbox"], [role="dialog"]') !== null;
}

/**
 * The hosted form's state (spec 0023, 0023-form-design.md): one hook, so
 * every layout checks, hints, sends and thanks the same way, with every word
 * from `formStrings` and every check from `checkAnswers`.
 */
export function useHostedForm({
  form,
  mode,
  countryGuess,
  prefill,
  onSubmit,
  onRedirect,
  onUpload,
  onRemoveUpload,
  onStale,
  now,
  onRefused,
}: HostedFormSettings): {
  readonly state: HostedFormState;
  readonly refs: HostedFormRefs;
} {
  const words = formStrings(form.language);
  const preview = mode === 'preview';
  const countryNames = useMemo(
    () => new Map(countriesIn(form.language).map((country) => [country.code, country.name])),
    [form.language],
  );
  const [answers, setAnswers] = useState<Answers>(() => firstAnswers(form, countryGuess, countryNames, prefill));
  const [errors, setErrors] = useState<Messages>({});
  const [hints, setHints] = useState<Messages>({});
  // Questions that have held an answer: a required one emptied again says so when it loses focus.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [isSubmitted, setSubmitted] = useState(false);
  const [isSending, setSending] = useState(false);
  const [alert, setAlert] = useState('');
  // The file questions with a file still going: the form won't send until they are in.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [trap, setTrap] = useState('');
  const [view, setView] = useState<HostedFormView>({ kind: 'form' });
  const [bookingView, setBookingView] = useState<ComponentType<FormBookingProps> | undefined>(undefined);
  const [round, setRound] = useState(0);
  const [startedAt, setStartedAt] = useState(now);
  const [focusTarget, setFocusTarget] = useState<'heading' | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const isClosed = form.status === 'paused' || view.kind === 'closed';

  useEffect(() => {
    if (focusTarget !== undefined && !preview) heading.current?.focus();
  }, [focusTarget, view, preview]);

  const focus = (key: string) => {
    globalThis.requestAnimationFrame(() => focusQuestion(container.current, key));
  };
  const show = (fields: Messages, among: readonly PublicQuestion[]) => {
    setErrors((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([key]) => !among.some((each) => each.key === key))),
      ...fields,
    }));
    const first = among.find((question) => fields[question.key] !== undefined);
    if (first !== undefined) focus(first.key);
  };
  // What shows is decided over the whole form, so a step's question can read an answer from an earlier step.
  const given = Object.fromEntries(
    form.questions.map((question) => [question.key, answerOf(question, answers[question.key])]),
  );
  // The path decides what shows (spec 0063, AC-6314): a question's Show when, and with Steps its step's too.
  const path = pathOf(form, given);
  const shown = path.keys;
  // Questions that appear or go with an answer are said aloud once (spec 0043): the count is compared on render.
  const [seenCount, setSeenCount] = useState(shown.size);
  const [shownNote, setShownNote] = useState('');
  if (shown.size !== seenCount) {
    setSeenCount(shown.size);
    setShownNote(shown.size > seenCount ? words.questionsShown : words.questionsHidden);
  }
  const checkAll = (questions: readonly PublicQuestion[]) => {
    const visible = questions
      .filter((question) => shown.has(question.key))
      .map(({ showWhen: _decided, ...question }) => question);
    return checkAnswers(
      { language: form.language, questions: visible },
      Object.fromEntries(visible.map((question) => [question.key, given[question.key]])),
    );
  };

  const change = (question: PublicQuestion, value: unknown) => {
    setAnswers((current) => ({ ...current, [question.key]: value }));
    setHints((current) => without(current, question.key));
    if (!isBlank(answerOf(question, value)) && !touched.has(question.key)) {
      setTouched((current) => new Set([...current, question.key]));
    }
    // A shown error clears the moment it stops being true (the answer passes, or now fails for another
    // reason, which focus leaving will say); a new one never appears while typing.
    if (
      errors[question.key] !== undefined &&
      messageOf(form, question, answerOf(question, value)) !== errors[question.key]
    ) {
      setErrors((current) => without(current, question.key));
    }
  };

  const blur = (question: PublicQuestion, event: FocusEvent<HTMLElement>) => {
    // A tick box or a yes or no is never blank, so it waits for submit: tabbing past one says nothing.
    if (preview || question.answerType === 'checkbox' || question.answerType === 'yes_no') return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (intoItsPopover(next)) return;
    const value = answerOf(question, answers[question.key]);
    if (isBlank(value) && !touched.has(question.key)) return;
    const message = messageOf(form, question, value);
    setErrors((current) =>
      message === undefined ? without(current, question.key) : { ...current, [question.key]: message },
    );
    if (question.answerType === 'email' && message === undefined && typeof value === 'string') {
      const suggestion = suggestEmail(value);
      setHints((current) =>
        suggestion === undefined ? without(current, question.key) : { ...current, [question.key]: suggestion },
      );
    }
  };

  const takeHint = (question: PublicQuestion) => {
    const suggestion = hints[question.key];
    if (suggestion === undefined) return;
    setAnswers((current) => ({ ...current, [question.key]: suggestion }));
    setHints((current) => without(current, question.key));
    focus(question.key);
  };

  const thank = (text: string) => {
    setView({ kind: 'thanks', text });
    setFocusTarget('heading');
  };

  const checkStep = (questions: readonly PublicQuestion[]) => {
    if (preview) return true;
    const result = checkAll(questions);
    if (result.ok) {
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => !questions.some((each) => each.key === key))),
      );
      return true;
    }
    setSubmitted(true);
    show(result.fields, questions);
    return false;
  };

  const submit = () => {
    if (preview || isSending) return;
    setAlert('');
    if (busy.size > 0) {
      setAlert(words.fileBusy);
      return;
    }
    const result = checkAll(form.questions);
    if (!result.ok) {
      setSubmitted(true);
      onRefused?.(Object.keys(result.fields));
      show(result.fields, form.questions);
      return;
    }
    // A page with nowhere to send (a draft opened to try) checks the answers, then thanks.
    if (onSubmit === undefined) {
      thank(form.thanks ?? '');
      return;
    }
    // A hidden question's answer stays behind: the server would drop it too.
    const sending = Object.fromEntries(
      form.questions
        .filter((question) => shown.has(question.key))
        .map((question) => [question.key, given[question.key]]),
    );
    setSending(true);
    void onSubmit({ answers: sending, trap, fillMs: Math.max(0, now() - startedAt), round }).then((outcome) => {
      setSending(false);
      switch (outcome.kind) {
        case 'done':
          if (outcome.next.kind === 'redirect') onRedirect?.(outcome.next.url);
          else if (outcome.next.kind === 'booking') {
            const { url, countdownSeconds, text } = outcome.next;
            // A countdown of 0 goes at once, and the page says so while it goes (AC-1059).
            if (countdownSeconds === 0) onRedirect?.(url);
            // Still sending to the visitor while the countdown's chunk arrives; if it can't, they go on at once (once),
            // and with nowhere to go they get the thank you.
            setSending(true);
            import('./FormBooking.tsx').then(
              (module) => {
                setSending(false);
                setBookingView(() => module.FormBooking);
                setView({ kind: 'booking', url, seconds: countdownSeconds, text });
                setFocusTarget('heading');
              },
              () => {
                setSending(false);
                if (onRedirect === undefined) thank(text);
                else if (countdownSeconds > 0) onRedirect(url);
              },
            );
          } else thank(outcome.next.text);
          return;
        case 'invalid':
          // A question this page never drew (late trap #18): the form was published again more than a day after it
          // loaded. Nothing on the page could be marked, so it says so rather than re-enabling the button silently.
          if (Object.keys(outcome.fields).some((key) => !form.questions.some((question) => question.key === key))) {
            if (onStale === undefined) {
              setAlert(words.changed);
              return;
            }
            setSending(true);
            void onStale().then(
              (isNew) => {
                setSending(false);
                setAlert(isNew ? words.updated : words.changed);
              },
              () => {
                setSending(false);
                setAlert(words.changed);
              },
            );
            return;
          }
          setSubmitted(true);
          onRefused?.(Object.keys(outcome.fields));
          show(outcome.fields, form.questions);
          return;
        case 'closed':
          setView({ kind: 'closed' });
          setFocusTarget('heading');
          return;
        case 'offline':
          setAlert(words.offline);
          return;
        case 'limited':
          setAlert(words.tooMany);
          return;
        case 'failed':
          setAlert(words.failed);
          return;
      }
    });
  };

  const sendAnother = () => {
    setRound((count) => count + 1);
    setAnswers(firstAnswers(form, countryGuess, countryNames, prefill));
    setErrors({});
    setHints({});
    setTouched(new Set());
    setSubmitted(false);
    setTrap('');
    setStartedAt(now());
    setView({ kind: 'form' });
    setFocusTarget('heading');
  };

  const summary = isSubmitted
    ? form.questions.filter((question) => shown.has(question.key) && errors[question.key] !== undefined)
    : [];

  const state: HostedFormState = {
    words,
    preview,
    countryNames,
    answers,
    errors,
    hints,
    summary,
    shown,
    path,
    shownNote,
    alert,
    isSending,
    files:
      preview || onUpload === undefined
        ? undefined
        : {
            upload: onUpload,
            remove: onRemoveUpload ?? (() => Promise.resolve()),
            setBusy: (key, isBusy) => {
              setBusy((current) => {
                const next = new Set(current);
                if (isBusy) next.add(key);
                else next.delete(key);
                return next;
              });
            },
          },
    isClosed,
    view,
    bookingView,
    round,
    trap,
    setTrap,
    change,
    blur,
    takeHint,
    checkStep,
    submit,
    sendAnother,
    goTo: (url) => {
      if (!preview) onRedirect?.(url);
    },
    focus,
  };
  return { state, refs: { container, heading } };
}
