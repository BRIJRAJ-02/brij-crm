import { useSyncExternalStore } from 'react';
import { useFocusVisible } from 'react-aria';
import { RadioButton, RadioField, RadioGroup, SelectionIndicator } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { ThemeChoice, ThemeController } from '../../theme/theme.ts';
import styles from './SegmentedControl.module.css';
import { strings } from './strings.ts';

/** One segment. */
export interface Segment {
  readonly value: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Shows the icon alone; the label stays its name. */
  readonly isIconOnly?: boolean;
}

/** Props for SegmentedControl. */
export interface SegmentedControlProps {
  /** What it switches ("View"). Read by screen readers. */
  readonly label: string;
  /** Two to four segments. */
  readonly segments: readonly Segment[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onChange?: (value: string) => void;
  readonly isDisabled?: boolean;
  /**
   * `horizontal` (the default) puts the segments in a row; `vertical` stacks
   * them, for a column too narrow for the row: icon only segments in the
   * folded sidebar's rail. The arrow keys move either way.
   */
  readonly orientation?: SegmentOrientation;
}

/** Which way the segments run. */
export type SegmentOrientation = 'horizontal' | 'vertical';

/**
 * Two to four equal segments that switch how you see something: Table or
 * Board, Week or Month. A radio group underneath, so the arrow keys move. The
 * thumb slides for a pointer and jumps for the keyboard.
 */
export function SegmentedControl({
  label,
  segments,
  value,
  defaultValue,
  onChange,
  isDisabled = false,
  orientation = 'horizontal',
}: SegmentedControlProps) {
  const { isFocusVisible } = useFocusVisible();
  return (
    <RadioGroup
      className={styles.root}
      aria-label={label}
      orientation={orientation}
      data-orientation={orientation}
      isDisabled={isDisabled}
      data-instant={isFocusVisible || undefined}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(onChange === undefined ? {} : { onChange })}
    >
      {segments.map((segment) => (
        <RadioField key={segment.value} value={segment.value} className={styles.field}>
          <RadioButton className={styles.segment}>
            <SelectionIndicator className={styles.thumb} />
            {segment.icon !== undefined && (
              <span className={styles.icon}>
                <Icon name={segment.icon} size="sm" />
              </span>
            )}
            {segment.isIconOnly === true ? (
              <VisuallyHidden>{segment.label}</VisuallyHidden>
            ) : (
              <span className={styles.label}>{segment.label}</span>
            )}
          </RadioButton>
        </RadioField>
      ))}
    </RadioGroup>
  );
}

/** Props for ThemeSwitch. */
export interface ThemeSwitchProps {
  /** The app's theme controller (`context.theme` in the router). */
  readonly controller: ThemeController;
  /** Icons only, for the sidebar footer. */
  readonly isCompact?: boolean;
  /**
   * `vertical` stacks the three segments, for the folded sidebar's rail,
   * where the row doesn't fit. Pair it with `isCompact`.
   */
  readonly orientation?: SegmentOrientation;
}

/** Light, Dark or System, in the sidebar footer. It reads and sets the app's theme controller, so every tab stays in step. */
export function ThemeSwitch({ controller, isCompact = false, orientation = 'horizontal' }: ThemeSwitchProps) {
  const choice = useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.get(),
  );
  const segments: readonly Segment[] = [
    { value: 'light', label: strings.light, icon: 'sun', isIconOnly: isCompact },
    { value: 'dark', label: strings.dark, icon: 'moon', isIconOnly: isCompact },
    { value: 'system', label: strings.system, icon: 'monitor', isIconOnly: isCompact },
  ];
  return (
    <SegmentedControl
      label={strings.theme}
      segments={segments}
      value={choice}
      orientation={orientation}
      onChange={(next) => {
        controller.set(next as ThemeChoice);
      }}
    />
  );
}
