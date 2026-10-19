import type { ReactNode, Ref } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Path } from '../../atoms/Path/Path.tsx';
import styles from './FilterChip.module.css';
import { strings } from './strings.ts';

/** Props for FilterChip. */
export interface FilterChipProps {
  /** The attribute, through relations: `['Company', 'Country']`. */
  readonly attribute: readonly string[];
  /** The attribute type's icon. */
  readonly icon?: IconName;
  /** The operator as words: "is", "is any of", "within the last". Leave it out for a group of conditions. */
  readonly operator?: string;
  /** The value, drawn through the field set (a Tag, a date, a chip). Leave it out while it is unset. */
  readonly value?: ReactNode;
  /**
   * False for a condition that takes no value ("is empty", "is me") or a
   * group: the chip has no value part, so no "Choose a value" shows.
   */
  readonly hasValue?: boolean;
  /** Shown where an unset value goes: "Choose a value". */
  readonly placeholder?: string;
  /** Opens the attribute picker. */
  readonly onPressAttribute?: () => void;
  /** Opens the operator menu. */
  readonly onPressOperator?: () => void;
  /** Opens the value editor. */
  readonly onPressValue?: () => void;
  /** Removes the filter. Without it the chip has no remove part (a view you can't edit). */
  readonly onRemove?: () => void;
  /** The group's name for screen readers; "Filter: Stage is" by default. Another chip in this shape (the sort chip) names itself. */
  readonly label?: string;
  /** The remove part's name; "Remove filter" by default. */
  readonly removeLabel?: string;
  /** The chip's root, for a popover the screen opens from it (spec 0020: the sort builder). */
  readonly ref?: Ref<HTMLSpanElement>;
}

/**
 * One applied filter as a chip in the view bar: attribute, operator, value,
 * each a button that opens its editor, and a remove button. FilterBuilder (#20)
 * holds them and their editors.
 */
export function FilterChip({
  attribute,
  icon,
  operator,
  value,
  hasValue = true,
  placeholder = strings.chooseValue,
  onPressAttribute,
  onPressOperator,
  onPressValue,
  onRemove,
  label,
  removeLabel = strings.remove,
  ref,
}: FilterChipProps) {
  return (
    <span
      ref={ref}
      className={styles.root}
      role="group"
      aria-label={label ?? strings.filter(attribute.join(' '), operator ?? '')}
    >
      <AriaButton className={styles.segment} {...(onPressAttribute === undefined ? {} : { onPress: onPressAttribute })}>
        {icon !== undefined && <Icon name={icon} size="sm" tone="muted" />}
        <Path parts={attribute} />
      </AriaButton>
      {operator !== undefined && (
        <AriaButton
          className={styles.segment}
          data-part="operator"
          {...(onPressOperator === undefined ? {} : { onPress: onPressOperator })}
        >
          {operator}
        </AriaButton>
      )}
      {hasValue && (
        <AriaButton
          className={styles.segment}
          data-part="value"
          {...(onPressValue === undefined ? {} : { onPress: onPressValue })}
        >
          {value ?? <span className={styles.placeholder}>{placeholder}</span>}
        </AriaButton>
      )}
      {onRemove !== undefined && (
        <AriaButton className={styles.segment} data-part="remove" aria-label={removeLabel} onPress={onRemove}>
          <Icon name="x" size="sm" />
        </AriaButton>
      )}
    </span>
  );
}
