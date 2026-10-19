import { useId } from 'react';
import { ToggleButtonGroup, type Key } from 'react-aria-components';
import { ToggleButton } from '../../atoms/Button/Button.tsx';
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
}: ChoiceChipsProps) {
  const labelId = useId();
  const errorId = useId();
  return (
    <div className={styles.root} data-disabled={isDisabled || undefined}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <ToggleButtonGroup
        className={styles.chips}
        aria-labelledby={labelId}
        {...(error === undefined ? {} : { 'aria-describedby': errorId })}
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
      {error !== undefined && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
