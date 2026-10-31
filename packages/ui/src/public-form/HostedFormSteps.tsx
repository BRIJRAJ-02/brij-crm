import type { PublicQuestion } from '@crm/contracts/forms';
import { useEffect, useState } from 'react';
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
import { FormBooking } from './FormBooking.tsx';
import { asideOf, labelOf, Question } from './Question.tsx';
import { SentAnswers } from './SentAnswers.tsx';
import { useHostedForm } from './use-hosted-form.ts';

/** One step: a run of question keys, in order, with an optional title ("About your company"). */
export interface FormStep {
  readonly title?: string;
  readonly keys: readonly string[];
}

/** `steps` groups questions into steps; `conversational` asks one question at a time. */
export type HostedFormStepsLayout = 'steps' | 'conversational';

/** Props for HostedFormSteps. */
export interface HostedFormStepsProps extends HostedFormProps {
  readonly layout: HostedFormStepsLayout;
  /** For `steps`: the groups, in order. Questions no step names join the last; none at all is one step. */
  readonly steps?: readonly FormStep[];
}

/** True for a question whose control goes on with Enter (one line of text, or a choice), so OK shows its keycap. */
function takesEnter(question: PublicQuestion | undefined): boolean {
  return (
    question !== undefined &&
    ['short_text', 'email', 'phone', 'website', 'number', 'choice'].includes(question.answerType)
  );
}

interface ResolvedStep {
  readonly title?: string | undefined;
  readonly questions: readonly PublicQuestion[];
}

/** The steps to draw: one per question one at a time, else the given groups over the form's own questions. */
function resolve(
  questions: readonly PublicQuestion[],
  layout: HostedFormStepsLayout,
  steps: readonly FormStep[] | undefined,
): readonly ResolvedStep[] {
  if (layout === 'conversational') return questions.map((question) => ({ questions: [question] }));
  const placed = new Set<string>();
  const groups = (steps ?? []).flatMap((step) => {
    const own = questions.filter((question) => step.keys.includes(question.key) && !placed.has(question.key));
    own.forEach((question) => placed.add(question.key));
    return own.length === 0 ? [] : [{ title: step.title, questions: own }];
  });
  const rest = questions.filter((question) => !placed.has(question.key));
  if (groups.length === 0) return [{ questions }];
  if (rest.length === 0) return groups;
  const last = groups[groups.length - 1];
  return [...groups.slice(0, -1), { title: last?.title, questions: [...(last?.questions ?? []), ...rest] }];
}

/**
 * The form a visitor fills in, a step at a time (spec 0023,
 * 0023-form-design.md, Form types): `steps` groups questions with a progress
 * line, Back and Continue, and checks each step before moving on;
 * `conversational` asks one question at a time, large, with Enter to go on.
 * Both share Classic's state, checker, thank you and foot. Drawn as library
 * stories only until the owner confirms the form's `layout` and `steps`.
 */
export function HostedFormSteps({
  form,
  mode,
  layout,
  steps,
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
  // Only the questions that show (spec 0043, AC-1614): a step whose questions are all hidden is skipped and not counted.
  const groups = resolve(
    form.questions.filter((question) => state.shown.has(question.key)),
    layout,
    steps,
  );
  // Send another starts again from the first step.
  if (state.round !== round) {
    setRound(state.round);
    setIndex(0);
    setMoved(false);
    setFocusesStep(false);
  }
  const step = groups[Math.min(index, groups.length - 1)] ?? { questions: [] };
  const isLast = index >= groups.length - 1;
  const first = step.questions[0];

  // A step reached by Continue or Back puts focus on its first question.
  useEffect(() => {
    if (!focusesStep || first === undefined) return;
    state.focus(first.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the step changes
  }, [index]);

  const go = (next: number) => {
    setMoved(true);
    setFocusesStep(true);
    setIndex(next);
  };
  const place =
    layout === 'conversational' ? words.questionOf(index + 1, groups.length) : words.stepOf(index + 1, groups.length);
  const isOpen = layout === 'conversational';
  // A step's title names its questions: a heading a level under the form's.
  const StepTitle = mode === 'page' ? 'h2' : 'h3';

  let body;
  if (state.isClosed) body = <FormClosed state={state} mode={mode} heading={refs.heading} />;
  else if (state.view.kind === 'booking') {
    body = (
      <FormBooking
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
          // One at a time, Enter on a choice goes on too (AC-1034); a browser submits only from a text field.
          onKeyDown={(event) => {
            if (
              isOpen &&
              event.key === 'Enter' &&
              event.target instanceof HTMLInputElement &&
              event.target.type === 'radio'
            ) {
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
                  onChange={(value) => state.change(question, value)}
                  files={state.files}
                  isLabelHidden={isOpen}
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
