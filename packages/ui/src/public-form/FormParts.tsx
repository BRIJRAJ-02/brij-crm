import {
  HONEYPOT_IGNORE_ATTRIBUTES,
  HONEYPOT_INPUT_NAME,
  type FormLayout,
  type FormStrings,
  type PublicForm,
  type PublicQuestion,
} from '@crm/contracts/forms';
import type { ReactNode, Ref } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { Icon } from '../atoms/Icon/Icon.tsx';
import { Link } from '../atoms/Link/Link.tsx';
import { Skeleton } from '../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { poweredByHref } from '../lib/powered-by.ts';
import { Callout } from '../molecules/Callout/Callout.tsx';
import type { ProductLogo } from '../modules/AuthLayout/AuthLayout.tsx';
import styles from './FormParts.module.css';
import { labelOf } from './Question.tsx';
import type { HostedFormMode, HostedFormState } from './use-hosted-form.ts';

/** How a layout sits on its page: `card` (Classic and Steps) or `open` (one question at a time, no card). */
export type FormFrameKind = 'card' | 'open';

/**
 * The ground every form view stands on: the page or embed sizing, the card on
 * a tinted ground from the page breakpoint, and whatever foot follows it. The
 * look (`data-theme` for Colour, `data-corners` for Corners) is passed once a
 * form has arrived; while one is still loading it is left off, so the page
 * keeps the colours it painted with rather than guessing a look it may have
 * to take back.
 */
export function FormGround({
  mode,
  kind = 'card',
  look,
  isLoading = false,
  container,
  previewNote,
  foot,
  children,
}: {
  readonly mode: HostedFormMode;
  readonly kind?: FormFrameKind;
  readonly look?: PublicForm['look'];
  readonly isLoading?: boolean;
  readonly container?: Ref<HTMLDivElement>;
  /** Read to screen readers before an inert preview. */
  readonly previewNote?: string;
  readonly foot?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div ref={container}>
      {previewNote !== undefined && (
        <VisuallyHidden>
          <p>{previewNote}</p>
        </VisuallyHidden>
      )}
      <div
        className={styles.root}
        data-theme={look?.colour}
        data-corners={look?.corners}
        data-mode={mode}
        data-frame={kind}
        {...(isLoading ? { 'aria-busy': true } : {})}
        {...(mode === 'preview' ? { inert: true } : {})}
      >
        <div className={styles.card}>{children}</div>
        {foot}
      </div>
    </div>
  );
}

/**
 * The frame every layout draws in: the form's look as tokens (`data-theme`
 * for Colour, `data-corners` for Corners), the page or embed sizing, the card
 * on a tinted ground from the page breakpoint, and the Timefix mark under it.
 */
export function FormFrame({
  form,
  mode,
  kind = 'card',
  container,
  previewNote,
  foot,
  children,
}: {
  readonly form: PublicForm;
  readonly mode: HostedFormMode;
  readonly kind?: FormFrameKind;
  readonly container?: Ref<HTMLDivElement>;
  /** Read to screen readers before an inert preview. */
  readonly previewNote?: string;
  readonly foot?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <FormGround
      mode={mode}
      kind={kind}
      look={form.look}
      {...(container === undefined ? {} : { container })}
      {...(previewNote === undefined ? {} : { previewNote })}
      {...(foot === undefined ? {} : { foot })}
    >
      {children}
    </FormGround>
  );
}

/** The headline and the sub heading: an h1 on its own page, an h2 inside a site or the builder. */
export function FormHeader({
  form,
  mode,
  heading,
  isSubheadingShown = true,
}: {
  readonly form: PublicForm;
  readonly mode: HostedFormMode;
  readonly heading: Ref<HTMLHeadingElement>;
  readonly isSubheadingShown?: boolean;
}) {
  const Heading = mode === 'page' ? 'h1' : 'h2';
  return (
    <header className={styles.header}>
      <Heading ref={heading} tabIndex={-1} className={styles.headline} data-mode={mode}>
        {form.headline}
      </Heading>
      {isSubheadingShown && form.subheading !== undefined && <p className={styles.subheading}>{form.subheading}</p>}
    </header>
  );
}

/** The thank you, in the booking confirmation's shape: the green check, the heading, a muted line, then Send another. */
export function FormThanks({
  form,
  state,
  mode,
  heading,
}: {
  readonly form: PublicForm;
  readonly state: HostedFormState;
  readonly mode: HostedFormMode;
  readonly heading: Ref<HTMLHeadingElement>;
}) {
  const text = state.view.kind === 'thanks' ? state.view.text : '';
  return (
    <FormConfirmation
      mode={mode}
      heading={heading}
      title={state.words.thanksTitle}
      text={text !== '' ? text : asksForAddress(form) ? state.words.thanks : state.words.thanksNeutral}
    >
      <Button variant="ghost" onPress={state.sendAnother}>
        {state.words.sendAnother}
      </Button>
    </FormConfirmation>
  );
}

/**
 * A sent form's confirmation, shared by the thank you and the countdown to
 * book: the green check grown in once, the heading (focus lands there), a
 * muted line when there is one, then what may follow.
 */
export function FormConfirmation({
  mode,
  heading,
  title,
  text,
  children,
}: {
  readonly mode: HostedFormMode;
  readonly heading: Ref<HTMLHeadingElement>;
  readonly title: string;
  readonly text?: string;
  readonly children?: ReactNode;
}) {
  const Heading = mode === 'page' ? 'h1' : 'h2';
  return (
    <div className={styles.thanks}>
      <span className={styles.badge}>
        <Icon name="check" />
      </span>
      <Heading ref={heading} tabIndex={-1} className={styles.headline} data-mode={mode}>
        {title}
      </Heading>
      {text !== undefined && text !== '' && <p className={styles.subheading}>{text}</p>}
      {children !== undefined && <div className={styles.again}>{children}</div>}
    </div>
  );
}

/** True when the form asks for an email or a phone, so "at the address you gave" is true. */
function asksForAddress(form: PublicForm): boolean {
  return form.questions.some((question) => question.answerType === 'email' || question.answerType === 'phone');
}

/** A paused form's one line, in the headline's place. */
export function FormClosed({
  state,
  mode,
  heading,
}: {
  readonly state: HostedFormState;
  readonly mode: HostedFormMode;
  readonly heading: Ref<HTMLHeadingElement>;
}) {
  const Heading = mode === 'page' ? 'h1' : 'h2';
  return (
    <Heading ref={heading} tabIndex={-1} className={styles.headline} data-mode={mode}>
      {state.words.closed}
    </Heading>
  );
}

/**
 * One question's slot: what the checker reads focus leaving, the email typo
 * hint under it ("Did you mean ada@gmail.com?" with Use it), announced
 * politely as it appears.
 */
export function QuestionSlot({
  question,
  state,
  children,
}: {
  readonly question: PublicQuestion;
  readonly state: HostedFormState;
  readonly children: ReactNode;
}) {
  const hint = state.hints[question.key];
  return (
    <div
      data-question={question.key}
      id={`question-${question.key}`}
      className={styles.question}
      onBlur={(event) => state.blur(question, event)}
    >
      {children}
      {question.answerType === 'email' && (
        <div className={styles.suggestion} aria-live="polite">
          {hint !== undefined && (
            <>
              <span>{state.words.didYouMean(hint)}</span>
              <Button variant="ghost" onPress={() => state.takeHint(question)}>
                {state.words.useSuggestion}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Above the button after a submit that found problems: how many, then each
 * question's label as a link that focuses it (its message sits under it). Announced politely;
 * it shrinks as answers are fixed and leaves with the last.
 */
export function ErrorSummary({
  state,
  among,
}: {
  readonly state: HostedFormState;
  /** Only these questions (a step's); every question when left out. */
  readonly among?: readonly PublicQuestion[];
}) {
  const listed = among === undefined ? state.summary : state.summary.filter((question) => among.includes(question));
  const count = listed.length;
  if (count === 0) return null;
  // A status, not an alert: focus already went to the first problem, so this is said politely.
  return (
    <Callout tone="danger" isPolite title={state.words.needsALook(count)}>
      <span className={styles.summaryList}>
        {listed.map((question) => (
          <Link key={question.key} href={`#question-${question.key}`} onPress={() => state.focus(question.key)}>
            {labelOf(question, state.words)}
          </Link>
        ))}
      </span>
    </Callout>
  );
}

/** A failure that isn't about a question ("That did not go through…"), in one alert line. */
export function FormAlert({ state }: { readonly state: HostedFormState }) {
  return (
    <p className={styles.alert} role="alert">
      {state.alert}
    </p>
  );
}

/** The honeypot: a field people never see or reach, which bots fill. */
export function FormTrap({ form, state }: { readonly form: PublicForm; readonly state: HostedFormState }) {
  const id = `hf-${form.key}-${HONEYPOT_INPUT_NAME}`;
  return (
    <div aria-hidden="true">
      <VisuallyHidden>
        <label htmlFor={id}>{state.words.honeypot}</label>
        <input
          id={id}
          type="text"
          name={HONEYPOT_INPUT_NAME}
          tabIndex={-1}
          autoComplete="off"
          {...HONEYPOT_IGNORE_ATTRIBUTES}
          value={state.trap}
          onChange={(event) => state.setTrap(event.target.value)}
        />
      </VisuallyHidden>
    </div>
  );
}

/** The web app's own wordmark files (apps/web/public/brand). */
export const TIMEFIX_LOGO: ProductLogo = {
  light: '/brand/timefix-wordmark-light.png',
  dark: '/brand/timefix-wordmark-dark.png',
};

/** The quiet foot under every view: the captcha's notice when there is one, then the Timefix wordmark. */
export function FormFoot({
  form,
  mode,
  logo,
  state,
}: {
  readonly form: PublicForm;
  readonly mode: HostedFormMode;
  readonly logo: ProductLogo;
  readonly state: Pick<HostedFormState, 'words'>;
}) {
  return (
    <footer className={styles.foot}>
      {form.recaptchaSiteKey !== undefined && <p className={styles.notice}>{state.words.recaptchaNotice}</p>}
      <a
        className={styles.brand}
        href={poweredByHref('form')}
        rel="noopener noreferrer"
        {...(mode === 'embed' ? { target: '_blank' } : {})}
      >
        <img
          className={styles.wordmark}
          src={form.look.colour === 'dark' ? logo.dark : logo.light}
          alt={state.words.madeWith}
        />
      </a>
    </footer>
  );
}

/** A message in a form's place: not found, or a load that failed, in the form's frame. */
export function FormMessage({
  mode,
  title,
  text,
}: {
  readonly mode: HostedFormMode;
  readonly title: string;
  readonly text?: string;
}) {
  const Heading = mode === 'page' ? 'h1' : 'h2';
  return (
    <FormGround mode={mode}>
      <header className={styles.header}>
        <Heading className={styles.headline} data-mode={mode}>
          {title}
        </Heading>
        {text !== undefined && <p className={styles.subheading}>{text}</p>}
      </header>
    </FormGround>
  );
}

/** How many question places the loading form holds: a short form, the one most pages ask. */
const LOADING_QUESTIONS = 3;

/**
 * The form's shape while it is still being read: the same ground, the same
 * card, the headline's and sub heading's places, three questions' places and
 * the button's. It draws at once, so a visitor's first paint is the page
 * rather than a blank window, and it holds the layout the form will take, so
 * the words land in the places already set out for them. Given a step layout
 * (spec 0063, AC-6306), while that layout's own code loads, it draws that
 * layout's shape instead: the progress line and a step's questions over
 * Continue, or one question at a time with no card.
 */
export function FormLoading({
  mode,
  words,
  layout = 'classic',
}: {
  readonly mode: HostedFormMode;
  readonly words: FormStrings;
  readonly layout?: FormLayout | 'unknown';
}) {
  // Before the form is read its layout is unknown: the shape draws no card, which only Classic and Steps have, so a
  // One at a time form never loses one (spec 0063, AC-6306). Its colours follow the visitor's own light or dark
  // setting until the form's look arrives.
  const isOpen = layout === 'conversational' || layout === 'unknown';
  const questions =
    layout === 'classic' || layout === 'unknown' ? LOADING_QUESTIONS : isOpen ? 1 : LOADING_QUESTIONS - 1;
  return (
    <FormGround mode={mode} kind={isOpen ? 'open' : 'card'} isLoading>
      <VisuallyHidden>
        <p>{words.loading}</p>
      </VisuallyHidden>
      {layout === 'conversational' && (
        <div className={styles.loadingLine}>
          <Skeleton shape="line" width="full" />
        </div>
      )}
      <header className={styles.header}>
        <p className={styles.headline} data-mode={mode}>
          <Skeleton shape="text" width="long" />
        </p>
        <p className={styles.subheading}>
          <Skeleton shape="text" width="medium" />
        </p>
      </header>
      {layout === 'steps' && (
        <div className={styles.loadingProgress}>
          <Skeleton shape="text" width="short" />
          <Skeleton shape="line" width="full" />
        </div>
      )}
      <div className={styles.questions} data-layout={layout === 'unknown' ? 'classic' : layout}>
        {Array.from({ length: questions }, (_, index) => (
          <div key={index} className={styles.question}>
            <Skeleton shape="text" width={isOpen ? 'long' : 'short'} />
            <Skeleton shape="field" width="full" />
          </div>
        ))}
        <Skeleton shape="field" width={layout === 'steps' ? 'full' : 'short'} />
      </div>
    </FormGround>
  );
}
