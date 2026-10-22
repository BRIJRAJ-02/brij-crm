import type { KeyboardEvent, ReactNode } from 'react';
import { Label } from 'react-aria-components';
import styles from './FieldLabel.module.css';

/** Props for FieldLabel. */
export interface FieldLabelProps {
  /** The field's name. */
  readonly label: string;
  /** A quieter note after it on the same line: "(optional)". */
  readonly aside?: string | undefined;
  /** Help beside it, an InfoTip; the row keeps the label's height. */
  readonly info?: ReactNode;
  /** `label` (the default) for a field's name, `strong` for a group's question (RadioGroup). */
  readonly tone?: 'label' | 'strong';
  /**
   * `label` (the default) is React Aria's Label, wired to the control by its context; `text` a plain span, for a
   * read only field with no control to name (a Select read only names its group with `aria-label`).
   */
  readonly as?: 'label' | 'text';
  /** Drawn faded with the not allowed cursor, as the disabled control under it. */
  readonly isDisabled?: boolean;
  /** An id for the name, so a group can be labelled by it (`aria-labelledby`), as FieldGroup does. */
  readonly id?: string;
  /** Keys pressed inside the help (a radio group keeps its arrows from moving the choice from there). */
  readonly onInfoKeyDown?: (event: KeyboardEvent<HTMLSpanElement>) => void;
}

/**
 * The one label row of every form control (Field, Select, RadioGroup): the name in text-secondary, an aside a
 * step quieter, and an InfoTip beside it. One place, so the three never drift (they were three copies).
 */
export function FieldLabel({
  label,
  aside,
  info,
  tone = 'label',
  as = 'label',
  isDisabled = false,
  id,
  onInfoKeyDown,
}: FieldLabelProps) {
  const text = (
    <>
      {label}
      {aside !== undefined && (
        <>
          {' '}
          <span className={styles.aside}>{aside}</span>
        </>
      )}
    </>
  );
  const name =
    as === 'label' ? (
      <Label
        className={styles.label}
        data-tone={tone}
        data-disabled={isDisabled || undefined}
        {...(id === undefined ? {} : { id })}
      >
        {text}
      </Label>
    ) : (
      <span
        className={styles.label}
        data-tone={tone}
        data-disabled={isDisabled || undefined}
        {...(id === undefined ? {} : { id })}
      >
        {text}
      </span>
    );
  if (info === undefined) return name;
  return (
    <span className={styles.row}>
      {name}
      <span
        className={styles.info}
        {...(onInfoKeyDown === undefined ? {} : { role: 'presentation', onKeyDown: onInfoKeyDown })}
      >
        {info}
      </span>
    </span>
  );
}
