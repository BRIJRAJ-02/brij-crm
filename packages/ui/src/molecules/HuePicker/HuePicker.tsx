import { useState } from 'react';
import { Button as AriaButton, DialogTrigger, Label, RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { HUES, type Hue } from '../../hue.ts';
import { Popover } from '../Popover/Popover.tsx';
import styles from './HuePicker.module.css';
import { strings } from './strings.ts';

/** Props for HuePicker. */
export interface HuePickerProps {
  /** What the hue is for ("Option colour"). */
  readonly label: string;
  readonly value?: Hue;
  readonly defaultValue?: Hue;
  readonly onChange?: (hue: Hue) => void;
  readonly isDisabled?: boolean;
  /**
   * Shows `label` above the swatches, as a field's label, for a form that
   * stacks it with Fields (the new object dialog). Hidden by default, where a
   * popover or a row already says what the hue is for.
   */
  readonly isLabelShown?: boolean;
  /** Shows the hue chosen, reachable by keyboard, without letting it change (a member in settings). */
  readonly isReadOnly?: boolean;
  /**
   * One swatch in the hue chosen, which opens the nine in a popover and
   * closes it on a choice: a row that has no room for nine (an option in the
   * options editor). Named "<label>: <hue>".
   */
  readonly isCompact?: boolean;
}

/** One of the nine hues, as named swatches: an option's colour, an object's tile. A radio group, so the arrow keys move. */
export function HuePicker({
  label,
  value,
  defaultValue,
  onChange,
  isDisabled = false,
  isLabelShown = false,
  isReadOnly = false,
  isCompact = false,
}: HuePickerProps) {
  if (isCompact) {
    return (
      <HueButton
        label={label}
        hue={value ?? defaultValue ?? 'gray'}
        isDisabled={isDisabled}
        isReadOnly={isReadOnly}
        {...(onChange === undefined ? {} : { onChange })}
      />
    );
  }
  return (
    <RadioGroup
      className={styles.root}
      {...(isLabelShown ? { 'data-labelled': true } : { 'aria-label': label })}
      orientation="horizontal"
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange: (next) => onChange(next as Hue) })}
    >
      {isLabelShown && <Label className={styles.label}>{label}</Label>}
      {HUES.map((hue) => (
        <RadioField key={hue} value={hue} aria-label={strings[hue]} className={styles.field}>
          <Tooltip content={strings[hue]}>
            <RadioButton className={styles.swatch} data-hue={hue}>
              {({ isSelected }) => isSelected && <Icon name="check" size="xs" />}
            </RadioButton>
          </Tooltip>
        </RadioField>
      ))}
    </RadioGroup>
  );
}

/** The compact HuePicker: one swatch that opens the nine, closing on a choice. */
function HueButton({
  label,
  hue,
  onChange,
  isDisabled,
  isReadOnly,
}: {
  readonly label: string;
  readonly hue: Hue;
  readonly onChange?: (hue: Hue) => void;
  readonly isDisabled: boolean;
  readonly isReadOnly: boolean;
}) {
  const [isOpen, setOpen] = useState(false);
  const name = strings.chosen(label, strings[hue]);
  if (isReadOnly) {
    return (
      <span className={styles.swatch} data-hue={hue} data-compact="" data-static="" role="img" aria-label={name} />
    );
  }
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <AriaButton className={styles.swatch} data-hue={hue} data-compact="" aria-label={name} isDisabled={isDisabled} />
      <Popover label={label}>
        <HuePicker
          label={label}
          value={hue}
          onChange={(next) => {
            onChange?.(next);
            setOpen(false);
          }}
        />
      </Popover>
    </DialogTrigger>
  );
}
