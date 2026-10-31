import { useEffect, useState } from 'react';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { PublicForm } from '@crm/contracts/forms';
import { Button } from '../atoms/Button/Button.tsx';
import type { ProductLogo } from '../modules/AuthLayout/AuthLayout.tsx';
import {
  ErrorSummary,
  FormAlert,
  FormClosed,
  FormConfirmation,
  FormFoot,
  FormFrame,
  FormHeader,
  FormThanks,
  FormTrap,
  QuestionSlot,
  TIMEFIX_LOGO,
} from './FormParts.tsx';
import styles from './HostedForm.module.css';
import type { FormBooking as EagerFormBooking, FormBookingProps } from './FormBooking.tsx';
import type { HostedRemoveUpload, HostedUpload } from './files.ts';
import { Question } from './Question.tsx';
import { SentAnswers } from './SentAnswers.tsx';
import {
  useHostedForm,
  type HostedFormMode,
  type HostedSubmission,
  type HostedSubmitOutcome,
} from './use-hosted-form.ts';

export { FormLoading, FormMessage } from './FormParts.tsx';

/**
 * Sent, and on to book (FormBooking), in a chunk of its own: nobody sees it before they send, and the hosted page's
 * first load has no room to spare (apps/web/.size-limit.js). It starts loading once the form is drawn and is kept
 * once here, so by the time anyone presses Send it draws at once, and its heading can take focus in the same render;
 * BookingFallback stands in until it arrives, or for good if it can't.
 */
const loadBooking = () => import('./FormBooking.tsx');

/**
 * Sent, while the countdown's chunk is still arriving or when it can't be fetched (a flaky network, or a deploy
 * between load and Send): the answers are saved, so the thank you shows with Book a time as its one way on, never a
 * blank page. What was sent reads back above it, as on the countdown.
 */
function BookingFallback({ state, mode, heading, url, text, summary }: FormBookingProps) {
  return (
    <FormConfirmation mode={mode} heading={heading} title={state.words.thanksTitle} text={text} summary={summary}>
      <Button
        variant="primary"
        size="lg"
        onPress={() => {
          state.goTo(url);
        }}
      >
        {state.words.bookATime}
      </Button>
    </FormConfirmation>
  );
}

export type { HostedFormMode, HostedSubmission, HostedSubmitOutcome } from './use-hosted-form.ts';

/** Props for HostedForm. */
export interface HostedFormProps {
  readonly form: PublicForm;
  readonly mode: HostedFormMode;
  /** The country picked first for phone and country questions (ISO alpha 2), guessed by the page. */
  readonly countryGuess?: string;
  /**
   * Answers to start with, by question key, from the page's address (or the
   * site's, through an embed): text questions take the words, a dropdown or
   * choice takes one of its choices or its key. Anything else is ignored.
   */
  readonly prefill?: Readonly<Record<string, string>>;
  /** Sends the answers. Without it the answers are checked and the thank you shows, but nothing is sent. */
  readonly onSubmit?: (submission: HostedSubmission) => Promise<HostedSubmitOutcome>;
  /** Sends a file for a file question (#32), reporting progress; without it the file question is disabled. */
  readonly onUpload?: HostedUpload;
  /** Takes back a file the visitor sent and removed. */
  readonly onRemoveUpload?: HostedRemoveUpload;
  /** Goes to the form's web address after a submission, when it sends visitors on. */
  readonly onRedirect?: (url: string) => void;
  /** Reads the form again and draws its new version in place, the answers kept; answers whether it could. */
  readonly onStale?: () => Promise<boolean>;
  /** The clock, for the fill time (tests pass their own). */
  readonly now?: () => number;
  /** The Timefix wordmark under the form; the web app serves these two by default. */
  readonly logo?: ProductLogo;
}

/**
 * The form a visitor fills in, Classic layout (spec 0023,
 * 0023-form-design.md): every question on one card, drawn with the library's
 * own controls, so the hosted page, the embed and the builder's preview are
 * one component tree and one input design. Questions are checked as they
 * lose focus and all at once on submit, with `checkAnswers`, so the visitor
 * sees what the server would say. The caller sends the answers.
 */
export function HostedForm({
  form,
  mode,
  countryGuess,
  prefill,
  onSubmit,
  onRedirect,
  onUpload,
  onRemoveUpload,
  onStale,
  now = Date.now,
  logo = TIMEFIX_LOGO,
}: HostedFormProps) {
  const { state, refs } = useHostedForm({
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
  });
  const { words, preview } = state;
  const [LoadedBooking, setLoadedBooking] = useState<typeof EagerFormBooking>();
  useEffect(() => {
    // A chunk that can't be fetched leaves BookingFallback in its place.
    void loadBooking().then(
      (module) => {
        setLoadedBooking(() => module.FormBooking);
      },
      () => undefined,
    );
  }, []);
  const Booking = LoadedBooking ?? BookingFallback;
  let body;
  if (state.isClosed) body = <FormClosed state={state} mode={mode} heading={refs.heading} />;
  else if (state.view.kind === 'booking') {
    body = (
      <Booking
        state={state}
        mode={mode}
        heading={refs.heading}
        url={state.view.url}
        seconds={state.view.seconds}
        text={state.view.text}
        summary={<SentAnswers form={form} state={state} />}
      />
    );
  } else if (state.view.kind === 'thanks')
    body = <FormThanks form={form} state={state} mode={mode} heading={refs.heading} />;
  else {
    body = (
      <>
        <FormHeader form={form} mode={mode} heading={refs.heading} />
        <VisuallyHidden>
          <span aria-live="polite">{state.shownNote}</span>
        </VisuallyHidden>
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            state.submit();
          }}
        >
          {form.questions
            .filter((question) => state.shown.has(question.key))
            .map((question) => (
              <QuestionSlot key={`${String(state.round)}-${question.key}`} question={question} state={state}>
                <Question
                  question={question}
                  words={words}
                  value={state.answers[question.key]}
                  error={state.errors[question.key]}
                  countryGuess={countryGuess}
                  countryNames={state.countryNames}
                  onChange={(value) => state.change(question, value)}
                  files={state.files}
                />
              </QuestionSlot>
            ))}
          <FormTrap form={form} state={state} />
          <div className={styles.actions}>
            <ErrorSummary state={state} />
            <FormAlert state={state} />
            <Button variant="primary" size="lg" type={preview ? 'button' : 'submit'} isFullWidth="center">
              {state.isSending ? words.sending : form.buttonText}
            </Button>
          </div>
        </form>
      </>
    );
  }
  return (
    <FormFrame
      form={form}
      mode={mode}
      container={refs.container}
      {...(preview ? { previewNote: words.previewNote } : {})}
      foot={<FormFoot form={form} mode={mode} logo={logo} state={state} />}
    >
      {body}
    </FormFrame>
  );
}
