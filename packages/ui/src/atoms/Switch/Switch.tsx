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
   * A small status word beside the switch while it is off ("Private"), where off has a name of its own. The label
   * stays the one name, so voice control says "click Live"; the word is the switch's description, so a screen reader
   * hears "Live, switch, off, Private". Drawn by CSS from a data attribute, so Switch's first load barely grows.
   */
  readonly offStatus?: string;
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
  offStatus,
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
      <SwitchButton className={styles.root} data-label-hidden={isLabelHidden || undefined}>
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
        {labelContext !== undefined && <VisuallyHidden> {labelContext}</VisuallyHidden>}
      </SwitchButton>
      {offStatus !== undefined && <Text slot="description" className={styles.status} data-status={offStatus} />}
      {description !== undefined && (
        <Text slot="description" className={styles.description}>
          {description}
        </Text>
      )}
    </SwitchField>
  );
}
