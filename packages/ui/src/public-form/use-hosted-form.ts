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
  suggestEmail,
  type FormStrings,
  type PublicForm,
  type PublicQuestion,
  type SubmitNext,
  visibleQuestions,
} from '@crm/contracts/forms';
import { useEffect, useMemo, useRef, useState, type FocusEvent, type RefObject } from 'react';
import { countriesIn } from '../lib/countries.ts';
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
  readonly prefill?: Readonly<Record<string, string>> | undefined;
  readonly onSubmit?: ((submission: HostedSubmission) => Promise<HostedSubmitOutcome>) | undefined;
  readonly onRedirect?: ((url: string) => void) | undefined;
  readonly now: () => number;
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
  readonly alert: string;
  readonly isSending: boolean;
  readonly isClosed: boolean;
  readonly view: HostedFormView;
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
const PREFILLED_AS_TEXT: ReadonlySet<string> = new Set(['short_text', 'long_text', 'email', 'website', 'number']);

/** A question's start from a prefill: the words for text, a choice by its words or its key; undefined otherwise. */
export function prefillAnswer(question: PublicQuestion, given: string | undefined): string | undefined {
  if (given === undefined) return undefined;
  const words = given.trim().slice(0, 500);
  if (words === '') return undefined;
  if (PREFILLED_AS_TEXT.has(question.answerType)) return words;
  if (question.answerType !== 'dropdown' && question.answerType !== 'choice') return undefined;
  const choices = question.choices ?? [];
  if (choices.includes(words)) return words;
  const at = (question.choiceKeys ?? []).indexOf(words);
  return at === -1 ? undefined : choices[at];
}

/** The answers a form starts with: the guessed country for a country question, and the prefill's answers. */
function firstAnswers(
  form: PublicForm,
  countryGuess: string | undefined,
  countryNames: ReadonlyMap<string, string>,
  prefill: Readonly<Record<string, string>> | undefined,
): Answers {
  return Object.fromEntries(
    form.questions.flatMap((question) => {
      const given = prefillAnswer(question, prefill?.[question.key]);
      if (given !== undefined) return [[question.key, given]];
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
  const [trap, setTrap] = useState('');
  const [view, setView] = useState<HostedFormView>({ kind: 'form' });
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
  const shown = visibleQuestions(form.questions, given);
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
            setView({ kind: 'booking', url, seconds: countdownSeconds, text });
            setFocusTarget('heading');
            if (countdownSeconds === 0) onRedirect?.(url);
          } else thank(outcome.next.text);
          return;
        case 'invalid':
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
    alert,
    isSending,
    isClosed,
    view,
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
