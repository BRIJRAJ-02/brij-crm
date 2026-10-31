import { SwitchButton, SwitchField, Text } from 'react-aria-components';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './Switch.module.css';

/** Props for Switch. */
export interface SwitchProps {
  /** What it turns on, in sentence case. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /**
   * Words only screen readers hear after the label, where several switches share one ("on Work calendar"): each
   * row's "Check for conflicts" then names its own calendar.
   */
  readonly labelContext?: string;
  /**
   * The word shown in place of `label` while the switch is off, where the word is the state itself (a page Live or
   * Private). Only the eye gets it: the accessible name stays `label`, so a screen reader hears "Live, switch, off",
   * never "Private, switch, off". Drawn by CSS from a data attribute, so it costs Switch's first load next to nothing.
   */
  readonly offLabel?: string;
  /** A line under the label that says more. */
  readonly description?: string;
  readonly isSelected?: boolean;
  readonly defaultSelected?: boolean;
  readonly onChange?: (isSelected: boolean) => void;
  readonly isDisabled?: boolean;
  readonly isReadOnly?: boolean;
  readonly name?: string;
}

/** Turns a setting on or off at once, with no Save: notifications, a feature, a sync. */
export function Switch({
  label,
  isLabelHidden = false,
  labelContext,
  offLabel,
  description,
  isSelected,
  defaultSelected,
  onChange,
  isDisabled = false,
  isReadOnly = false,
  name,
}: SwitchProps) {
  return (
    <SwitchField
      className={styles.field}
      isDisabled={isDisabled}
      isReadOnly={isReadOnly}
      // With an off word showing, the name is set outright, so the generated word never joins it.
      aria-label={offLabel && label}
      {...(isSelected === undefined ? {} : { isSelected })}
      {...(defaultSelected === undefined ? {} : { defaultSelected })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(name === undefined ? {} : { name })}
    >
      <SwitchButton className={styles.root} data-label-hidden={isLabelHidden || undefined}>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.knob} />
        </span>
        {isLabelHidden ? (
          <VisuallyHidden>{label}</VisuallyHidden>
        ) : (
          <span
            className={styles.label}
            data-described={description === undefined ? undefined : ''}
            data-off={offLabel}
          >
            {label}
          </span>
        )}
        {labelContext !== undefined && <VisuallyHidden> {labelContext}</VisuallyHidden>}
      </SwitchButton>
      {description !== undefined && (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      )}
    </SwitchField>
  );
}
