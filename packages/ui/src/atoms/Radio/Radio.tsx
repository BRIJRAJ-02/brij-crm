import type { KeyboardEvent, ReactNode } from 'react';
import { FieldError, RadioButton, RadioField, RadioGroup as AriaRadioGroup, Text } from 'react-aria-components';
import { FieldLabel } from '../FieldLabel/FieldLabel.tsx';
import { Icon } from '../Icon/Icon.tsx';
import type { IconName } from '../Icon/icons.ts';
import styles from './Radio.module.css';

/** Props for Radio. */
export interface RadioProps {
  /** The value it picks. */
  readonly value: string;
  /** Its label. */
  readonly children: string;
  /** A line under the label that says more. */
  readonly description?: string;
  /** A glyph before the label, for a group drawn as cards (`variant="cards"`): what the choice adds. */
  readonly icon?: IconName;
  /**
   * What the choice holds, drawn under the label in a card (`variant="cards"`): a value through its field
   * display, as a merge's side shows it (spec 0049). Read as the choice's description, so it takes the place of
   * `description`. Draw it read only (a `preview` surface): the whole card picks the choice.
   */
  readonly preview?: ReactNode;
  readonly isDisabled?: boolean;
}

/** One choice in a RadioGroup. */
export function Radio({ value, children, description, icon, preview, isDisabled = false }: RadioProps) {
  // What sits under the label, read as its description: a card's value, else the line of words.
  const under = preview ?? description;
  return (
    <RadioField className={styles.field} value={value} isDisabled={isDisabled}>
      <RadioButton className={styles.radio}>
        <span className={styles.circle} aria-hidden="true">
          <span className={styles.dot} />
        </span>
        <span className={styles.label} data-described={under === undefined ? undefined : ''}>
          {icon !== undefined && <Icon name={icon} size="sm" />}
          {children}
        </span>
      </RadioButton>
      {under !== undefined && (
        <Text
          slot="description"
          elementType={preview === undefined ? 'span' : 'div'}
          className={preview === undefined ? styles.description : styles.preview}
        >
          {under}
        </Text>
      )}
    </RadioField>
  );
}

/** Props for RadioGroup. */
export interface RadioGroupProps {
  /** The question the choices answer. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** A quiet word after the label, such as "(optional)" on a public form: muted, and part of the group's name. */
  readonly labelAside?: string;
  /** An InfoTip beside the question, when the choices need a word of help ("Who can see it"). */
  readonly info?: ReactNode;
  /** The Radio choices. */
  readonly children: ReactNode;
  readonly value?: string | null;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  /** `vertical` (the default) stacks them; `horizontal` puts a few short ones in a row. */
  readonly orientation?: 'vertical' | 'horizontal';
  /**
   * `cards` draws each choice as a bordered card in a grid two wide, the chosen one on the accent's soft fill:
   * a handful of choices that each start a different job, where the choice itself is the first step of a form
   * (the link page's Add item). `letters` draws each choice full width with its letter (A, B, C) in a key before it,
   * the chosen one filling with the accent, and a letter key picks its choice while focus is in the group (a public
   * form, Typeform's way). `plain` (the default) is the usual stack.
   */
  readonly variant?: 'plain' | 'cards' | 'letters';
  readonly isDisabled?: boolean;
  readonly isReadOnly?: boolean;
  /** Why the choice is invalid, as a sentence that says how to fix it. */
  readonly error?: string;
  /** The `id` of the error line, so a control nearby can name it in `aria-describedby` (a submit it turns off). */
  readonly errorId?: string;
  readonly name?: string;
}

/** A letter key's place among the choices (A is 0), or -1 for any other key. */
function letterAt(event: KeyboardEvent): number {
  if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return -1;
  const code = event.key.toUpperCase().charCodeAt(0) - 65;
  return code >= 0 && code < 26 ? code : -1;
}

/** `letters`: a letter key picks its choice, as a press on it would, and focus follows it. */
function pickByLetter(event: KeyboardEvent<HTMLElement>) {
  const at = letterAt(event);
  const input = at === -1 ? undefined : event.currentTarget.querySelectorAll('input')[at];
  if (input === undefined || input.disabled) return;
  event.preventDefault();
  input.focus();
  input.click();
}

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Stops an arrow key pressed on the question's InfoTip from reaching the group, which would pick a choice. */
function keepArrows(event: KeyboardEvent) {
  if (ARROWS.has(event.key)) event.stopPropagation();
}

/** One of a few choices, all shown at once: a role, a plan, an export format. Arrow keys move between them. */
export function RadioGroup({
  label,
  isLabelHidden = false,
  labelAside,
  info,
  children,
  value,
  defaultValue,
  onChange,
  orientation = 'vertical',
  variant = 'plain',
  isDisabled = false,
  isReadOnly = false,
  error,
  errorId,
  name,
}: RadioGroupProps) {
  return (
    <AriaRadioGroup
      className={styles.group}
      orientation={orientation}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      isInvalid={error !== undefined}
      {...(isLabelHidden ? { 'aria-label': label } : {})}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(name === undefined ? {} : { name })}
    >
      {!isLabelHidden && (
        // The group moves and picks a choice on any arrow key inside it; on the tip (or in its help) they do nothing.
        <FieldLabel label={label} aside={labelAside} info={info} tone="strong" onInfoKeyDown={keepArrows} />
      )}
      <span
        className={styles.choices}
        data-orientation={orientation}
        data-variant={variant}
        {...(variant === 'letters' && !isReadOnly && !isDisabled ? { onKeyDown: pickByLetter } : {})}
      >
        {children}
      </span>
      {/* React Aria takes a given id over its own, and the group's aria-describedby follows it. */}
      <FieldError className={styles.error} {...(errorId === undefined ? {} : { id: errorId })}>
        {error}
      </FieldError>
    </AriaRadioGroup>
  );
}
