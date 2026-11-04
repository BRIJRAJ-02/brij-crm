// The hosted form's state, shared by every layout (spec 0023,
// 0023-form-design.md, The field checker): the answers, the field checker
// (a question is checked when it loses focus with something in it, and every
// question on submit; a shown error clears the moment it is fixed, but a new
// one never appears while typing), the email typo hint, the send and what
// follows it. No markup: Classic and the step layouts draw from it.
import { answerText } from './SentAnswers.tsx';
import {
  checkAnswers,
  formStrings,
  isBlank,
  pathOf,
  recall,
  scoreOf,
  SHORT_ANSWER_MAX,
  suggestEmail,
  type FormPath,
  type FormStrings,
  type PublicForm,
  type PublicQuestion,
  type SubmitNext,
} from '@crm/contracts/forms';
import { useEffect, useMemo, useRef, useState, type FocusEvent, type RefObject } from 'react';
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

/**
 * What the form's own counts are told (spec 0063, AC-6320): the first answer was given, or a question was
 * reached. `view` is not here — the page itself knows it was seen, and says so before this ever runs.
 */
export type HostedFormCount = { readonly kind: 'start' } | { readonly kind: 'reach'; readonly questionId: string };

/** What a save answered (spec 0063, AC-6319): the link that brings the visitor back, and when it stops working. */
export interface HostedFormKept {
  readonly resumeToken: string;
  /** The whole address to come back to, built by the page: the form's own, with the token on it. */
  readonly resumeUrl: string;
  /** ISO 8601 UTC. */
  readonly expiresAt: string;
}

/** Where a save has got to, for the line under the form and the Finish later panel. */
export type HostedSaveState =
  | { readonly kind: 'none' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'kept'; readonly kept: HostedFormKept }
  | { readonly kind: 'failed' };

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
  /**
   * Told what the visitor did, for the form's own counts (spec 0063, AC-6320). Each thing is said once:
   * `start` on the first answer, `reach` the first time a question is on screen. Never in the builder's
   * preview, and never awaited — a count is a side note, not a step in filling the form in.
   */
  readonly onCount?: ((count: HostedFormCount) => void) | undefined;
  /**
   * Keeps what has been typed so far and answers the link back (spec 0063, AC-6319). Without it the form has
   * no Finish later and saves nothing, which is what a form with save and resume turned off does, and what the
   * builder's preview always does.
   */
  readonly onSave?: ((fill: HostedFill) => Promise<HostedFormKept | undefined>) | undefined;
  /** Emails the resume link to the address this form already holds; false when there is none to send to. */
  readonly onEmailResume?: ((resumeToken: string) => Promise<boolean>) | undefined;
  /** A fill the visitor is coming back to: its answers are already in `prefill`, this is the step they left on. */
  readonly resumedStepId?: string | undefined;
}

/** What a save sends: the answers so far and the step they are on. */
export interface HostedFill {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly stepId?: string | undefined;
}

/**
 * How long the typing stops before a long Classic form keeps itself (spec 0063, AC-6319). Long enough that it
 * is not one save per word, short enough that a closed tab rarely loses more than a sentence.
 */
const QUIET_SAVE_MS = 2_000;

/** How many questions make a Classic form long enough to keep itself as it is filled in (AC-6319). */
const QUIET_SAVE_FROM = 10;

type Answers = Readonly<Record<string, unknown>>;
type Messages = Readonly<Record<string, string>>;

/** Which view the form shows. */
export type HostedFormView =
  | { readonly kind: 'form' }
  | {
      readonly kind: 'thanks';
      readonly text: string;
      /** The ending's own heading, when the server answered with one (spec 0063, AC-6315). */
      readonly heading?: string | undefined;
      /** The ending's button: a web address and its words. */
      readonly button?: { readonly url: string; readonly label: string } | undefined;
    }
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
  /**
   * The score of the answers so far (spec 0063, AC-6316), for what the page shows: the server adds the stored
   * answers up again at submit and files only its own total, so this number decides nothing.
   */
  readonly score: number;
  /** A label's or an ending's recalls read as plain text (AC-6317): never markup, whatever a visitor typed. */
  readonly read: (text: string) => string;
  /** What a polite live line says after an answer shows or hides questions; empty otherwise. */
  readonly shownNote: string;
  readonly alert: string;
  /**
   * The form was closed while this visitor filled it in (a send answered closed): the form and their answers stay
   * on screen, the closed line shows above Send, and they can copy what they wrote (forms QA, 5 November 2026).
   */
  readonly isClosedMidFill: boolean;
  /** What they wrote, as plain lines ("Your name: Ada"), for Copy my answers. */
  readonly answersText: () => string;
  readonly isSending: boolean;
  /** The page's file calls for a file question, where it has them (never in a preview). */
  readonly files: HostedFileHandlers | undefined;
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
  /**
   * Says these questions are on the visitor's screen now, for the drop off bar (AC-6321). A layout calls it
   * with what it has just drawn; each question counts once, so calling it on every render is right.
   */
  readonly reached: (questionIds: readonly string[]) => void;
  /** Where a save has got to (spec 0063, AC-6319); `none` on a form that keeps nothing. */
  readonly save: HostedSaveState;
  /** Whether this form keeps anything at all: without it there is no Finish later to draw. */
  readonly savesFills: boolean;
  /** Keeps what is typed now, whatever the layout: what Finish later presses. */
  readonly keepNow: (stepId?: string) => void;
  /** Emails the resume link; undefined where the page gave no way to. */
  readonly emailResume: HostedFormSettings['onEmailResume'];
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
  onCount,
  onSave,
  onEmailResume,
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
  const [isClosedMidFill, setClosedMidFill] = useState(false);
  // A press in progress (pointer down, not yet up): a check on leaving a field waits for it to end, so an error line
  // never pushes Send down between its press and release and loses the press (forms QA, 5 November 2026).
  const pressing = useRef(false);
  const afterPress = useRef<(() => void)[]>([]);
  useEffect(() => {
    const down = () => {
      pressing.current = true;
    };
    const up = () => {
      // After the click the release makes, so Send's own check runs first.
      globalThis.setTimeout(() => {
        pressing.current = false;
        const held = afterPress.current;
        afterPress.current = [];
        for (const each of held) each();
      }, 0);
    };
    globalThis.addEventListener('pointerdown', down, true);
    globalThis.addEventListener('pointerup', up, true);
    globalThis.addEventListener('pointercancel', up, true);
    return () => {
      globalThis.removeEventListener('pointerdown', down, true);
      globalThis.removeEventListener('pointerup', up, true);
      globalThis.removeEventListener('pointercancel', up, true);
    };
  }, []);
  // The file questions with a file still going: the form won't send until they are in.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [trap, setTrap] = useState('');
  const [view, setView] = useState<HostedFormView>({ kind: 'form' });
  const [round, setRound] = useState(0);
  const [startedAt, setStartedAt] = useState(now);
  const [focusTarget, setFocusTarget] = useState<'heading' | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // What has already been counted, so each thing is said once however often it is drawn. A ref, not state:
  // counting must never be a reason to render, and a count that arrives twice would be a wrong number.
  const counted = useRef<Set<string>>(new Set());
  // Only a Classic form saves on a quiet timer: a stepped one has Continue, which is a better moment than a
  // pause in typing, and a short one has little enough to lose that the requests are not worth it.
  const savesQuietly =
    onSave !== undefined &&
    !preview &&
    (form.layout === undefined || form.layout === 'classic') &&
    form.questions.length > QUIET_SAVE_FROM;
  const [saveState, setSaveState] = useState<HostedSaveState>({ kind: 'none' });
  const savingFill = useRef<HostedFill | undefined>(undefined);
  const quiet = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Keeps the fill, at most one save at a time. A save that arrives while one is going is held as the newest
   * fill and sent when that one lands, so typing never queues a save per keystroke and the last state typed is
   * always the state kept.
   */
  const keep = (fill: HostedFill) => {
    if (onSave === undefined || preview) return;
    if (savingFill.current !== undefined) {
      savingFill.current = fill;
      return;
    }
    savingFill.current = fill;
    setSaveState((current) => (current.kind === 'kept' ? current : { kind: 'saving' }));
    const send = (sending: HostedFill): void => {
      // The page holds the token and puts it on the body: which partial this is belongs to whoever talks to
      // the server, not to the form's state.
      void onSave(sending).then(
        (kept) => {
          const next = savingFill.current;
          savingFill.current = undefined;
          if (kept === undefined) {
            setSaveState({ kind: 'failed' });
            return;
          }
          setSaveState({ kind: 'kept', kept });
          // Something was typed while this one was going: keep that too, so the newest answers are the kept ones.
          if (next !== undefined && next !== sending) {
            savingFill.current = next;
            send(next);
          }
        },
        () => {
          savingFill.current = undefined;
          setSaveState({ kind: 'failed' });
        },
      );
    };
    send(fill);
  };

  useEffect(
    () => () => {
      if (quiet.current !== undefined) clearTimeout(quiet.current);
    },
    [],
  );

  // Questions on screen before the first answer: a look is not a start (critique c, 4: every view counted as a
  // start, since a form's first questions are reached the moment it draws). They are said once it starts.
  const waiting = useRef<string[]>([]);
  const count = (event: HostedFormCount) => {
    if (preview || onCount === undefined) return;
    const token = event.kind === 'start' ? 'start' : `reach:${event.questionId}`;
    if (counted.current.has(token)) return;
    if (event.kind === 'reach' && !counted.current.has('start')) {
      if (!waiting.current.includes(event.questionId)) waiting.current.push(event.questionId);
      return;
    }
    counted.current.add(token);
    onCount(event);
    if (event.kind === 'start') {
      const held = waiting.current;
      waiting.current = [];
      for (const questionId of held) count({ kind: 'reach', questionId });
    }
  };
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
  // What the answers so far are worth, and the reader a label's recalls go through (AC-6316, AC-6317).
  const score = scoreOf(form, given);
  const answerTypes = Object.fromEntries(form.questions.map((question) => [question.key, question.answerType]));
  const read = (text: string) => recall(text, { answers: given, score, answerTypes });
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
      // The form was started the moment one question holds an answer. A prefilled one is not a start: those
      // arrive in `firstAnswers`, which never goes through here.
      count({ kind: 'start' });
    }
    // A long Classic form has no Continue to save on, so it saves when the typing stops (AC-6319). A short one
    // does not: there is less to lose than the save would cost in requests, and Finish later still saves on press.
    if (savesQuietly) {
      if (quiet.current !== undefined) clearTimeout(quiet.current);
      quiet.current = setTimeout(() => {
        quiet.current = undefined;
        keep({ answers: { ...answers, [question.key]: value } });
      }, QUIET_SAVE_MS);
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
    // A tick box, a consent or a yes or no is never blank, so it waits for submit: tabbing past one says nothing.
    if (
      preview ||
      question.answerType === 'checkbox' ||
      question.answerType === 'yes_no' ||
      question.answerType === 'consent'
    ) {
      return;
    }
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    if (intoItsPopover(next)) return;
    const value = answerOf(question, answers[question.key]);
    if (isBlank(value) && !touched.has(question.key)) return;
    const message = messageOf(form, question, value);
    const mark = () => {
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
    // Focus left because something is being pressed: the line under the field waits until the press is over.
    if (pressing.current) afterPress.current.push(mark);
    else mark();
  };

  const takeHint = (question: PublicQuestion) => {
    const suggestion = hints[question.key];
    if (suggestion === undefined) return;
    setAnswers((current) => ({ ...current, [question.key]: suggestion }));
    setHints((current) => without(current, question.key));
    focus(question.key);
  };

  const thank = (
    text: string,
    ending?: {
      readonly heading?: string | undefined;
      readonly button?: { readonly url: string; readonly label: string } | undefined;
    },
  ) => {
    setView({ kind: 'thanks', text, ...(ending ?? {}) });
    setFocusTarget('heading');
  };

  const checkStep = (questions: readonly PublicQuestion[]) => {
    if (preview) return true;
    // A file or a signature of this step still going: on once it is in, as Send waits for it.
    if (questions.some((question) => busy.has(question.key))) {
      setAlert(words.fileBusy);
      return false;
    }
    setAlert('');
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

  /** A step passed its check and the visitor is moving on, so what they have typed is kept (AC-6319). */
  const keepStep = (stepId: string | undefined) => {
    keep({ answers, ...(stepId === undefined ? {} : { stepId }) });
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
    // A page with nowhere to send (a draft opened to try) checks the answers, then thanks: with the ending the
    // path named, so the builder's preview shows the ending a visitor would land on (AC-6315).
    if (onSubmit === undefined) {
      const ending = (form.endings ?? []).find((each) => each.id === path.ending);
      if (ending === undefined) {
        thank(form.thanks ?? '');
        return;
      }
      thank(read(ending.line ?? ''), {
        heading: read(ending.heading),
        ...(ending.button === undefined ? {} : { button: ending.button }),
      });
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
          } else {
            const { text, heading, button } = outcome.next;
            thank(text, { ...(heading === undefined ? {} : { heading }), ...(button === undefined ? {} : { button }) });
          }
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
          // Closed while they filled it in: everything they typed stays, with the closed line above Send and a
          // way to keep their words, rather than the whole form swapped for one sentence.
          setClosedMidFill(true);
          setAlert(words.closed);
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
    score,
    read,
    shownNote,
    alert,
    isClosedMidFill,
    answersText: () =>
      form.questions
        .flatMap((question) => {
          if (!shown.has(question.key)) return [];
          const text = answerText(question.answerType, answers[question.key], words.signed);
          return text === ''
            ? []
            : [`${question.label.trim() === '' ? words.untitledQuestion : read(question.label)}: ${text}`];
        })
        .join('\n'),
    isSending,
    files:
      preview || onUpload === undefined
        ? undefined
        : {
            upload: onUpload,
            remove: onRemoveUpload ?? (() => Promise.resolve()),
            setBusy: (key, isBusy) => {
              setBusy((current) => {
                // Unchanged, the same set: a signature typed key by key says busy on every key.
                if (current.has(key) === isBusy) return current;
                const next = new Set(current);
                if (isBusy) next.add(key);
                else next.delete(key);
                return next;
              });
            },
          },
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
    reached: (questionIds) => {
      for (const questionId of questionIds) count({ kind: 'reach', questionId });
    },
    save: saveState,
    savesFills: onSave !== undefined && !preview,
    keepNow: keepStep,
    emailResume: onEmailResume,
    focus,
  };
  return { state, refs: { container, heading } };
}
