import {
  checkAnswers,
  formStrings,
  HONEYPOT_KEY,
  toE164,
  type FormStrings,
  type PublicForm,
  type PublicQuestion,
  type SubmitNext,
} from '@crm/contracts/forms';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { Checkbox } from '../atoms/Checkbox/Checkbox.tsx';
import { Icon } from '../atoms/Icon/Icon.tsx';
import { Radio, RadioGroup } from '../atoms/Radio/Radio.tsx';
import { Switch } from '../atoms/Switch/Switch.tsx';
import { countriesIn } from '../lib/countries.ts';
import { CountryPicker } from '../molecules/CountryPicker/CountryPicker.tsx';
import { Field } from '../molecules/Field/Field.tsx';
import { PhoneField, type PhoneFieldValue } from '../molecules/PhoneField/PhoneField.tsx';
import { Select } from '../molecules/Select/Select.tsx';
import type { ProductLogo } from '../modules/AuthLayout/AuthLayout.tsx';
import styles from './HostedForm.module.css';

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

/** Props for HostedForm. */
export interface HostedFormProps {
  readonly form: PublicForm;
  readonly mode: HostedFormMode;
  /** The country picked first for phone and country questions (ISO alpha 2), guessed by the page. */
  readonly countryGuess?: string;
  /** Sends the answers. Without it the answers are checked and the thank you shows, but nothing is sent. */
  readonly onSubmit?: (submission: HostedSubmission) => Promise<HostedSubmitOutcome>;
  /** Goes to the form's web address after a submission, when it sends visitors on. */
  readonly onRedirect?: (url: string) => void;
  /** The clock, for the fill time (tests pass their own). */
  readonly now?: () => number;
  /** The Timefix wordmark under the form; the web app serves these two by default. */
  readonly logo?: ProductLogo;
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
    <div className={styles.root} data-mode={mode}>
      <div className={styles.card}>
        <header className={styles.header}>
          <Heading className={styles.headline}>{title}</Heading>
          {text !== undefined && <p className={styles.subheading}>{text}</p>}
        </header>
      </div>
    </div>
  );
}

/** The web app's own wordmark files (apps/web/public/brand). */
const TIMEFIX_LOGO: ProductLogo = {
  light: '/brand/timefix-wordmark-light.png',
  dark: '/brand/timefix-wordmark-dark.png',
};

type Answers = Readonly<Record<string, unknown>>;

/** The first control of a question that can take focus. */
function focusQuestion(container: HTMLElement | null, key: string): void {
  const question = container?.querySelector(`[data-question="${CSS.escape(key)}"]`);
  const controls = question?.querySelectorAll<HTMLElement>('input:not([type="hidden"]), textarea, button') ?? [];
  [...controls].find((control) => control.closest('[aria-hidden="true"]') === null && control.tabIndex >= 0)?.focus();
}

/** A question's label: its words, "optional" after an optional one, "Untitled question" while it has none. */
function labelOf(question: PublicQuestion, words: FormStrings): string {
  const named = question.label.trim() === '' ? words.untitledQuestion : question.label;
  const marked = question.required || question.answerType === 'checkbox' || question.answerType === 'yes_no';
  return marked ? named : `${named} ${words.optional}`;
}

/** One question, drawn with the library's control for its answer type. */
function Question({
  question,
  words,
  value,
  error,
  countryGuess,
  countryNames,
  onChange,
}: {
  readonly question: PublicQuestion;
  readonly words: FormStrings;
  readonly value: unknown;
  readonly error: string | undefined;
  readonly countryGuess: string | undefined;
  readonly countryNames: ReadonlyMap<string, string>;
  readonly onChange: (value: unknown) => void;
}) {
  const label = labelOf(question, words);
  const placeholder = question.placeholder;
  const errorProps = error === undefined ? {} : { error };
  const text = typeof value === 'string' ? value : '';
  switch (question.answerType) {
    case 'long_text':
      return (
        <Field
          label={label}
          name={question.key}
          isMultiline
          value={text}
          onChange={onChange}
          {...(placeholder === undefined ? {} : { placeholder })}
          {...errorProps}
        />
      );
    case 'dropdown':
      return (
        <Select
          label={label}
          items={(question.choices ?? []).map((choice) => ({ id: choice, label: choice }))}
          placeholder={question.required ? words.chooseOne : words.preferNot}
          value={text === '' ? null : text}
          onChange={(id) => onChange(id ?? '')}
          isClearable={!question.required}
          isSearchable={(question.choices ?? []).length > 10}
          {...errorProps}
        />
      );
    case 'country': {
      // The answer is the country's name, as people read it on a record; the picker holds its code.
      const code = [...countryNames].find(([, name]) => name === text)?.[0] ?? null;
      return (
        <CountryPicker
          label={label}
          value={code}
          onChange={(next) => onChange(next === null ? '' : (countryNames.get(next) ?? ''))}
          searchLabel={words.searchCountries}
          placeholder={question.required ? words.chooseOne : words.preferNot}
          {...(countryGuess === undefined ? {} : { guess: countryGuess })}
          {...errorProps}
        />
      );
    }
    case 'choice':
      return (
        <RadioGroup
          label={label}
          name={question.key}
          value={text === '' ? null : text}
          onChange={onChange}
          {...errorProps}
        >
          {(question.choices ?? []).map((choice) => (
            <Radio key={choice} value={choice}>
              {choice}
            </Radio>
          ))}
        </RadioGroup>
      );
    case 'checkbox':
      return (
        <Checkbox label={label} name={question.key} isSelected={value === true} onChange={onChange} {...errorProps} />
      );
    case 'yes_no':
      return (
        // The error is the switch's description, so a screen reader hears it with the switch.
        <Switch
          label={label}
          name={question.key}
          isSelected={value === true}
          onChange={onChange}
          {...(error === undefined ? {} : { description: error })}
        />
      );
    case 'phone': {
      const phone = (value as PhoneFieldValue | undefined) ?? { country: countryGuess ?? 'US', national: '' };
      return (
        <PhoneField
          label={label}
          name={question.key}
          value={phone}
          onChange={onChange}
          codeLabel={words.dialCode}
          searchLabel={words.searchCountries}
          {...(countryGuess === undefined ? {} : { guess: countryGuess })}
          {...(placeholder === undefined ? {} : { placeholder })}
          {...errorProps}
        />
      );
    }
    case 'file':
      return <Field label={label} name={question.key} placeholder={words.fileLater} isDisabled />;
    default: {
      const kind = question.answerType;
      return (
        <Field
          label={label}
          name={question.key}
          value={text}
          onChange={onChange}
          type={kind === 'email' ? 'email' : kind === 'website' ? 'url' : 'text'}
          {...(kind === 'number' ? { inputMode: 'decimal' as const } : {})}
          {...(kind === 'website' ? { inputMode: 'url' as const } : {})}
          {...(kind === 'email' ? { autoComplete: 'email' } : kind === 'website' ? { autoComplete: 'url' } : {})}
          {...(placeholder === undefined ? {} : { placeholder })}
          {...errorProps}
        />
      );
    }
  }
}

/** What a drawn answer sends: a phone as E.164 with its country, a file nothing yet, the rest as held. */
function answerOf(question: PublicQuestion, value: unknown): unknown {
  if (question.answerType === 'file') return undefined;
  if (question.answerType === 'phone') {
    const phone = value as PhoneFieldValue | undefined;
    if (phone === undefined || phone.national.trim() === '') return undefined;
    return { number: toE164(phone.country, phone.national), country: phone.country };
  }
  if (question.answerType === 'checkbox' || question.answerType === 'yes_no') return value === true;
  return value ?? '';
}

/** The quiet foot every view of a form ends with: the Timefix wordmark, and the captcha's notice when it has one. */
function Foot({
  form,
  mode,
  logo,
  words,
}: {
  readonly form: PublicForm;
  readonly mode: HostedFormMode;
  readonly logo: ProductLogo;
  readonly words: FormStrings;
}) {
  return (
    <footer className={styles.foot}>
      {form.recaptchaSiteKey !== undefined && <p className={styles.notice}>{words.recaptchaNotice}</p>}
      <a
        className={styles.brand}
        href="https://timefix.ai"
        rel="noopener noreferrer"
        {...(mode === 'embed' ? { target: '_blank' } : {})}
      >
        <img
          className={styles.wordmark}
          src={form.look.colour === 'dark' ? logo.dark : logo.light}
          alt={words.madeWith}
        />
      </a>
    </footer>
  );
}

/**
 * The form a visitor fills in (spec 0023, 0023-experience.md, The visitor),
 * drawn with the library's own controls, so the hosted page, the embed and
 * the builder's preview are one component tree and one input design. Every
 * word comes from `formStrings`, every check from `checkAnswers`, so the
 * visitor sees what the server would say. The caller sends the answers.
 */
export function HostedForm({
  form,
  mode,
  countryGuess,
  onSubmit,
  onRedirect,
  now = Date.now,
  logo = TIMEFIX_LOGO,
}: HostedFormProps) {
  const words = formStrings(form.language);
  const preview = mode === 'preview';
  const countryNames = useMemo(
    () => new Map(countriesIn(form.language).map((country) => [country.code, country.name])),
    [form.language],
  );
  const firstAnswers = (): Answers =>
    Object.fromEntries(
      form.questions.flatMap((question) =>
        question.answerType === 'country' && countryGuess !== undefined && countryNames.has(countryGuess)
          ? [[question.key, countryNames.get(countryGuess)]]
          : [],
      ),
    );
  const [answers, setAnswers] = useState<Answers>(firstAnswers);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [isChecking, setChecking] = useState(false);
  const [isSending, setSending] = useState(false);
  const [alert, setAlert] = useState('');
  const [trap, setTrap] = useState('');
  const [view, setView] = useState<
    { readonly kind: 'form' } | { readonly kind: 'thanks'; readonly text: string } | { readonly kind: 'closed' }
  >({ kind: 'form' });
  const [round, setRound] = useState(0);
  const [startedAt, setStartedAt] = useState(now);
  const [focus, setFocus] = useState<'headline' | 'thanks' | undefined>(undefined);
  const container = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const isClosed = form.status === 'paused' || view.kind === 'closed';

  useEffect(() => {
    if (focus !== undefined && !preview) heading.current?.focus();
  }, [focus, view, preview]);

  const sent = (question: PublicQuestion) => answerOf(question, answers[question.key]);
  const allAnswers = () => Object.fromEntries(form.questions.map((question) => [question.key, sent(question)]));
  const showErrors = (fields: Readonly<Record<string, string>>) => {
    setChecking(true);
    setErrors(fields);
    const first = form.questions.find((question) => fields[question.key] !== undefined);
    if (first !== undefined) globalThis.requestAnimationFrame(() => focusQuestion(container.current, first.key));
  };
  const change = (question: PublicQuestion, value: unknown) => {
    const next = { ...answers, [question.key]: value };
    setAnswers(next);
    if (!isChecking) return;
    const result = checkAnswers(
      form,
      Object.fromEntries(form.questions.map((each) => [each.key, answerOf(each, next[each.key])])),
    );
    setErrors(result.ok ? {} : result.fields);
  };
  const thank = (text: string) => {
    setView({ kind: 'thanks', text });
    setFocus('thanks');
  };

  const submit = () => {
    if (preview || isSending) return;
    setAlert('');
    const sending = allAnswers();
    const result = checkAnswers(form, sending);
    if (!result.ok) {
      showErrors(result.fields);
      return;
    }
    // A page with nowhere to send (a draft opened as a preview) checks the answers, then thanks.
    if (onSubmit === undefined) {
      thank(form.thanks ?? '');
      return;
    }
    setSending(true);
    void onSubmit({ answers: sending, trap, fillMs: Math.max(0, now() - startedAt), round }).then((outcome) => {
      setSending(false);
      switch (outcome.kind) {
        case 'done':
          if (outcome.next.kind === 'redirect') onRedirect?.(outcome.next.url);
          else thank(outcome.next.text);
          return;
        case 'invalid':
          showErrors(outcome.fields);
          return;
        case 'closed':
          setView({ kind: 'closed' });
          setFocus('headline');
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
    setAnswers(firstAnswers());
    setErrors({});
    setChecking(false);
    setTrap('');
    setStartedAt(now());
    setView({ kind: 'form' });
    setFocus('headline');
  };

  const Heading = mode === 'page' ? 'h1' : 'h2';
  let body: ReactNode;
  if (isClosed) {
    body = (
      <Heading ref={heading} tabIndex={-1} className={styles.headline}>
        {words.closed}
      </Heading>
    );
  } else if (view.kind === 'thanks') {
    // The same shape as the booking confirmation: the badge, the heading, a muted line, then the way on.
    body = (
      <div className={styles.thanks}>
        <span className={styles.badge}>
          <Icon name="check" />
        </span>
        <Heading ref={heading} tabIndex={-1} className={styles.headline}>
          {words.thanksTitle}
        </Heading>
        <p className={styles.text}>{view.text === '' ? words.thanks : view.text}</p>
        <Button variant="ghost" onPress={sendAnother}>
          {words.sendAnother}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <header className={styles.header}>
          <Heading ref={heading} tabIndex={-1} className={styles.headline}>
            {form.headline}
          </Heading>
          {form.subheading !== undefined && <p className={styles.subheading}>{form.subheading}</p>}
        </header>
        <form
          className={styles.form}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {form.questions.map((question) => (
            <div key={`${String(round)}-${question.key}`} data-question={question.key} className={styles.question}>
              <Question
                question={question}
                words={words}
                value={answers[question.key]}
                error={errors[question.key]}
                countryGuess={countryGuess}
                countryNames={countryNames}
                onChange={(value) => change(question, value)}
              />
            </div>
          ))}
          <div className={styles.trap} aria-hidden="true">
            <label htmlFor={`hf-${form.key}-${HONEYPOT_KEY}`}>{words.honeypot}</label>
            <input
              id={`hf-${form.key}-${HONEYPOT_KEY}`}
              type="text"
              name={HONEYPOT_KEY}
              tabIndex={-1}
              autoComplete="off"
              value={trap}
              onChange={(event) => setTrap(event.target.value)}
            />
          </div>
          <p className={styles.alert} role="alert">
            {alert}
          </p>
          <Button variant="primary" type={preview ? 'button' : 'submit'} isFullWidth="center" isDisabled={isSending}>
            {isSending ? words.sending : form.buttonText}
          </Button>
        </form>
      </>
    );
  }

  return (
    <div ref={container}>
      {preview && <p className={styles.hidden}>{words.previewNote}</p>}
      <div
        className={styles.root}
        data-theme={form.look.colour}
        data-corners={form.look.corners}
        data-mode={mode}
        {...(preview ? { inert: true } : {})}
      >
        <div className={styles.card}>
          {body}
          <Foot form={form} mode={mode} logo={logo} words={words} />
        </div>
      </div>
    </div>
  );
}
