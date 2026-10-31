import { useId, type ReactNode } from 'react';
import { ToggleButtonGroup, type Key } from 'react-aria-components';
import { ToggleButton } from '../../atoms/Button/Button.tsx';
import { FieldLabel } from '../../atoms/FieldLabel/FieldLabel.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import styles from './ChoiceChips.module.css';

/** One choice. */
export interface ChoiceChip {
  readonly id: string;
  readonly label: string;
}

/** Props for ChoiceChips. */
export interface ChoiceChipsProps {
  /** The group's label, shown above the chips. */
  readonly label: string;
  readonly choices: readonly ChoiceChip[];
  readonly selected: readonly string[];
  readonly onChange: (selected: readonly string[]) => void;
  /** Allow one choice only (Duration on a page that offers one length). Default: several. */
  readonly isSingle?: boolean;
  /** Said under the chips. */
  readonly error?: string;
  readonly isDisabled?: boolean;
  /**
   * A control after the last chip, in the same row and outside the group (a booking page's "+ Custom" length,
   * which opens a Popover): it adds a choice rather than being one.
   */
  readonly end?: ReactNode;
  /**
   * What the first and last chips mean, under the row at its two ends ("Not likely", "Very likely"): a hosted form's
   * Scale (spec 0063). The group is described by them, so a screen reader hears them with the choices.
   */
  readonly ends?: { readonly start?: string | undefined; readonly end?: string | undefined };
  /** Keeps the label for screen readers only, where a larger heading above shows it (one at a time). */
  readonly isLabelHidden?: boolean;
  /** After the label, quieter: a hosted form's "(optional)". Part of the group's name. */
  readonly labelAside?: string | undefined;
  /** `strong` for a form's question, as a radio group's question reads (a hosted form's Scale and Multi select). */
  readonly tone?: 'label' | 'strong';
}

/**
 * A labelled row of chips for choosing one or several short options
 * (a booking page's durations, spec 0025 experience): library ToggleButtons
 * in a group, held ones pressed, arrows move between them, Space toggles one.
 */
export function ChoiceChips({
  label,
  choices,
  selected,
  onChange,
  isSingle = false,
  error,
  isDisabled = false,
  end,
  ends,
  isLabelHidden = false,
  labelAside,
  tone = 'label',
}: ChoiceChipsProps) {
  const labelId = useId();
  const errorId = useId();
  const endsId = useId();
  const hasEnds = ends !== undefined && (ends.start !== undefined || ends.end !== undefined);
  const describedBy = [...(hasEnds ? [endsId] : []), ...(error === undefined ? [] : [errorId])].join(' ');
  return (
    <div className={styles.root} data-disabled={isDisabled || undefined}>
      {isLabelHidden ? (
        <VisuallyHidden>
          <span id={labelId}>{labelAside === undefined ? label : `${label} ${labelAside}`}</span>
        </VisuallyHidden>
      ) : tone === 'strong' ? (
        // A form's question: the label row every question has, with its aside.
        <FieldLabel as="text" id={labelId} label={label} aside={labelAside} tone="strong" />
      ) : (
        <span id={labelId} className={styles.label}>
          {label}
          {labelAside === undefined ? null : ` ${labelAside}`}
        </span>
      )}
      <div className={styles.row}>
        <ToggleButtonGroup
          className={styles.chips}
          aria-labelledby={labelId}
          {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
          selectionMode={isSingle ? 'single' : 'multiple'}
          selectedKeys={selected}
          isDisabled={isDisabled}
          onSelectionChange={(keys: Set<Key>) => {
            const ids = new Set([...keys].map(String));
            onChange(choices.filter((choice) => ids.has(choice.id)).map((choice) => choice.id));
          }}
        >
          {choices.map((choice) => (
            <ToggleButton key={choice.id} id={choice.id}>
              {choice.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {end}
      </div>
      {hasEnds && (
        <p id={endsId} className={styles.ends}>
          <span>{ends.start}</span>
          <span>{ends.end}</span>
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
