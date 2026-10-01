import { SwitchButton, SwitchField, Text } from 'react-aria-components';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import styles from './Switch.module.css';

/** Props for Switch. */
export interface SwitchProps {
  /** What it turns on, in sentence case. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
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
      {...(isSelected === undefined ? {} : { isSelected })}
      {...(defaultSelected === undefined ? {} : { defaultSelected })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(name === undefined ? {} : { name })}
    >
      <SwitchButton className={styles.root}>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.knob} />
        </span>
        {isLabelHidden ? (
          <VisuallyHidden>{label}</VisuallyHidden>
        ) : (
          <span className={styles.label} data-described={description === undefined ? undefined : ''}>
            {label}
          </span>
        )}
      </SwitchButton>
      {description !== undefined && (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      )}
    </SwitchField>
  );
}
