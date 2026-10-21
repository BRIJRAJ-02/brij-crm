import { use, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Autocomplete,
  Button as AriaButton,
  FieldError,
  Label,
  ListBox,
  ListBoxItem,
  Select as AriaSelect,
  SelectValue,
  Text,
} from 'react-aria-components';
import { FocusScope, useFilter } from 'react-aria';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import type { Hue } from '../../hue.ts';
import { Field } from '../Field/Field.tsx';
import { InPopover, Popover } from '../Popover/Popover.tsx';
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
  /** Can't be chosen now: shown muted, its `description` saying why (a field a rule rules out). */
  readonly isDisabled?: boolean;
  /** Anything else to draw before the label: an Avatar for people. */
  readonly leading?: ReactNode;
  /** What the `prefix` trigger shows instead of the label, beside `leading`: a country's "+91". */
  readonly short?: string;
  /** Set apart under a hairline: a choice unlike the rest, last in the list ("Don't add to the CRM" after the objects). */
  readonly isApart?: boolean;
}

/** Props for Select. */
export interface SelectProps {
  /** What is chosen ("Stage"). Always given; `isLabelHidden` keeps it for screen readers only. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** A quiet word after the label, such as "(optional)" on a public form: muted, and part of the field's name. */
  readonly labelAside?: string;
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
  /**
   * `cell` is the trigger a grid cell becomes while its list is open: it
   * fills the cell with the value where the display had it, with no box or
   * ring of its own (the cell draws the one ring), and the list opens at
   * least a menu wide.
   */
  /**
   * `inline` sits in a line of text, the value and its chevron with no box
   * (a booking page's time zone in its rail); its list opens a menu wide.
   */
  /**
   * `prefix` is the compact trigger joined to the start of a Field's box (a
   * phone number's country code): no box of its own, a hairline after it,
   * `leading` and `short` in place of the label, and the list a menu wide.
   */
  /**
   * `time` is a time of day in a row of them (weekly hours): one fixed width for
   * every time and figures of one width, so nothing beside it moves when the
   * value changes; its list opens at its own width.
   */
  readonly variant?: 'default' | 'cell' | 'prefix' | 'inline' | 'time';
  /** The chosen option's `description` after its label in the closed field, muted (a time zone's "GMT+05:30"). */
  readonly showsDescription?: boolean;
  /** A search field over the options, for long lists such as countries. */
  readonly isSearchable?: boolean;
  /**
   * Which options a search keeps, when matching the label is not enough: a
   * country by its name, its ISO code or its dial code. The default keeps an
   * option whose label holds what is typed, ignoring case and accents.
   */
  readonly filter?: (item: SelectItem, query: string) => boolean;
  /**
   * Where a kept option goes while searching: lower comes first, ties keep
   * the given order. The default puts options whose label starts with what is
   * typed first ("ind" lists India before British Indian Ocean Territory), so
   * Enter on the first one chooses what was meant.
   */
  readonly rank?: (item: SelectItem, query: string) => number;
  /** The trigger's element, for a field that puts focus back after a choice. */
  readonly triggerRef?: Ref<HTMLButtonElement>;
  /** The search field's name. Defaults to "Search". */
  readonly searchLabel?: string;
  /**
   * Offers "Create "<typed>"" last in a search over the options, when what is
   * typed matches no live option's label (ignoring case): a select or status
   * cell for someone who may shape the schema (spec 0012, AC-238). Choosing it
   * hands the label over; the list closes. Turns the search on.
   */
  readonly onCreate?: (label: string) => void;
  /** What the search starts with: the key that opened a grid cell's editor. */
  readonly defaultSearch?: string;
  /** Takes focus as it mounts: the first thing to choose in a dialog (RelationshipSettings' related object). */
  readonly autoFocus?: boolean;
  /** Opens it on first render: a grid cell's edit, stories and previews. */
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
}

/** The event React Aria's search sends its list to mark the first match (`FOCUS_EVENT` in react-aria's autocomplete). */
const FOCUS_FIRST_EVENT = 'react-aria-focus';

const CLEAR = '\u0000clear';
const CREATE = '\u0000create';

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
  labelAside,
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
  variant = 'default',
  showsDescription = false,
  autoFocus = false,
  defaultOpen,
  onOpenChange,
  isSearchable = false,
  searchLabel = strings.search,
  filter,
  rank,
  triggerRef,
  onCreate,
  defaultSearch,
}: SelectProps) {
  const { contains, startsWith } = useFilter({ sensitivity: 'base' });
  // In a popover the popover's edge frames the trigger, so its focus is the accent edge alone.
  const isInPopover = use(InPopover);
  const [query, setQuery] = useState(defaultSearch ?? '');
  const current = value ?? defaultValue ?? null;
  const chosen = items.find((item) => item.id === current);
  const description = (isReadOnly ? readOnlyReason : undefined) ?? hint;
  const typed = query.trim();
  const hasSearch = isSearchable || onCreate !== undefined;
  // While searching, the best matches come first (by default, labels that start with what is typed), so Enter on
  // the first one chooses what was meant; the rest keep their order.
  const rankOf = rank ?? ((item: SelectItem, input: string) => (startsWith(item.label, input) ? 0 : 1));
  const ranks = hasSearch && typed !== '' ? new Map(items.map((item) => [item.id, rankOf(item, typed)])) : undefined;
  const ranked =
    ranks === undefined ? items : [...items].sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0));
  // React Aria marks the first match as the typed text changes, in the list as it stood a moment before (its
  // collection takes the new order one render later), so a match ranked up by this key was left unmarked below
  // the top. Once the order changes, ask it again, with the event its own search sends to its list.
  const listRef = useRef<HTMLDivElement>(null);
  const order = ranked.map((item) => item.id).join('\u0000');
  const lastOrder = useRef(order);
  useLayoutEffect(() => {
    if (order === lastOrder.current) return;
    lastOrder.current = order;
    if (typed === '') return;
    listRef.current?.dispatchEvent(
      new CustomEvent(FOCUS_FIRST_EVENT, { bubbles: true, cancelable: true, detail: { focusStrategy: 'first' } }),
    );
  }, [order, typed]);

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

  const disabledKeys = items
    .filter((item) => item.isDisabled === true || (item.isArchived === true && item.id !== current))
    .map((item) => item.id);
  const canCreate =
    onCreate !== undefined &&
    typed !== '' &&
    !items.some((item) => item.isArchived !== true && item.label.trim().toLowerCase() === typed.toLowerCase());
  const options: readonly SelectItem[] = [
    ...ranked,
    ...(isClearable && !isRequired && current !== null
      ? [{ id: CLEAR, label: strings.clear, icon: 'x' as const }]
      : []),
    // Its words hold what was typed, so the search's own filter always keeps it.
    ...(canCreate ? [{ id: CREATE, label: strings.create(typed), icon: 'plus' as const }] : []),
  ];
  // A caller's filter sees the option itself; Create and Clear always stay, since their words hold the search.
  const keeps = (textValue: string, input: string, node: { readonly key: unknown; readonly value: unknown }) => {
    if (filter === undefined || node.key === CREATE || node.key === CLEAR) return contains(textValue, input);
    const item = options.find((option) => option.id === node.key);
    return item === undefined ? contains(textValue, input) : filter(item, input);
  };

  const list = (
    <ListBox
      ref={listRef}
      className={styles.list}
      items={options}
      renderEmptyState={() => <span className={styles.empty}>{strings.noMatches}</span>}
    >
      {(item) => (
        <ListBoxItem
          id={item.id}
          textValue={item.label}
          className={styles.option}
          data-clear={item.id === CLEAR || item.id === CREATE || undefined}
          data-apart={item.isApart === true || undefined}
        >
          {({ isSelected }) => (
            <>
              <Face item={item} optionStyle={item.id === CLEAR || item.id === CREATE ? 'plain' : optionStyle} />
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
  );

  return (
    <AriaSelect
      className={styles.root}
      data-size={size}
      data-variant={variant}
      data-in-popover={isInPopover || undefined}
      isDisabled={isDisabled}
      isRequired={isRequired}
      isInvalid={error !== undefined}
      disabledKeys={disabledKeys}
      placeholder={placeholder ?? strings.choose}
      {...(isLabelHidden ? { 'aria-label': label } : {})}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(autoFocus ? { autoFocus: true } : {})}
      // Each opening searches afresh (from the key that opened a cell's list, when one did).
      onOpenChange={(isOpen) => {
        if (!isOpen) setQuery(defaultSearch ?? '');
        onOpenChange?.(isOpen);
      }}
      onChange={(next) => {
        if (next === CREATE) {
          if (canCreate) onCreate(typed);
          return;
        }
        onChange?.(next === CLEAR || next === null ? null : String(next));
      }}
    >
      {!isLabelHidden && (
        <Label className={styles.label}>
          {label}
          {labelAside !== undefined && (
            <>
              {' '}
              <span className={styles.aside}>{labelAside}</span>
            </>
          )}
        </Label>
      )}
      <AriaButton className={styles.trigger} {...(triggerRef === undefined ? {} : { ref: triggerRef })}>
        <SelectValue<SelectItem> className={styles.value}>
          {({ selectedItems, isPlaceholder, defaultChildren }) => {
            const selected = selectedItems[0];
            if (isPlaceholder || selected === undefined || selected === null)
              return <span className={styles.placeholder}>{defaultChildren}</span>;
            return variant === 'prefix' && selected.short !== undefined ? (
              <>
                {selected.leading}
                <span className={styles.short}>{selected.short}</span>
              </>
            ) : (
              <>
                <Face item={selected} optionStyle={optionStyle} />
                {showsDescription && selected.description !== undefined && (
                  <span className={styles.description}>{selected.description}</span>
                )}
              </>
            );
          }}
        </SelectValue>
        {/* The prefix is a compact code button: its chevron is the small one. */}
        <Icon name="chevron-down" size={variant === 'prefix' ? 'xs' : 'sm'} tone="muted" />
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
      <Popover width={variant === 'default' || variant === 'time' ? 'trigger' : 'menu'}>
        {hasSearch ? (
          // The search takes focus through the list's own focus scope, once that scope is in place: an input's
          // own autoFocus fired while the popover was still mounting, so a popover around this one (a grid cell's
          // editor, which closes when focus leaves it) read the move as leaving and closed, list and all.
          // eslint-disable-next-line jsx-a11y-x/no-autofocus -- a search over a list opens with its field focused
          <FocusScope autoFocus>
            <div className={styles.searchable}>
              <Autocomplete
                filter={keeps}
                inputValue={query}
                onInputChange={setQuery}
                // Create alone in the list waits for an arrow: one Enter on a typo never makes an option.
                disableAutoFocusFirst={canCreate && !items.some((item) => contains(item.label, typed))}
              >
                <div className={styles.search}>
                  {/* A search over a list opens with its field focused (the scope's first stop), as React Aria expects. */}
                  <Field label={searchLabel} isLabelHidden variant="search" size="sm" />
                </div>
                {list}
              </Autocomplete>
            </div>
          </FocusScope>
        ) : (
          list
        )}
      </Popover>
    </AriaSelect>
  );
}
