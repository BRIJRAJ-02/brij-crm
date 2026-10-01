import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Select as AriaSelect,
  SelectValue,
  Text,
} from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import type { Hue } from '../../hue.ts';
import { Popover } from '../Popover/Popover.tsx';
import styles from './Select.module.css';
import { strings } from './strings.ts';

/** How options show: `plain` text (with an icon), `tag` (select attributes) or `dot` (statuses). */
export type SelectOptionStyle = 'plain' | 'tag' | 'dot';

/** One option in a Select. */
export interface SelectItem {
  readonly id: string;
  readonly label: string;
  /** The option's hue, for tags and dots. */
  readonly hue?: Hue;
  readonly icon?: IconName;
  readonly description?: string;
  /** An archived option shows muted and can't be chosen, but stays shown when it is the current value. */
  readonly isArchived?: boolean;
  /** Anything else to draw before the label: an Avatar for people. */
  readonly leading?: ReactNode;
}

/** Props for Select. */
export interface SelectProps {
  /** What is chosen ("Stage"). Always given; `isLabelHidden` keeps it for screen readers only. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  readonly items: readonly SelectItem[];
  readonly optionStyle?: SelectOptionStyle;
  readonly value?: string | null;
  readonly defaultValue?: string | null;
  /** Called with the chosen id, or `null` when cleared. */
  readonly onChange?: (id: string | null) => void;
  /** Shown when nothing is chosen: "Set Stage…". */
  readonly placeholder?: string;
  readonly hint?: string;
  /** What's wrong, as a sentence that says how to fix it. */
  readonly error?: string;
  readonly isRequired?: boolean;
  /** Adds a "Clear" option when something is chosen. Leave it off when the attribute is required. */
  readonly isClearable?: boolean;
  readonly isReadOnly?: boolean;
  readonly readOnlyReason?: string;
  readonly isDisabled?: boolean;
  readonly size?: 'md' | 'sm';
  /** Opens it on first render: a grid cell's edit, stories and previews. */
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
}

const CLEAR = '\u0000clear';

function Face({ item, optionStyle }: { readonly item: SelectItem; readonly optionStyle: SelectOptionStyle }) {
  if (optionStyle === 'tag') {
    return (
      <Tag hue={item.hue ?? 'gray'} isArchived={item.isArchived ?? false}>
        {item.label}
      </Tag>
    );
  }
  if (optionStyle === 'dot') {
    return (
      <StatusDot hue={item.hue ?? 'gray'} isArchived={item.isArchived ?? false}>
        {item.label}
      </StatusDot>
    );
  }
  return (
    <>
      {item.leading ?? (item.icon !== undefined && <Icon name={item.icon} size="sm" tone="muted" />)}
      <span className={styles.plain}>{item.label}</span>
    </>
  );
}

/**
 * Choose one of a short list (up to about 15): a stage, a status, an owner.
 * Its options show as tags, status dots or people, the same as the value
 * everywhere else. Built on React Aria's Select, so it opens with the arrow
 * keys, types to jump, and puts focus back when it closes.
 */
export function Select({
  label,
  isLabelHidden = false,
  items,
  optionStyle = 'plain',
  value,
  defaultValue,
  onChange,
  placeholder,
  hint,
  error,
  isRequired = false,
  isClearable = false,
  isReadOnly = false,
  readOnlyReason,
  isDisabled = false,
  size = 'md',
  defaultOpen,
  onOpenChange,
}: SelectProps) {
  const current = value ?? defaultValue ?? null;
  const chosen = items.find((item) => item.id === current);
  const description = (isReadOnly ? readOnlyReason : undefined) ?? hint;

  if (isReadOnly) {
    return (
      <span className={styles.root} data-size={size} data-readonly="">
        {!isLabelHidden && <span className={styles.label}>{label}</span>}
        <span className={styles.trigger} role="group" aria-label={label}>
          <span className={styles.value}>
            {chosen === undefined ? (
              <span className={styles.placeholder}>{placeholder ?? strings.none}</span>
            ) : (
              <Face item={chosen} optionStyle={optionStyle} />
            )}
          </span>
          <Icon name="lock" size="xs" tone="muted" label={strings.readOnly} />
        </span>
        {description !== undefined && <span className={styles.hint}>{description}</span>}
      </span>
    );
  }

  const disabledKeys = items.filter((item) => item.isArchived === true && item.id !== current).map((item) => item.id);
  const options: readonly SelectItem[] =
    isClearable && !isRequired && current !== null ? [...items, { id: CLEAR, label: strings.clear, icon: 'x' }] : items;

  return (
    <AriaSelect
      className={styles.root}
      data-size={size}
      isDisabled={isDisabled}
      isRequired={isRequired}
      isInvalid={error !== undefined}
      disabledKeys={disabledKeys}
      placeholder={placeholder ?? strings.choose}
      {...(isLabelHidden ? { 'aria-label': label } : {})}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      onChange={(next) => {
        onChange?.(next === CLEAR || next === null ? null : String(next));
      }}
    >
      {!isLabelHidden && <Label className={styles.label}>{label}</Label>}
      <AriaButton className={styles.trigger}>
        <SelectValue<SelectItem> className={styles.value}>
          {({ selectedItems, isPlaceholder, defaultChildren }) => {
            const selected = selectedItems[0];
            return isPlaceholder || selected === undefined || selected === null ? (
              <span className={styles.placeholder}>{defaultChildren}</span>
            ) : (
              <Face item={selected} optionStyle={optionStyle} />
            );
          }}
        </SelectValue>
        <Icon name="chevron-down" size="sm" tone="muted" />
      </AriaButton>
      {description !== undefined && (
        <Text slot="description" className={styles.hint}>
          {description}
        </Text>
      )}
      <FieldError className={styles.error}>
        <Icon name="circle-alert" size="xs" />
        {error}
      </FieldError>
      <Popover width="trigger">
        <ListBox className={styles.list} items={options}>
          {(item) => (
            <ListBoxItem
              id={item.id}
              textValue={item.label}
              className={styles.option}
              data-clear={item.id === CLEAR || undefined}
            >
              {({ isSelected }) => (
                <>
                  <Face item={item} optionStyle={item.id === CLEAR ? 'plain' : optionStyle} />
                  {item.description !== undefined && <span className={styles.description}>{item.description}</span>}
                  {isSelected && (
                    <span className={styles.check}>
                      <Icon name="check" size="sm" />
                    </span>
                  )}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
