import { LONG_ANSWER_MAX, SHORT_ANSWER_MAX, toE164, type FormStrings, type PublicQuestion } from '@crm/contracts/forms';
import { Checkbox } from '../atoms/Checkbox/Checkbox.tsx';
import { Rating } from '../atoms/Rating/Rating.tsx';
import { ChoiceChips } from '../molecules/ChoiceChips/ChoiceChips.tsx';
import { AddressQuestion, type AddressDraft } from './AddressQuestion.tsx';
import { Radio, RadioGroup } from '../atoms/Radio/Radio.tsx';
import { Switch } from '../atoms/Switch/Switch.tsx';
import { CountryPicker } from '../molecules/CountryPicker/CountryPicker.tsx';
import { Field } from '../molecules/Field/Field.tsx';
import { PhoneField, type PhoneFieldValue } from '../molecules/PhoneField/PhoneField.tsx';
import { SelectBase } from '../molecules/Select/Select.tsx';
import { lazy, Suspense } from 'react';
import { Skeleton } from '../atoms/Skeleton/Skeleton.tsx';
import { isUploadedFile, type HostedFileHandlers } from './files.ts';

// The file question loads on its own: its drop area brings React Aria's drag and drop code, about 24 kB gzipped,
// which no form without a file question ever needs and which took the hosted form's first load past its budget
// when it arrived (26 October 2026). Until it lands a Skeleton of the same height stands in, so the form draws at
// once and keeps its shape.
const LazyFileQuestion = lazy(() => import('./FileQuestion.tsx').then((module) => ({ default: module.FileQuestion })));

/** The control of a question to type in, or else its first control (a dropdown's trigger): a phone's number before its code. */
export function focusQuestion(container: HTMLElement | null, key: string): void {
  const question = container?.querySelector(`[data-question="${CSS.escape(key)}"]`);
  const reachable = (selector: string) =>
    [...(question?.querySelectorAll<HTMLElement>(selector) ?? [])].find(
      (control) => control.closest('[aria-hidden="true"]') === null && control.tabIndex >= 0,
    );
  (reachable('input:not([type="hidden"]), textarea') ?? reachable('button'))?.focus();
}

/** A question's words: its label, or "Untitled question" while it has none. */
export function labelOf(question: PublicQuestion, words: FormStrings): string {
  return question.label.trim() === '' ? words.untitledQuestion : question.label;
}

/** "(optional)" after an optional question's label; a tick box or a yes or no is never marked, since blank is an answer. */
export function asideOf(question: PublicQuestion, words: FormStrings): string | undefined {
  const marked = question.required || question.answerType === 'checkbox' || question.answerType === 'yes_no';
  return marked ? undefined : words.optional;
}

/** What a drawn answer sends: a phone as E.164 with its country, a file as the id of its upload, the rest as held. */
export function answerOf(question: PublicQuestion, value: unknown): unknown {
  if (question.answerType === 'file') return isUploadedFile(value) ? { fileId: value.fileId } : undefined;
  if (question.answerType === 'phone') {
    const phone = value as PhoneFieldValue | undefined;
    if (phone === undefined || phone.national.trim() === '') return undefined;
    return { number: toE164(phone.country, phone.national), country: phone.country };
  }
  if (question.answerType === 'checkbox' || question.answerType === 'yes_no') return value === true;
  // A date and time is the moment the visitor's own clock reads it as, with their zone (spec 0063).
  if (question.answerType === 'datetime') {
    if (typeof value !== 'string' || value === '') return undefined;
    const moment = new Date(value);
    return Number.isNaN(moment.getTime())
      ? value
      : { at: moment.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
  if (question.answerType === 'rating' || question.answerType === 'scale' || question.answerType === 'multi_select') {
    return value;
  }
  if (question.answerType === 'address') return value;
  return value ?? '';
}

/** A multi select as the page holds it: the choices picked, and Other's words while Other is ticked. */
export interface MultiDraft {
  readonly picked: readonly string[];
  readonly other?: string;
}

/** The chip that stands for Other: never a choice's own words, which an id this shape can't be. */
const OTHER = '\u0000other';

/** What the browser may fill a short text question with, guessed from its key: a name, a company, a job title. */
function autoCompleteOf(key: string): string | undefined {
  const name = key.toLowerCase();
  if (name === 'name' || name === 'full_name' || name === 'your_name') return 'name';
  if (name === 'first_name') return 'given-name';
  if (name === 'last_name') return 'family-name';
  if (name === 'company' || name === 'company_name' || name === 'organisation' || name === 'organization')
    return 'organization';
  if (name === 'job_title' || name === 'title' || name === 'role') return 'organization-title';
  return undefined;
}

/** Props for Question. */
export interface QuestionProps {
  readonly question: PublicQuestion;
  readonly words: FormStrings;
  readonly value: unknown;
  readonly error: string | undefined;
  readonly countryGuess: string | undefined;
  readonly countryNames: ReadonlyMap<string, string>;
  readonly onChange: (value: unknown) => void;
  /** The page's file calls, for a file question; absent, the file question is drawn and disabled. */
  readonly files?: HostedFileHandlers | undefined;
  /** Keeps the label for screen readers only, when a larger heading above already shows it (one at a time). */
  readonly isLabelHidden?: boolean;
  /** A line under a long text answer: how to break a line where Enter goes on (one at a time, spec 0063). */
  readonly hint?: string | undefined;
}

/** One question, drawn with the library's control for its answer type. */
export function Question({
  question,
  words,
  value,
  error,
  countryGuess,
  countryNames,
  onChange,
  files,
  isLabelHidden = false,
  hint,
}: QuestionProps) {
  const label = labelOf(question, words);
  const aside = asideOf(question, words);
  // Hidden behind a larger heading, the name still says it is optional.
  const labelProps = isLabelHidden
    ? { label: aside === undefined ? label : `${label} ${aside}`, isLabelHidden: true }
    : { label, ...(aside === undefined ? {} : { labelAside: aside }) };
  const placeholder = question.placeholder;
  const errorProps = error === undefined ? {} : { error };
  const text = typeof value === 'string' ? value : '';
  switch (question.answerType) {
    case 'long_text':
      return (
        <Field
          {...labelProps}
          name={question.key}
          isMultiline
          value={text}
          onChange={onChange}
          maxLength={LONG_ANSWER_MAX}
          showCounter
          {...(placeholder === undefined ? {} : { placeholder })}
          {...(hint === undefined ? {} : { hint })}
          {...errorProps}
        />
      );
    case 'dropdown':
      return (
        <SelectBase
          {...labelProps}
          items={(question.choices ?? []).map((choice) => ({ id: choice, label: choice }))}
          placeholder={words.chooseOne}
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
          {...labelProps}
          value={code}
          onChange={(next) => onChange(next === null ? '' : (countryNames.get(next) ?? ''))}
          searchLabel={words.searchCountries}
          placeholder={words.chooseOne}
          {...(countryGuess === undefined ? {} : { guess: countryGuess })}
          {...errorProps}
        />
      );
    }
    case 'choice':
      return (
        <RadioGroup
          {...labelProps}
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
          {...labelProps}
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
    case 'date':
    case 'time':
    case 'datetime':
      return (
        <Field
          {...labelProps}
          name={question.key}
          value={text}
          onChange={onChange}
          temporal={{
            type: question.answerType === 'datetime' ? 'datetime-local' : question.answerType,
            min: question.answerType === 'date' ? question.options?.earliest : undefined,
            max: question.answerType === 'date' ? question.options?.latest : undefined,
          }}
          {...errorProps}
        />
      );
    case 'rating':
      return (
        <Rating
          label={label}
          value={typeof value === 'number' ? value : null}
          onChange={(next) => onChange(next ?? undefined)}
          field={{ aside, error, isLabelHidden }}
        />
      );
    case 'scale': {
      const from = question.options?.from ?? 0;
      const to = question.options?.to ?? 10;
      return (
        <ChoiceChips
          label={aside === undefined ? label : `${label} ${aside}`}
          isLabelHidden={isLabelHidden}
          isSingle
          choices={Array.from({ length: to - from + 1 }, (_, index) => ({
            id: String(from + index),
            label: String(from + index),
          }))}
          selected={typeof value === 'number' ? [String(value)] : []}
          onChange={(picked) => onChange(picked[0] === undefined ? undefined : Number(picked[0]))}
          ends={{ start: question.options?.lowLabel, end: question.options?.highLabel }}
          {...errorProps}
        />
      );
    }
    case 'multi_select': {
      const draft = (value as MultiDraft | undefined) ?? { picked: [] };
      const allowsOther = question.options?.other === true;
      return (
        <>
          <ChoiceChips
            label={aside === undefined ? label : `${label} ${aside}`}
            isLabelHidden={isLabelHidden}
            choices={[
              ...(question.choices ?? []).map((choice) => ({ id: choice, label: choice })),
              ...(allowsOther ? [{ id: OTHER, label: words.other }] : []),
            ]}
            selected={[...draft.picked, ...(draft.other === undefined ? [] : [OTHER])]}
            onChange={(picked) => {
              const choices = picked.filter((each) => each !== OTHER);
              const other = picked.includes(OTHER) ? (draft.other ?? '') : undefined;
              onChange({ picked: choices, ...(other === undefined ? {} : { other }) });
            }}
            // The problem shows once: under Other's box while it is open, else under the chips.
            {...(draft.other === undefined ? errorProps : {})}
          />
          {draft.other !== undefined && (
            <Field
              label={words.otherLabel}
              name={`${question.key}.other`}
              value={draft.other}
              maxLength={SHORT_ANSWER_MAX}
              onChange={(other) => onChange({ picked: draft.picked, other })}
              {...errorProps}
            />
          )}
        </>
      );
    }
    case 'address':
      return (
        <AddressQuestion
          questionKey={question.key}
          label={label}
          aside={aside}
          isLabelHidden={isLabelHidden}
          words={words}
          value={value as AddressDraft | undefined}
          error={error}
          countryGuess={countryGuess}
          onChange={onChange}
        />
      );
    // A hidden question has no control (AC-6307): the link, or its default, answers it.
    case 'hidden':
      return null;
    case 'file':
      return (
        <Suspense fallback={<Skeleton shape="block" />}>
          <LazyFileQuestion
            questionKey={question.key}
            label={isLabelHidden ? labelProps.label : aside === undefined ? label : `${label} ${aside}`}
            words={words}
            value={value}
            error={error}
            files={files}
            onChange={onChange}
          />
        </Suspense>
      );
    default: {
      const kind = question.answerType;
      const autoComplete =
        kind === 'email'
          ? 'email'
          : kind === 'website'
            ? 'url'
            : kind === 'short_text'
              ? autoCompleteOf(question.key)
              : undefined;
      return (
        <Field
          {...labelProps}
          name={question.key}
          value={text}
          onChange={onChange}
          type={kind === 'email' ? 'email' : kind === 'website' ? 'url' : 'text'}
          {...(kind === 'short_text' ? { maxLength: SHORT_ANSWER_MAX } : {})}
          {...(kind === 'number' ? { inputMode: 'decimal' as const } : {})}
          {...(kind === 'website' ? { inputMode: 'url' as const } : {})}
          {...(autoComplete === undefined ? {} : { autoComplete })}
          {...(placeholder === undefined ? {} : { placeholder })}
          {...errorProps}
        />
      );
    }
  }
}
