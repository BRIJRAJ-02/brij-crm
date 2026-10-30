import { use, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import {
  Autocomplete,
  Button as AriaButton,
  FieldError,
  Header,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  type ListBoxItemProps,
  Select as AriaSelect,
  SelectValue,
  Text,
} from 'react-aria-components';
import { FocusScope, useFilter } from 'react-aria';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import type { Hue } from '../../hue.ts';
import { Field } from '../Field/Field.tsx';
import { InPopover, Popover, type PopoverPlacement } from '../Popover/Popover.tsx';
import { FieldLabel } from '../../atoms/FieldLabel/FieldLabel.tsx';
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
  /** A short label after the option's name, in the list and on the trigger: a schedule's "Default". Plain options only. */
  readonly badge?: string;
  /** Set apart under a hairline: a choice unlike the rest, last in the list ("Don't add to the CRM" after the objects). */
  readonly isApart?: boolean;
  /**
   * The heading it sits under in the list: options with the same group follow one heading, in the order they come
   * (a booking page's calendars, by account). Options without one come first, under no heading.
   */
  readonly group?: string;
}

/** Props for Select. */
export interface SelectProps {
  /** What is chosen ("Stage"). Always given; `isLabelHidden` keeps it for screen readers only. */
  readonly label: string;
  readonly isLabelHidden?: boolean;
  /** A quiet word after the label, such as "(optional)" on a public form: muted, and part of the field's name. */
  readonly labelAside?: string;
  /** An InfoTip beside the label, for a setting whose label alone isn't clear ("Minimum notice"). */
  readonly info?: ReactNode;
  readonly items: readonly SelectItem[];
  readonly optionStyle?: SelectOptionStyle;
  readonly value?: string | null;
  readonly defaultValue?: string | null;
  /** Called with the chosen id, or `null` when cleared. */
  readonly onChange?: (id: string | null) => void;
  /**
   * The caller saves each change at once (a setting saved as it is picked): the value changes only by a choice in
   * the open list, so the closed trigger's left and right arrows and a typed letter change nothing. One stray key
   * on a focused trigger renamed every record of an object.
   */
  readonly savesOnPick?: boolean;
  /**
   * `multiple` lets several options be chosen ("Country is any of Germany or France"): each chosen option is
   * checked, the list stays open while choosing, and the closed field names them all, in the list's order. `values`
   * and `onValuesChange` take the place of `value` and `onChange`; Clear is for one choice only, while Create
   * hands its label over in either (the new option is the caller's to add to the values).
   */
  readonly selectionMode?: 'single' | 'multiple';
  /**
   * With `selectionMode="multiple"`: how many chosen options the closed field shows before "+N", so several never
   * squash or push its chevron out (the field set passes 3, as a select's display shows). All when left out.
   */
  readonly maxVisible?: number;
  /** With `selectionMode="multiple"`: the chosen ids. */
  readonly values?: readonly string[];
  /** With `selectionMode="multiple"`: every chosen id after each change, in the list's order. */
  readonly onValuesChange?: (ids: readonly string[]) => void;
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
  /**
   * Where each option's `description` sits in the list: `after` its label on the same line (a time zone's offset,
   * the default), or `below` it, wrapping, in a list a menu wide that opens under the trigger's end (a role and
   * what it can do). Why `below`: a role's line after its name made the list as wide as the longest line, so it
   * spilled out of the dialog it opened in and covered its buttons (the owner, 22 October 2026).
   */
  readonly optionDescription?: 'after' | 'below';
  /**
   * Where the list opens (under the trigger by default; React Aria flips it when there's no room). `top end` keeps
   * a short list above a dialog's footer when the trigger sits just over it (the Invite dialog's role per row).
   */
  readonly placement?: PopoverPlacement;
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

/** Untyped on ListBoxItem, so `reachableWhileDisabled` takes it through a spread. */
const selectionOnly = { disabledBehavior: 'selection' };

/**
 * What a disabled option (`isDisabled`) adds to its ListBoxItem while the list is open: the arrows and typeahead land
 * on it, so a keyboard or screen reader user hears it and its reason, while staying in `disabledKeys` keeps Enter,
 * Space and a click from choosing it (#68). React Aria's own disabled option is skipped, reason and all. React Stately
 * reads an item's `disabledBehavior` (its keyboard delegate's and selection manager's `isDisabled`), though
 * ListBoxItem's types leave it out, so it comes in through a spread; `Select.browser.test.tsx` pins it. A focusable
 * option isn't marked disabled by React Aria, so `render` puts back `aria-disabled` and the `data-disabled` its look
 * keys on. While the list is closed it stays a plain disabled option, so the trigger's arrows and typeahead skip it.
 */
const reachableWhileDisabled: Partial<ListBoxItemProps<SelectItem>> = {
  ...selectionOnly,
  // A Select's options never link, so the option is always a div. With the search on, focus stays in the search
  // and React Aria hands the option Enter and Space itself, and its press then empties the choice for a key it
  // can't select; the option swallows them, so the list stays open on it with the choice as it was.
  render: (props) => {
    const div = props as ComponentProps<'div'>;
    return (
      // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- React Aria's props bring role="option"
      <div
        {...div}
        aria-disabled="true"
        data-disabled=""
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
          else div.onKeyDown?.(event);
        }}
      />
    );
  },
};

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
      {item.badge !== undefined && <Badge text={item.badge} />}
    </>
  );
}

/** Several chosen options in the closed field: plain names joined in one line that cuts with an ellipsis, else each face. */
function Faces({
  items,
  optionStyle,
  maxVisible,
}: {
  readonly items: readonly SelectItem[];
  readonly optionStyle: SelectOptionStyle;
  readonly maxVisible: number | undefined;
}) {
  if (optionStyle === 'plain') {
    return <span className={styles.plain}>{items.map((item) => item.label).join(strings.listJoin)}</span>;
  }
  const shown = maxVisible === undefined ? items : items.slice(0, maxVisible);
  const rest = items.length - shown.length;
  return (
    <>
      {shown.map((item) => (
        <Face key={item.id} item={item} optionStyle={optionStyle} />
      ))}
      {/* Text, not a button: the whole field opens the list, where every choice shows. */}
      {rest > 0 && (
        <span className={styles.more} aria-label={strings.more(rest)}>
          {strings.moreShort(rest)}
        </span>
      )}
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
  info,
  items,
  optionStyle = 'plain',
  value,
  defaultValue,
  onChange,
  savesOnPick = false,
  selectionMode = 'single',
  maxVisible,
  values,
  onValuesChange,
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
  optionDescription = 'after',
  placement,
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
  const isMultiple = selectionMode === 'multiple';
  // Without a `value`, the Select keeps its own: React Aria's uncontrolled value took Clear's own key as the value.
  const [own, setOwn] = useState<string | null>(defaultValue ?? null);
  const current = isMultiple ? null : value === undefined ? own : value;
  // Disabled options are reachable only in the open list; the closed trigger's arrows and typeahead skip them.
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);
  const chosen = items.find((item) => item.id === current);
  // Every chosen id: the one in a single choice, all of them in a multiple one.
  const chosenIds: readonly string[] = isMultiple ? (values ?? []) : current === null ? [] : [current];
  const chosenItems = items.filter((item) => chosenIds.includes(item.id));
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
        {!isLabelHidden && <FieldLabel label={label} info={info} as="text" />}
        <span className={styles.trigger} role="group" aria-label={label}>
          <span className={styles.value}>
            {isMultiple && chosenItems.length > 0 ? (
              <Faces items={chosenItems} optionStyle={optionStyle} maxVisible={maxVisible} />
            ) : !isMultiple && chosen !== undefined ? (
              <Face item={chosen} optionStyle={optionStyle} />
            ) : (
              <span className={styles.placeholder}>{placeholder ?? strings.none}</span>
            )}
          </span>
          <Icon name="lock" size="xs" tone="muted" label={strings.readOnly} />
        </span>
        {description !== undefined && <span className={styles.hint}>{description}</span>}
      </span>
    );
  }

  // Nothing to choose yet and nothing typed: a list that creates says how to add the first one.
  const emptyText = onCreate !== undefined && typed === '' ? strings.typeToCreate : strings.noMatches;
  // While closed, Clear and Create are skipped too: the trigger's arrows would clear or create without the list.
  const disabledKeys = [
    ...items
      .filter((item) => item.isDisabled === true || (item.isArchived === true && !chosenIds.includes(item.id)))
      .map((item) => item.id),
    ...(isOpen ? [] : [CLEAR, CREATE]),
  ];
  // Several chosen take Create too (a multi select's new tag): it hands the label over, as one choice does.
  const canCreate =
    onCreate !== undefined &&
    typed !== '' &&
    !items.some((item) => item.isArchived !== true && item.label.trim().toLowerCase() === typed.toLowerCase());
  const options: readonly SelectItem[] = [
    ...ranked,
    ...(isClearable && !isRequired && !isMultiple && current !== null
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

  const option = (item: SelectItem) => (
    <ListBoxItem
      key={item.id}
      id={item.id}
      // The item itself, so the closed field draws the chosen one's face, never the option's text run together
      // ("Your default (ada@acme.dev)Follows your default"): a grouped list's static items carry no value otherwise.
      value={item}
      textValue={item.label}
      className={styles.option}
      data-clear={item.id === CLEAR || item.id === CREATE || undefined}
      data-apart={item.isApart === true || undefined}
      data-description={item.description === undefined ? undefined : optionDescription}
      {...(isOpen && item.isDisabled === true ? reachableWhileDisabled : {})}
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
  );
  // Grouped options: those with no group first, then a headed section per group, in the order they come.
  const groups = [...new Set(options.flatMap((item) => (item.group === undefined ? [] : [item.group])))];
  const grouped =
    groups.length === 0 ? undefined : (
      <ListBox
        ref={listRef}
        className={styles.list}
        renderEmptyState={() => <span className={styles.empty}>{emptyText}</span>}
      >
        {options
          .filter(
            (item) => item.group === undefined && item.isApart !== true && item.id !== CLEAR && item.id !== CREATE,
          )
          .map(option)}
        {groups.map((group) => (
          <ListBoxSection key={group} id={`group:${group}`} className={styles.section}>
            <Header className={styles.groupHeading}>{group}</Header>
            {options.filter((item) => item.group === group).map(option)}
          </ListBoxSection>
        ))}
        {/* A choice set apart, then Clear and Create, last, as in an ungrouped list. */}
        {options.filter((item) => item.group === undefined && item.isApart === true).map(option)}
        {options.filter((item) => item.id === CLEAR || item.id === CREATE).map(option)}
      </ListBox>
    );

  const list = grouped ?? (
    <ListBox
      ref={listRef}
      className={styles.list}
      items={options}
      // Its options are drawn again when the list opens or closes: a disabled one is reachable only while open.
      dependencies={[isOpen]}
      renderEmptyState={() => <span className={styles.empty}>{emptyText}</span>}
    >
      {(item) => (
        <ListBoxItem
          id={item.id}
          textValue={item.label}
          className={styles.option}
          data-clear={item.id === CLEAR || item.id === CREATE || undefined}
          data-apart={item.isApart === true || undefined}
          data-description={item.description === undefined ? undefined : optionDescription}
          {...(isOpen && item.isDisabled === true ? reachableWhileDisabled : {})}
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
      selectionMode={selectionMode}
      // React Aria opens no list with nothing in it; a list that creates opens anyway, to take the first one typed.
      {...(onCreate === undefined ? {} : { allowsEmptyCollection: true })}
      {...(isMultiple ? { value: [...chosenIds] } : {})}
      {...(isMultiple ? {} : { value: current })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(autoFocus ? { autoFocus: true } : {})}
      // Each opening searches afresh (from the key that opened a cell's list, when one did).
      onOpenChange={(isOpen) => {
        setIsOpen(isOpen);
        if (!isOpen) setQuery(defaultSearch ?? '');
        onOpenChange?.(isOpen);
      }}
      onChange={(next) => {
        if (Array.isArray(next)) {
          const picked = new Set(next.map(String));
          if (picked.has(CREATE)) {
            if (canCreate) onCreate(typed);
            return;
          }
          onValuesChange?.(items.filter((item) => picked.has(item.id)).map((item) => item.id));
          return;
        }
        // The closed trigger's typeahead tests the key the open list last rested on without asking whether it is
        // disabled, so a disabled option (or Clear and Create, while closed) is refused here too; `savesOnPick`
        // refuses every change while closed.
        if ((next !== null && disabledKeys.includes(String(next))) || (savesOnPick && !isOpen)) return;
        if (next === CREATE) {
          if (canCreate) onCreate(typed);
          return;
        }
        const id = next === CLEAR || next === null ? null : String(next);
        setOwn(id);
        onChange?.(id);
      }}
    >
      {!isLabelHidden && <FieldLabel label={label} aside={labelAside} info={info} isDisabled={isDisabled} />}
      <AriaButton className={styles.trigger} {...(triggerRef === undefined ? {} : { ref: triggerRef })}>
        <SelectValue<SelectItem> className={styles.value}>
          {({ selectedItems, isPlaceholder, defaultChildren }) => {
            // Several chosen: each by the field's own values, in the list's order.
            if (isMultiple) {
              return chosenItems.length === 0 ? (
                <span className={styles.placeholder}>{defaultChildren}</span>
              ) : (
                <Faces items={chosenItems} optionStyle={optionStyle} maxVisible={maxVisible} />
              );
            }
            // A static (grouped) option without its value still names the chosen item by the field's own value:
            // React Aria types the entry as always there, but a static item's is null.
            const first = selectedItems[0];
            const selected = first ?? chosen;
            if (isPlaceholder || selected === undefined)
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
      <Popover
        {...(optionDescription === 'below'
          ? { width: 'list' as const, placement: placement ?? ('bottom end' as const) }
          : {
              width: variant === 'default' || variant === 'time' ? 'trigger' : 'menu',
              ...(placement === undefined ? {} : { placement }),
            })}
      >
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
