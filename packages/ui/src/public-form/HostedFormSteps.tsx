import type { FormStrings, PublicQuestion } from '@crm/contracts/forms';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { Icon } from '../atoms/Icon/Icon.tsx';
import { Kbd } from '../atoms/Kbd/Kbd.tsx';
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
import { FinishLater } from './FinishLater.tsx';
import type { HostedFormProps } from './HostedForm.tsx';
import styles from './HostedFormSteps.module.css';
import { BookingView, useLoadedBooking } from './BookingView.tsx';
import { asideOf, labelOf, Question } from './Question.tsx';
import { SentAnswers } from './SentAnswers.tsx';
import { useHostedForm } from './use-hosted-form.ts';

/** Props for HostedFormSteps: Classic's; the layout and the steps come with the form. */
export interface HostedFormStepsProps extends HostedFormProps {
  /**
   * In the builder's preview, which step (or question, one at a time) shows: the one being edited beside it, since
   * the inert preview can't be stepped through. Clamped to the steps there are; ignored outside the preview. Left
   * out, a one at a time preview shows its welcome screen.
   */
  readonly previewStep?: number;
}

/** The step layouts this component draws. */
type StepsLayout = 'steps' | 'conversational';

/** True for a question whose control goes on with Enter (one line of text, a choice, or one at a time a long answer). */
function takesEnter(question: PublicQuestion | undefined): boolean {
  return (
    question !== undefined &&
    ['short_text', 'long_text', 'email', 'phone', 'website', 'number', 'choice', 'yes_no', 'rating', 'scale'].includes(
      question.answerType,
    )
  );
}

/**
 * How long a one at a time choice stays on screen once picked before the next question comes (AC-6305): long
 * enough to see the pick land, short enough not to wait on. None under reduced motion.
 */
const ADVANCE_PAUSE_MS = 400;

/**
 * Whether a key press asks for the step before (T23): the up arrow in a one line text field, Typeform's way. Never
 * from a button, a list, a choice group or a long answer, which use the arrows themselves, and never Tab, which
 * keeps moving focus as it always does.
 */
function backByKey(event: KeyboardEvent<HTMLFormElement>): boolean {
  const target = event.target;
  if (event.key !== 'ArrowUp' || event.altKey || event.metaKey || event.shiftKey) return false;
  if (!(target instanceof HTMLInputElement)) return false;
  const isLine = ['text', 'email', 'tel', 'url', 'number', 'search'].includes(target.type);
  const inList = target.closest('[role="listbox"], [role="combobox"], [role="grid"]') !== null;
  return isLine && !inList && target.getAttribute('aria-expanded') !== 'true';
}

/**
 * The leaving step, animated out (T23): a still, inert copy of `form` laid over its place, sliding a little the way
 * the visitor goes and fading, then removed. A copy, so the real step changes at once and nothing waits on the
 * animation; ids, label links and question marks are taken off it so it never doubles a field. Nothing happens without the Web
 * Animations API.
 */
function leaveFrom(form: HTMLElement | null, way: 'forward' | 'back'): void {
  const parent = form?.parentElement;
  if (form === null || parent === null || parent === undefined || typeof form.animate !== 'function') return;
  const ghost = form.cloneNode(true);
  if (!(ghost instanceof HTMLElement)) return;
  for (const each of [ghost, ...ghost.querySelectorAll('[id], [for], [data-question]')]) {
    each.removeAttribute('id');
    each.removeAttribute('for');
    // A question's mark is how focus finds it: the copy must never be found instead of the real one.
    each.removeAttribute('data-question');
  }
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  const box = form.getBoundingClientRect();
  const frame = parent.getBoundingClientRect();
  Object.assign(ghost.style, {
    position: 'absolute',
    insetBlockStart: `${String(box.top - frame.top + parent.scrollTop)}px`,
    insetInlineStart: `${String(box.left - frame.left)}px`,
    inlineSize: `${String(box.width)}px`,
    margin: '0',
    pointerEvents: 'none',
  });
  parent.insertBefore(ghost, form);
  const tokens = getComputedStyle(form);
  const distance = tokens.getPropertyValue('--space-8').trim() || '0px';
  const duration = Number.parseFloat(tokens.getPropertyValue('--duration-exit')) || 0;
  const remove = () => {
    ghost.remove();
  };
  // Whichever comes first: the exit finishing, or its own length passing (a paused animation never strands it).
  globalThis.setTimeout(remove, duration * 2);
  ghost
    .animate(
      prefersStill()
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: `translateY(${way === 'back' ? distance : `calc(-1 * ${distance})`})` },
          ],
      { duration, easing: tokens.getPropertyValue('--ease-out').trim() || 'ease-out', fill: 'forwards' },
    )
    .finished.then(remove, remove);
}

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
  onCount,
  onSave,
  onEmailResume,
  resumedStepId,
  now = Date.now,
  logo = TIMEFIX_LOGO,
  previewStep,
  brand,
}: HostedFormStepsProps) {
  // A resumed fill opens on the step it was left on (AC-6319), found by id among the steps this path shows.
  // A step the answers have since taken away, or an id from an older version, leaves them at the first step.
  const [shownIndex, setIndex] = useState(0);
  // Which way the visitor last moved (T23): the next step rises in, Back comes down; none before the first move.
  const [moved, setMoved] = useState<'forward' | 'back' | undefined>(undefined);
  const hasMoved = moved !== undefined;
  // Continue and Back focus the new step's first question; a refusal that goes back focuses its problem instead.
  const [focusesStep, setFocusesStep] = useState(false);
  const [round, setRound] = useState(0);
  // One at a time, the pointer picks on the question showing (each restarts the pause before going on).
  const [picks, setPicks] = useState(0);
  const loadedBooking = useLoadedBooking();
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
  // One at a time opens on a welcome screen (T42, Typeform's way): the headline, its line and Start, so the
  // questions never repeat the headline. Not for a fill being resumed, which goes straight back to its question, and
  // in the builder's preview only while no question is being edited.
  const [isWelcome, setWelcome] = useState(
    layout === 'conversational' && form.headline.trim() !== '' && resumedStepId === undefined,
  );
  const welcomeRef = useRef<HTMLDivElement>(null);
  const byKey = new Map(form.questions.map((question) => [question.key, question]));
  // A hidden question has nothing to draw (spec 0063), so a step of hidden questions alone is no step to show.
  const groups = state.path.steps.flatMap((shown) => {
    const questions = shown.keys.flatMap((key) => {
      const question = byKey.get(key);
      return question === undefined || question.answerType === 'hidden' ? [] : [question];
    });
    // The step's own id travels with it, so a save can say which step to reopen on (AC-6319).
    return questions.length === 0 ? [] : [{ id: shown.id, title: shown.title, questions }];
  });
  // Send another starts again from the first step.
  if (state.round !== round) {
    setRound(state.round);
    setIndex(0);
    setWelcome(layout === 'conversational' && form.headline.trim() !== '');
    setMoved(undefined);
    setFocusesStep(false);
    setPicks(0);
  }
  // The step on screen: the one reached, kept within the steps the path has now (an answer can take some away), or
  // in the builder's preview the one being edited.
  // Only before the visitor has moved: once they press Continue or Back, where they are is theirs.
  const [hasResumed, setResumed] = useState(resumedStepId === undefined);
  if (!hasResumed && groups.length > 0) {
    setResumed(true);
    const at = groups.findIndex((group) => group.id === resumedStepId);
    if (at > 0) setIndex(at);
  }
  const index = Math.max(0, Math.min(mode === 'preview' ? (previewStep ?? 0) : shownIndex, groups.length - 1));
  const welcomes = isWelcome && (mode !== 'preview' || previewStep === undefined);
  const step = groups[index] ?? { id: undefined, title: undefined, questions: [] };
  const isLast = index >= groups.length - 1;
  const first = step.questions[0];

  // Only the step on screen is reached (AC-6321): the steps behind it were, the steps ahead have not been, and
  // that difference is the whole of the drop off bar on a stepped form.
  useEffect(() => {
    if (state.view.kind === 'form' && !state.isClosed && !welcomes) {
      state.reached(step.questions.filter((question) => question.answerType !== 'hidden').map((q) => q.id));
    }
  });

  // A step reached by Continue or Back puts focus on its first question.
  useEffect(() => {
    if (!focusesStep || first === undefined || welcomes) return;
    state.focus(first.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the step changes
  }, [index, welcomes]);

  const start = () => {
    leaveFrom(welcomeRef.current, 'forward');
    setMoved('forward');
    setFocusesStep(true);
    setWelcome(false);
  };
  // The welcome screen goes on with Enter wherever focus is (Typeform's way), as its hint says.
  useEffect(() => {
    if (!welcomes || preview || state.view.kind !== 'form' || state.isClosed) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select') !== null) {
        return;
      }
      event.preventDefault();
      start();
    };
    globalThis.addEventListener('keydown', onKey);
    return () => {
      globalThis.removeEventListener('keydown', onKey);
    };
  });

  const go = (next: number) => {
    setPicks(0);
    // The step on screen leaves the way the visitor is going (up on, down back) while the next one comes in
    // (T23, Typeform): a still copy of it is laid where it was and animated out through the Web Animations API,
    // on the motion tokens, so the move itself is never held up by it. Under reduced motion it fades only.
    leaveFrom(formRef.current, next < index ? 'back' : 'forward');
    setMoved(next < index ? 'back' : 'forward');
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
    // Read after the pick has redrawn the path: a choice that leaves nothing after it makes this the last question.
    if (picks === 0 || isLast) return undefined;
    const timer = window.setTimeout(
      () => {
        formRef.current?.requestSubmit();
      },
      // The beat is time to see the pick land and change it, not motion: it stays under reduced motion too.
      ADVANCE_PAUSE_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new pick starts the pause; nothing else does
  }, [picks]);
  // A jump still ahead changes how many steps are left, so there is no total to promise yet (AC-6304). Saying
  // "Step 1 of 3" and then giving them two is worse than saying "Step 1" and counting up: a total that moves
  // under someone is a promise broken, where a number without one was never a promise made.
  //
  // Steps *after* this one, not this one: a jump on the step they are reading has already been decided by the
  // answers they have given, which is what the path shown is. Once nothing ahead can jump, the count is certain
  // and the total comes back — which is why the last step always carries one.
  const ahead = new Set(groups.slice(index + 1).flatMap((group) => (group.id === undefined ? [] : [group.id])));
  const isCertain =
    layout === 'conversational'
      ? !groups.slice(index + 1).some((group) => group.questions.some((question) => (question.jumps?.length ?? 0) > 0))
      : !(form.steps ?? []).some(
          (step) => step.id !== undefined && ahead.has(step.id) && (step.jumps?.length ?? 0) > 0,
        );
  // Always "Step 2 of 3" (critique c): while a jump ahead may still skip some, the total is the longest the path
  // can be, every step that has something to show, so it only ever shrinks towards the end, never grows.
  const longest =
    layout === 'conversational'
      ? form.questions.filter((question) => question.answerType !== 'hidden').length
      : (form.steps ?? []).filter((each) => each.keys.some((key) => byKey.get(key)?.answerType !== 'hidden')).length;
  const total = isCertain ? groups.length : Math.max(groups.length, longest);
  const place = layout === 'conversational' ? words.questionOf(index + 1, total) : words.stepOf(index + 1, total);
  const isOpen = layout === 'conversational';
  // A step's title names its questions: a heading a level under the form's.
  const StepTitle = mode === 'page' ? 'h2' : 'h3';

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
  else if (welcomes) {
    // The welcome screen (T42): the headline and its line, then Start with Enter beside it.
    body = (
      <div ref={welcomeRef} className={styles.welcome} data-enter={moved}>
        <FormHeader form={form} mode={mode} heading={refs.heading} />
        <div className={styles.buttons} data-layout={layout}>
          {/* Focus starts here on the form's own page (T42), so Enter is the first key that works; never in a site,
              where it would scroll the visitor's page to the form. */}
          <Button variant="primary" size="lg" onPress={start} autoFocus={mode === 'page'}>
            {words.start}
          </Button>
          <EnterHint words={words} />
        </div>
      </div>
    );
  } else {
    body = (
      <>
        {isOpen && groups.length > 0 ? (
          <div className={styles.line} data-mode={mode}>
            <ProgressBar label={place} valueLabel={place} value={index + 1} maxValue={total} isLabelHidden />
          </div>
        ) : null}
        {!isOpen ? (
          <FormHeader form={form} mode={mode} heading={refs.heading} isSubheadingShown={index === 0} />
        ) : (
          // One at a time the welcome screen showed the headline: each question keeps it for screen readers only.
          <VisuallyHidden>
            <FormHeader form={form} mode={mode} heading={refs.heading} isSubheadingShown={false} />
          </VisuallyHidden>
        )}
        {/* One step is no progress to show: only its title, when it has one. */}
        {!isOpen && (groups.length > 1 || step.title !== undefined) && (
          <div className={styles.progress}>
            {groups.length > 1 && <ProgressBar label={place} valueLabel={place} value={index + 1} maxValue={total} />}
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
          data-enter={moved}
          // Capture: a control's press handling keeps these from bubbling.
          onPointerDownCapture={() => {
            byPointer.current = true;
          }}
          onKeyDownCapture={(event) => {
            // A letter key picks a lettered choice as a press does (T42), so it goes on by itself the same way.
            byPointer.current =
              /^[a-z]$/i.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey && !preview;
          }}
          onKeyDown={(event) => {
            // Back by key (T23, Typeform): the up arrow from a one line text field goes to the step before.
            if (index > 0 && !preview && backByKey(event)) {
              event.preventDefault();
              go(index - 1);
              return;
            }
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
              if (state.checkStep(step.questions)) {
                // Continue is the moment to keep the fill (AC-6319): the step passed its check, so what is
                // kept is answers the server would accept, and the link reopens on the step they move to.
                go(index + 1);
                state.keepNow(groups[index + 1]?.id);
              }
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
                    <span className={styles.number}>
                      {String(index + 1)}
                      <Icon name="arrow-right" size="xs" />
                    </span>
                    <span>
                      {labelOf(question, words, state.read)}
                      {/* "(optional)" small and quiet after the words, never wrapping at the question's size (T42). */}
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
                  read={state.read}
                  onChange={(value) => {
                    state.change(question, value);
                    if (
                      isOpen &&
                      !preview &&
                      ['choice', 'yes_no', 'rating', 'scale'].includes(question.answerType) &&
                      byPointer.current &&
                      !isLast
                    ) {
                      setPicks((count) => count + 1);
                    }
                  }}
                  files={state.files}
                  isLabelHidden={isOpen}
                  isUnderlined={isOpen}
                  hint={isOpen && question.answerType === 'long_text' ? words.newLine : undefined}
                />
              </QuestionSlot>
            );
          })}
          {isLast && <FormTrap form={form} state={state} />}
          <div className={styles.actions} data-layout={layout}>
            {!isOpen && <ErrorSummary state={state} among={step.questions} />}
            <FormAlert state={state} />
            <div className={styles.buttons} data-layout={layout}>
              {/* One at a time, the way back is the quiet up arrow at the foot (T42); Steps keep Back here. */}
              {index > 0 && !isOpen && (
                <Button variant="ghost" size="lg" icon="arrow-left" onPress={() => go(index - 1)}>
                  {words.back}
                </Button>
              )}
              <Button
                variant="primary"
                size="lg"
                type={preview ? 'button' : 'submit'}
                {...(isOpen ? (isLast ? {} : { iconRight: 'check' as const }) : { isFullWidth: 'center' as const })}
              >
                {state.isSending ? words.sending : isLast ? form.buttonText : isOpen ? words.ok : words.next}
              </Button>
              {isOpen && takesEnter(first) && <EnterHint words={words} />}
            </div>
            <FinishLater state={state} language={form.language} stepId={step.id} />
          </div>
        </form>
        {/* One at a time's arrows and place (T42, Typeform's way): up to the question before, down on to the next
            (through the same check as OK), and "2 of 6"; at the window's foot on a page, under the form elsewhere. */}
        {isOpen && groups.length > 1 && (
          <nav className={styles.nav} data-mode={mode} aria-label={place}>
            <span className={styles.place} aria-hidden="true">
              {words.questionOf(index + 1, total)}
            </span>
            <Button
              icon="chevron-up"
              label={words.previousQuestion}
              isDisabled={index === 0 || preview}
              onPress={() => go(index - 1)}
            />
            <Button
              icon="chevron-down"
              label={words.nextQuestion}
              isDisabled={isLast || preview}
              onPress={() => formRef.current?.requestSubmit()}
            />
          </nav>
        )}
      </>
    );
  }
  return (
    <FormFrame
      form={form}
      mode={mode}
      kind={isOpen ? 'open' : 'card'}
      {...(brand === undefined ? {} : { brand })}
      container={refs.container}
      {...(preview ? { previewNote: words.previewNote } : {})}
      foot={<FormFoot form={form} mode={mode} logo={logo} state={state} />}
    >
      {body}
    </FormFrame>
  );
}

/** "press Enter ↵" beside Start and OK (T42): only where a keyboard is (its CSS hides it under a finger). */
function EnterHint({ words }: { readonly words: Pick<FormStrings, 'pressEnter' | 'enterKey'> }) {
  return (
    <span className={styles.enter} aria-hidden="true">
      {words.pressEnter} <Kbd tone="soft">{words.enterKey}</Kbd>
    </span>
  );
}
