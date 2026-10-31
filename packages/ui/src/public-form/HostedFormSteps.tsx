import type { PublicQuestion } from '@crm/contracts/forms';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { ProgressBar } from '../atoms/ProgressBar/ProgressBar.tsx';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
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
import type { HostedFormProps } from './HostedForm.tsx';
import styles from './HostedFormSteps.module.css';
import { asideOf, labelOf, Question } from './Question.tsx';
import { useHostedForm } from './use-hosted-form.ts';

/** Props for HostedFormSteps: the same as Classic's; the layout and the steps come with the form. */
export type HostedFormStepsProps = HostedFormProps;

/** The step layouts this component draws. */
type StepsLayout = 'steps' | 'conversational';

/** True for a question whose control goes on with Enter (one line of text, a choice, or one at a time a long answer). */
function takesEnter(question: PublicQuestion | undefined): boolean {
  return (
    question !== undefined &&
    ['short_text', 'long_text', 'email', 'phone', 'website', 'number', 'choice'].includes(question.answerType)
  );
}

/**
 * How long a one at a time choice stays on screen once picked before the next question comes (AC-6305): long
 * enough to see the pick land, short enough not to wait on. None under reduced motion.
 */
const ADVANCE_PAUSE_MS = 400;

/** True when the visitor asked for less motion. */
function prefersStill(): boolean {
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The form a visitor fills in, a step at a time (spec 0023,
 * 0023-form-design.md, Form types): `steps` groups questions with a progress
 * line, Back and Continue, and checks each step before moving on;
 * `conversational` asks one question at a time, large, with Enter to go on.
 * Both share Classic's state, checker, thank you and foot. The steps are the
 * visitor's path (`pathOf`, spec 0063): a step its Show when hides, or one
 * with nothing showing, is skipped and not counted.
 */
export function HostedFormSteps({
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
}: HostedFormStepsProps) {
  const [index, setIndex] = useState(0);
  const [hasMoved, setMoved] = useState(false);
  // Continue and Back focus the new step's first question; a refusal that goes back focuses its problem instead.
  const [focusesStep, setFocusesStep] = useState(false);
  const [round, setRound] = useState(0);
  // One at a time, the pointer picks on the question showing (each restarts the pause before going on).
  const [picks, setPicks] = useState(0);
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
    // A refusal for an earlier step goes back to it, where its errors show.
    onRefused: (keys) => {
      const at = groups.findIndex((group) => group.questions.some((question) => keys.includes(question.key)));
      if (at !== -1) {
        setFocusesStep(false);
        setIndex(at);
      }
    },
  });
  const { words, preview } = state;
  const layout: StepsLayout = form.layout === 'conversational' ? 'conversational' : 'steps';
  const byKey = new Map(form.questions.map((question) => [question.key, question]));
  const groups = state.path.steps.map((shown) => ({
    title: shown.title,
    questions: shown.keys.flatMap((key) => {
      const question = byKey.get(key);
      return question === undefined ? [] : [question];
    }),
  }));
  // Send another starts again from the first step.
  if (state.round !== round) {
    setRound(state.round);
    setIndex(0);
    setMoved(false);
    setFocusesStep(false);
    setPicks(0);
  }
  const step = groups[Math.min(index, groups.length - 1)] ?? { title: undefined, questions: [] };
  const isLast = index >= groups.length - 1;
  const first = step.questions[0];

  // A step reached by Continue or Back puts focus on its first question.
  useEffect(() => {
    if (!focusesStep || first === undefined) return;
    state.focus(first.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the step changes
  }, [index]);

  const go = (next: number) => {
    setPicks(0);
    setMoved(true);
    setFocusesStep(true);
    setIndex(next);
  };
  // A one at a time choice goes on by itself once picked (AC-6305), through the form's own submit so the same check
  // runs; a change of mind before the pause ends starts it again, and leaving the question drops it. Only a pick by
  // pointer: the arrow keys move through a radio group's choices, so a keyboard goes on with Enter instead.
  const formRef = useRef<HTMLFormElement>(null);
  const byPointer = useRef(false);
  // Picks by pointer on the question showing: each one starts the pause again, and moving on clears it. The last
  // question never sends by itself: sending is the visitor's own press.
  useEffect(() => {
    if (picks === 0) return undefined;
    const timer = window.setTimeout(
      () => {
        formRef.current?.requestSubmit();
      },
      prefersStill() ? 0 : ADVANCE_PAUSE_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [picks]);
  const place =
    layout === 'conversational' ? words.questionOf(index + 1, groups.length) : words.stepOf(index + 1, groups.length);
  const isOpen = layout === 'conversational';
  // A step's title names its questions: a heading a level under the form's.
  const StepTitle = mode === 'page' ? 'h2' : 'h3';

  let body;
  if (state.isClosed) body = <FormClosed state={state} mode={mode} heading={refs.heading} />;
  else if (state.view.kind === 'booking' && state.bookingView !== undefined) {
    const FormBooking = state.bookingView;
    body = (
      <FormBooking
        state={state}
        mode={mode}
        heading={refs.heading}
        url={state.view.url}
        seconds={state.view.seconds}
        text={state.view.text}
      />
    );
  } else if (state.view.kind === 'thanks')
    body = <FormThanks form={form} state={state} mode={mode} heading={refs.heading} />;
  else {
    body = (
      <>
        {isOpen ? (
          <div className={styles.line}>
            <ProgressBar label={place} valueLabel={place} value={index + 1} maxValue={groups.length} isLabelHidden />
          </div>
        ) : null}
        {!isOpen || index === 0 ? (
          <FormHeader form={form} mode={mode} heading={refs.heading} isSubheadingShown={index === 0} />
        ) : (
          // Past the first question the page keeps its heading, for screen readers only.
          <VisuallyHidden>
            <FormHeader form={form} mode={mode} heading={refs.heading} isSubheadingShown={false} />
          </VisuallyHidden>
        )}
        {!isOpen && (
          <div className={styles.progress}>
            <ProgressBar label={place} valueLabel={place} value={index + 1} maxValue={groups.length} />
            {step.title !== undefined && <StepTitle className={styles.title}>{step.title}</StepTitle>}
          </div>
        )}
        <VisuallyHidden>
          <span aria-live="polite">{hasMoved ? place : ''}</span>
          <span aria-live="polite">{state.shownNote}</span>
        </VisuallyHidden>
        {/* eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions -- the form hears Enter from its own radios, which stay the interactive elements */}
        <form
          key={`${String(state.round)}-${String(index)}`}
          className={styles.form}
          data-layout={layout}
          noValidate
          ref={formRef}
          data-moved={hasMoved || undefined}
          // Capture: a control's press handling keeps these from bubbling.
          onPointerDownCapture={() => {
            byPointer.current = true;
          }}
          onKeyDownCapture={() => {
            byPointer.current = false;
          }}
          onKeyDown={(event) => {
            if (!isOpen || event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            // One at a time, Enter goes on from a choice too (AC-1034), and from a long answer, where Shift and Enter
            // breaks the line (AC-6305); a browser submits only from a one line field.
            const onRadio = event.target instanceof HTMLInputElement && event.target.type === 'radio';
            const inLongText = event.target instanceof HTMLTextAreaElement && !event.shiftKey;
            if (onRadio || inLongText) {
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!isLast) {
              if (state.checkStep(step.questions)) go(index + 1);
              return;
            }
            state.submit();
          }}
        >
          {step.questions.map((question) => {
            const aside = asideOf(question, words);
            return (
              <QuestionSlot key={`${String(state.round)}-${question.key}`} question={question} state={state}>
                {isOpen && (
                  <p className={styles.ask} data-mode={mode} aria-hidden="true">
                    <span className={styles.number}>{String(index + 1)}</span>
                    <span>
                      {labelOf(question, words)}
                      {aside !== undefined && (
                        <>
                          {' '}
                          <span className={styles.aside}>{aside}</span>
                        </>
                      )}
                    </span>
                  </p>
                )}
                <Question
                  question={question}
                  words={words}
                  value={state.answers[question.key]}
                  error={state.errors[question.key]}
                  countryGuess={countryGuess}
                  countryNames={state.countryNames}
                  onChange={(value) => {
                    state.change(question, value);
                    if (isOpen && !preview && question.answerType === 'choice' && byPointer.current && !isLast) {
                      setPicks((count) => count + 1);
                    }
                  }}
                  files={state.files}
                  isLabelHidden={isOpen}
                  hint={isOpen && question.answerType === 'long_text' ? words.newLine : undefined}
                />
              </QuestionSlot>
            );
          })}
          {isLast && <FormTrap form={form} state={state} />}
          <div className={styles.actions}>
            {!isOpen && <ErrorSummary state={state} among={step.questions} />}
            <FormAlert state={state} />
            <div className={styles.buttons} data-layout={layout}>
              {index > 0 && (
                <Button variant="ghost" size="lg" icon="arrow-left" onPress={() => go(index - 1)}>
                  {words.back}
                </Button>
              )}
              <Button
                variant="primary"
                size="lg"
                type={preview ? 'button' : 'submit'}
                {...(isOpen ? (takesEnter(step.questions[0]) ? { kbd: '↵' } : {}) : { isFullWidth: 'center' as const })}
              >
                {state.isSending ? words.sending : isLast ? form.buttonText : isOpen ? words.ok : words.next}
              </Button>
            </div>
          </div>
        </form>
      </>
    );
  }
  return (
    <FormFrame
      form={form}
      mode={mode}
      kind={isOpen ? 'open' : 'card'}
      container={refs.container}
      {...(preview ? { previewNote: words.previewNote } : {})}
      foot={<FormFoot form={form} mode={mode} logo={logo} state={state} />}
    >
      {body}
    </FormFrame>
  );
}
