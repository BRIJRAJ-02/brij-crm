import { RadioButton, RadioField, RadioGroup } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { HUES, type Hue } from '../../hue.ts';
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
}

/** One of the nine hues, as named swatches: an option's colour, an object's tile. A radio group, so the arrow keys move. */
export function HuePicker({ label, value, defaultValue, onChange, isDisabled = false }: HuePickerProps) {
  return (
    <RadioGroup
      className={styles.root}
      aria-label={label}
      orientation="horizontal"
      isDisabled={isDisabled}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange: (next) => onChange(next as Hue) })}
    >
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
