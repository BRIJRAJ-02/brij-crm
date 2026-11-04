import { Button } from '../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { isBlank, type PublicForm } from '@crm/contracts/forms';
import type { ProductLogo } from '../modules/AuthLayout/AuthLayout.tsx';
import type { PageBrand } from '../modules/BookingFrame/BookingFrame.tsx';
import {
  ErrorSummary,
  FormAlert,
  FormClosed,
  FormFoot,
  FormFrame,
  FormHeader,
  FormThanks,
  FormTrap,
  QuestionSlot,
  TIMEFIX_LOGO,
} from './FormParts.tsx';
import styles from './HostedForm.module.css';
import { BookingView, useLoadedBooking } from './BookingView.tsx';
import type { HostedRemoveUpload, HostedUpload } from './files.ts';
import { useEffect } from 'react';
import { FinishLater } from './FinishLater.tsx';
import { answerOf, Question } from './Question.tsx';
import { SentAnswers } from './SentAnswers.tsx';
import {
  type HostedFill,
  type HostedFormCount,
  type HostedFormKept,
  useHostedForm,
  type HostedFormMode,
  type HostedSubmission,
  type HostedSubmitOutcome,
  type PrefillValue,
  type PreviewEnding,
} from './use-hosted-form.ts';

export { FormLoading, FormMessage } from './FormParts.tsx';

export type { HostedFormMode, HostedSubmission, HostedSubmitOutcome } from './use-hosted-form.ts';

/** Props for HostedForm. */
export interface HostedFormProps {
  readonly form: PublicForm;
  readonly mode: HostedFormMode;
  /** The country picked first for phone and country questions (ISO alpha 2), guessed by the page. */
  readonly countryGuess?: string;
  /**
   * Answers to start with, by question key, from the page's address (or the
   * site's, through an embed): text and hidden questions take the words, a
   * dropdown or choice one of its choices or its key, a multi select each of a
   * repeated key's (`prefillAnswer`). Anything that doesn't fit is ignored.
   */
  readonly prefill?: Readonly<Record<string, PrefillValue>>;
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
  /** Told what the visitor did, for the form's own counts (spec 0063, AC-6320); see `HostedFormCount`. */
  readonly onCount?: ((count: HostedFormCount) => void) | undefined;
  /** Keeps what has been typed so far and answers the link back (spec 0063, AC-6319); see `HostedFormSettings`. */
  readonly onSave?: ((fill: HostedFill) => Promise<HostedFormKept | undefined>) | undefined;
  /** Emails the resume link to the address this form already holds; false when there is none. */
  readonly onEmailResume?: ((resumeToken: string) => Promise<boolean>) | undefined;
  /** The step a resumed fill was left on (spec 0063, AC-6319): a stepped form opens there, Classic ignores it. */
  readonly resumedStepId?: string | undefined;
  /** The clock, for the fill time (tests pass their own). */
  readonly now?: () => number;
  /** The builder's preview: the thank you or an ending drawn in the form's place while it is open. */
  readonly previewEnding?: PreviewEnding | undefined;
  /** The Timefix wordmark under the form; the web app serves these two by default. */
  readonly logo?: ProductLogo;
  /**
   * The workspace's brand kit, for an app preview (spec 0060, AC-1): its logo and its accent's custom properties.
   * Left out, the form wears the brand its own read names (its logo; the page's stylesheet brings the accent).
   */
  readonly brand?: PageBrand;
  /**
   * How a site's inline embed asked to draw it (T44's Share tab): `isTransparent` leaves the ground clear so the
   * site's own background shows, `isTitleHidden` keeps the headline for screen readers only (FormHeader's
   * `isVisuallyHidden`; the site has its own).
   */
  readonly embedLook?: EmbedLook;
}

/** How a site's inline embed asked the form to draw. */
export interface EmbedLook {
  readonly isTransparent?: boolean;
  readonly isTitleHidden?: boolean;
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
  onCount,
  onSave,
  onEmailResume,
  now = Date.now,
  previewEnding,
  logo = TIMEFIX_LOGO,
  brand,
  embedLook,
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
    onCount,
    onSave,
    onEmailResume,
    now,
    previewEnding,
  });
  const { words, preview } = state;
  const loadedBooking = useLoadedBooking();
  // Classic puts every shown question on screen at once, so seeing one says nothing: a question is reached once
  // it, or one after it, holds an answer (critique c, 4), and the furthest answered is where a visitor stopped.
  const shownQuestions = form.questions.filter(
    (question) => state.shown.has(question.key) && question.answerType !== 'hidden',
  );
  const furthest = shownQuestions.findLastIndex(
    (question) => !isBlank(answerOf(question, state.answers[question.key])),
  );
  const onScreen = shownQuestions.slice(0, furthest + 1).map((question) => question.id);
  useEffect(() => {
    if (state.view.kind === 'form' && !state.isClosed) state.reached(onScreen);
  });
  let body;
  if (state.isClosed) body = <FormClosed state={state} mode={mode} heading={refs.heading} />;
  else if (state.view.kind === 'booking') {
    body = (
      <BookingView
        loaded={loadedBooking}
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
        <FormHeader
          form={form}
          mode={mode}
          heading={refs.heading}
          isVisuallyHidden={embedLook?.isTitleHidden === true}
        />
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
            // A hidden question has nothing to draw (spec 0063): it is answered by the link or its default.
            .filter((question) => state.shown.has(question.key) && question.answerType !== 'hidden')
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
                  read={state.read}
                />
              </QuestionSlot>
            ))}
          <FormTrap form={form} state={state} />
          <div className={styles.actions}>
            <ErrorSummary state={state} />
            <FormAlert state={state} />
            <Button
              variant="primary"
              size="public"
              type={preview ? 'button' : 'submit'}
              isFullWidth="center"
              // Closed while they filled it in: nothing more to send, only their answers to keep.
              isDisabled={state.isClosedMidFill}
            >
              {state.isSending ? words.sending : form.buttonText}
            </Button>
            <FinishLater state={state} language={form.language} />
          </div>
        </form>
      </>
    );
  }
  return (
    <FormFrame
      form={form}
      mode={mode}
      {...(brand === undefined ? {} : { brand })}
      {...(embedLook === undefined ? {} : { embedLook })}
      container={refs.container}
      {...(preview ? { previewNote: words.previewNote } : {})}
      foot={<FormFoot form={form} mode={mode} logo={logo} state={state} />}
    >
      {body}
    </FormFrame>
  );
}
