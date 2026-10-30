import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type JSX,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Autocomplete,
  Header,
  Input,
  ListLayout,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger as AriaMenuTrigger,
  SearchField,
  Separator,
  SubmenuTrigger as AriaSubmenuTrigger,
  Text,
  useFilter,
  Virtualizer,
  type Key,
  type Selection,
} from 'react-aria-components';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { Kbd } from '../../atoms/Kbd/Kbd.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import type { ListSource } from '../../lib/list-source.ts';
import { RowShown, useRangeReporter } from '../../lib/range-reporter.tsx';
import { safeHref } from '../../lib/safe-href.ts';
import { sizeToken } from '../../lib/token-values.ts';
import { Popover, type PopoverPlacement, type PopoverWidth } from '../Popover/Popover.tsx';
import styles from './Menu.module.css';
import { strings } from './strings.ts';

/** A menu item's key: what `onAction` and the selection hand back. */
export type MenuKey = Key;

/**
 * Virtualised rows start at an item's height and are measured once drawn: a
 * row with a description (a member's email) is taller, and a fixed height
 * would draw it over the next row.
 */
const ROW_SIZES = { estimatedRowHeight: sizeToken('size-nav-item') } as const;

/** Props for MenuTrigger. */
export interface MenuTriggerProps {
  /** The trigger (a Button), then the Menu it opens. */
  readonly children: ReactNode;
  /** `press` (the default), `longPress` for touch, or `contextMenu` for right click and Shift F10. */
  readonly trigger?: 'press' | 'longPress' | 'contextMenu';
  readonly isOpen?: boolean;
  /** Opens it on first render (stories and previews show menus open). */
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
}

/** Opens a Menu from the Button before it. Enter, Space or the arrow keys open it; Esc closes it and returns focus. */
export function MenuTrigger({ children, trigger, isOpen, defaultOpen, onOpenChange }: MenuTriggerProps) {
  return (
    <AriaMenuTrigger
      {...(trigger === undefined ? {} : { trigger })}
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(defaultOpen === undefined ? {} : { defaultOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      {children}
    </AriaMenuTrigger>
  );
}

/** Props for ContextMenu. */
export interface ContextMenuProps {
  /** What it opens from: a pressable library element (a Button, a row, a card). */
  readonly children: ReactElement;
  /** The Menu it opens, at the pointer. */
  readonly menu: ReactElement;
}

/**
 * Menu's right click variant: opens `menu` at the pointer on right click, a
 * long press, or Shift F10 and the context menu key. Esc returns focus to the
 * element it opened from.
 */
export function ContextMenu({ children, menu }: ContextMenuProps) {
  return (
    <AriaMenuTrigger trigger="contextMenu">
      {children}
      {menu}
    </AriaMenuTrigger>
  );
}

/** Props for SubmenuTrigger. */
export interface SubmenuTriggerProps {
  /** The MenuItem that opens it, then the submenu's Menu. */
  readonly children: ReactElement[];
}

/** Opens a submenu from a MenuItem: by hover, the right arrow, or Enter. The left arrow closes it. */
export function SubmenuTrigger({ children }: SubmenuTriggerProps) {
  return <AriaSubmenuTrigger>{children}</AriaSubmenuTrigger>;
}

/** Search above a menu's items. */
export interface MenuSearch {
  /** The search field's name ("Search attributes"). */
  readonly label: string;
  /** Hint text in the field. Defaults to the label with an ellipsis. */
  readonly placeholder?: string;
  /** Searching outside (async): the menu shows what the caller sends back. Leave it out to filter the items here. */
  readonly onSearch?: (query: string) => void;
  /** What the field starts with: the key that opened a grid cell's editor. */
  readonly defaultQuery?: string;
  /** Leaves the first item unfocused while typing (a lone "Create" item, which one Enter shouldn't choose). */
  readonly isFirstUnfocused?: boolean;
  /**
   * `sm` (the default) is a picker's 28px field; `lg` is the command palette's: a bar's height, the title's 15px
   * text, and roomier rows under it.
   */
  readonly size?: 'sm' | 'lg';
}

interface MenuLook {
  /** The menu's name ("Column options"). Inside a MenuTrigger, React Aria names it after its trigger instead; this names it when inline. */
  readonly label: string;
  readonly onAction?: (key: MenuKey) => void;
  /** `single` or `multiple` shows a check on chosen items. */
  readonly selectionMode?: 'none' | 'single' | 'multiple';
  readonly selectedKeys?: Iterable<MenuKey>;
  readonly defaultSelectedKeys?: Iterable<MenuKey>;
  readonly onSelectionChange?: (keys: ReadonlySet<MenuKey>) => void;
  readonly disabledKeys?: Iterable<MenuKey>;
  readonly search?: MenuSearch;
  /** What it says when nothing matches. Defaults to "No matches". */
  readonly emptyLabel?: string;
  readonly width?: Extract<PopoverWidth, 'menu' | 'trigger'>;
  readonly placement?: PopoverPlacement;
  /** Draws the menu in place, with no popover (inside a palette or a panel). */
  readonly isInline?: boolean;
  /**
   * Focuses an item when the menu mounts: an inline menu that opens in a popover of its own (the week's "+N" list),
   * which no MenuTrigger focuses. A MenuTrigger's menu needs nothing.
   */
  readonly autoFocus?: 'first' | 'last';
  /**
   * A row above the search and the items, apart from them: a record search's
   * object ("Search in People", spec 0019). It sits outside the search, so
   * typing never filters it.
   */
  readonly header?: ReactNode;
  /**
   * What the popover lines up with and takes its width from, when that isn't
   * the trigger: a picker's whole field box, whose button fills only the room
   * its chips leave.
   */
  readonly anchorRef?: RefObject<Element | null>;
}

/** Props for Menu: static MenuItems as children, items with a render function, or a ListSource for long and async lists. */
export type MenuProps<T extends object> = MenuLook &
  (
    | {
        readonly children: ReactNode;
        readonly items?: never;
        readonly source?: never;
        readonly renderItem?: never;
        readonly isVirtualized?: never;
      }
    | {
        readonly items: Iterable<T>;
        readonly children: (item: T) => ReactNode;
        /** Draws only the rows on screen. Use it past a few hundred items. */
        readonly isVirtualized?: boolean;
        readonly source?: never;
        readonly renderItem?: never;
      }
    | {
        /** Long or async items from outside; rows still loading draw a skeleton. Always virtualised. Keys are `source.getKey(item)`. */
        readonly source: ListSource<T>;
        /** What one loaded item shows, as MenuItem's props (its `id` comes from the source). */
        readonly renderItem: (item: T) => Omit<MenuItemProps, 'id'>;
        readonly children?: never;
        readonly items?: never;
        readonly isVirtualized?: never;
      }
  );

interface Row {
  readonly id: number;
}

function selectionHandler(onSelectionChange: MenuLook['onSelectionChange']) {
  if (onSelectionChange === undefined) return {};
  return {
    onSelectionChange: (keys: Selection) => {
      onSelectionChange(keys === 'all' ? new Set() : keys);
    },
  };
}

/** A ListSource menu's rows are keyed by index; hand callers the item's own key. */
function sourceKey<T>(source: ListSource<T> | undefined, key: MenuKey): MenuKey {
  if (source === undefined || typeof key !== 'number') return key;
  const item = source.getItem(key);
  return item === undefined ? key : source.getKey(item);
}

/**
 * A list of actions or choices in a popover: column options, "Add to list",
 * a select with search. Built on React Aria's Menu, so arrow keys move, typing
 * jumps to an item, and Esc closes it and returns focus to the trigger.
 * Searchable menus filter here, or ask the caller (`search.onSearch`); long
 * and async lists draw only the rows on screen.
 */
export function Menu<T extends object>(props: MenuProps<T>) {
  const { label, onAction, selectionMode, selectedKeys, defaultSelectedKeys, onSelectionChange, disabledKeys } = props;
  const { search, emptyLabel = strings.noResults, width = 'menu', placement, isInline = false } = props;
  const { header, anchorRef, autoFocus } = props;
  const { contains } = useFilter({ sensitivity: 'base' });
  const onShown = useRangeReporter(props.source);
  const count = props.source?.count ?? 0;
  const rows = useMemo<readonly Row[]>(() => Array.from({ length: count }, (_, index) => ({ id: index })), [count]);

  const menuProps = {
    className: styles.menu,
    'aria-label': label,
    renderEmptyState: () => <span className={styles.empty}>{emptyLabel}</span>,
    ...(onAction === undefined
      ? {}
      : {
          onAction: (key: MenuKey) => {
            onAction(sourceKey(props.source, key));
          },
        }),
    ...(selectionMode === undefined ? {} : { selectionMode }),
    ...(selectedKeys === undefined ? {} : { selectedKeys }),
    ...(defaultSelectedKeys === undefined ? {} : { defaultSelectedKeys }),
    ...(disabledKeys === undefined ? {} : { disabledKeys }),
    ...(autoFocus === undefined ? {} : { autoFocus }),
    ...selectionHandler(onSelectionChange),
  };

  let menu: ReactNode;
  if (props.source !== undefined) {
    const { source, renderItem } = props;
    menu = (
      <Virtualizer layout={ListLayout} layoutOptions={ROW_SIZES}>
        {/* Rows are keyed by index, so the collection draws them again when the items behind them load. */}
        <AriaMenu {...menuProps} items={rows} dependencies={[source, renderItem]} data-virtualized="">
          {(row: Row) => {
            const item = source.getItem(row.id);
            if (item === undefined) {
              return (
                <AriaMenuItem
                  className={styles.item}
                  isDisabled
                  textValue=""
                  aria-label={strings.loadingItem}
                  data-loading=""
                >
                  <RowShown index={row.id} onShown={onShown} />
                  <Skeleton width="medium" />
                </AriaMenuItem>
              );
            }
            const look = renderItem(item);
            // Rows keep their index as their key, so loading never changes a key.
            const { id: _index, ...rowProps } = itemProps({ ...look, id: row.id });
            return (
              <AriaMenuItem {...rowProps}>
                {(state) => (
                  <>
                    <RowShown index={row.id} onShown={onShown} />
                    <ItemFace look={look} state={state} />
                  </>
                )}
              </AriaMenuItem>
            );
          }}
        </AriaMenu>
      </Virtualizer>
    );
  } else if (props.items !== undefined) {
    const list = (
      <AriaMenu {...menuProps} items={props.items} data-virtualized={props.isVirtualized === true ? '' : undefined}>
        {props.children}
      </AriaMenu>
    );
    menu =
      props.isVirtualized === true ? (
        <Virtualizer layout={ListLayout} layoutOptions={ROW_SIZES}>
          {list}
        </Virtualizer>
      ) : (
        list
      );
  } else {
    menu = <AriaMenu {...menuProps}>{props.children}</AriaMenu>;
  }

  const content =
    search === undefined ? (
      menu
    ) : (
      <div className={styles.searchable} data-size={search.size ?? 'sm'}>
        <Autocomplete
          {...(search.onSearch === undefined ? { filter: contains } : { onInputChange: search.onSearch })}
          {...(search.defaultQuery === undefined ? {} : { defaultInputValue: search.defaultQuery })}
          {...(search.isFirstUnfocused === true ? { disableAutoFocusFirst: true } : {})}
        >
          {/* A search menu opens with its field focused, the pattern React Aria expects. */}
          {/* eslint-disable-next-line jsx-a11y-x/no-autofocus */}
          <SearchField className={styles.search} aria-label={search.label} autoFocus>
            <Icon name="search" size={search.size === 'lg' ? 'md' : 'sm'} tone="muted" />
            <Input
              className={styles.input}
              placeholder={search.placeholder ?? strings.searchPlaceholder(search.label)}
            />
          </SearchField>
          {menu}
        </Autocomplete>
      </div>
    );

  const framed =
    header === undefined ? (
      content
    ) : (
      <div className={styles.searchable}>
        <div className={styles.header}>{header}</div>
        {content}
      </div>
    );
  const body = (
    <HasChecks.Provider value={selectionMode === 'single' || selectionMode === 'multiple'}>{framed}</HasChecks.Provider>
  );
  if (isInline) return body;
  return (
    <Popover
      width={width}
      {...(placement === undefined ? {} : { placement })}
      {...(anchorRef === undefined ? {} : { triggerRef: anchorRef })}
    >
      {body}
    </Popover>
  );
}

/** Props for MenuItem. */
export interface MenuItemProps {
  /** The key `onAction` and the selection hand back. Defaults to the label. */
  readonly id?: MenuKey;
  /** The label: a verb for an action ("Hide from view"), a name for a choice. */
  readonly children: string;
  readonly icon?: IconName;
  /** Something to draw before the label instead of an icon: an Avatar, a Tag, a StatusDot. */
  readonly leading?: ReactNode;
  /** `leading` already shows the label (a Tag of the option), so the label is kept for screen readers and typing only, never drawn twice. */
  readonly isLabelInLeading?: boolean;
  /** A second line under the label. */
  readonly description?: string;
  /** Quiet text at the end: a count, a type. */
  readonly meta?: string;
  /** The shortcut, written with Mac symbols (⌘C); other keyboards see Ctrl. */
  readonly kbd?: string;
  /** A destructive action, in the danger colour. */
  readonly isDanger?: boolean;
  /** A link in the app or out; it passes `safeHref`. */
  readonly href?: string;
  readonly onAction?: () => void;
  readonly isDisabled?: boolean;
  /**
   * A row that says where something stands ("Searching…"), not a control:
   * never highlighted or chosen, drawn in the secondary text colour at full
   * contrast, with the arrow cursor (not the disabled look).
   */
  readonly isPending?: boolean;
  /**
   * What is in effect now, in a menu of actions (a column's current sort): a
   * check at the end, which screen readers hear after the label ("Current").
   * A menu of choices uses `selectionMode` instead.
   */
  readonly isChecked?: boolean;
  /**
   * In a section that chooses (`selectionMode`), draws the check at the end when chosen, as `isChecked` does,
   * instead of in a check column before the items: a choice among plain actions (the command palette's themes under
   * Actions), whose icons stay in line with the actions' icons. Screen readers hear it as checked or not (aria-checked).
   * It takes the place of `isChecked`.
   */
  readonly isCheckAtEnd?: boolean;
  /**
   * The item can move among its neighbours (a saved view in the switcher): Alt with the up or down arrow asks to
   * move it that way, and the menu keeps focus on it. Screen readers hear the keys (aria-keyshortcuts).
   */
  readonly onMove?: (direction: 'up' | 'down') => void;
}

interface ItemState {
  readonly isSelected: boolean;
  readonly selectionMode: 'none' | 'single' | 'multiple';
  readonly hasSubmenu: boolean;
}

/** Whether a key press is the move's: Alt with the up or down arrow. */
const isMoveKey = (event: KeyboardEvent) => event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown');

/** A movable item's element: its keys said (aria-keyshortcuts), and Alt with an arrow moving it, not the focus. */
function moveKeys(onMove: (direction: 'up' | 'down') => void) {
  const move = (event: KeyboardEvent) => {
    // The move, not the menu's own arrow: focus stays on this item as it moves.
    event.preventDefault();
    event.stopPropagation();
    onMove(event.key === 'ArrowUp' ? 'up' : 'down');
  };
  // createElement, not JSX: the element is React Aria's own menuitem (its role, tab stop and handlers arrive in
  // `element`), which the JSX lint can't see.
  return (element: JSX.IntrinsicElements['div'] | JSX.IntrinsicElements['a']) =>
    isLinkElement(element)
      ? createElement('a', {
          ...element,
          'aria-keyshortcuts': MOVE_KEYS,
          onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => {
            if (isMoveKey(event)) move(event);
            else element.onKeyDown?.(event);
          },
        })
      : createElement('div', {
          ...element,
          'aria-keyshortcuts': MOVE_KEYS,
          onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
            if (isMoveKey(event)) move(event);
            else element.onKeyDown?.(event);
          },
        });
}

/** Whether React Aria draws the item as a link (it has an address). */
const isLinkElement = (
  element: JSX.IntrinsicElements['div'] | JSX.IntrinsicElements['a'],
): element is JSX.IntrinsicElements['a'] => 'href' in element;

/** The keys that move a movable item, as aria-keyshortcuts says them. */
const MOVE_KEYS = 'Alt+ArrowUp Alt+ArrowDown';

function itemProps({
  id,
  children,
  isDanger = false,
  href,
  onAction,
  isDisabled,
  isPending = false,
  onMove,
}: MenuItemProps) {
  const safe = safeHref(href);
  return {
    ...(onMove === undefined
      ? {}
      : {
          // React Aria's MenuItem passes neither aria-keyshortcuts nor a key handler through, so both go on the
          // element through its `render`, the menu's own keys running after the move's.
          render: moveKeys(onMove),
        }),
    id: id ?? children,
    textValue: children,
    className: styles.item,
    'data-danger': isDanger || undefined,
    ...(safe === undefined ? {} : { href: safe }),
    ...(onAction === undefined ? {} : { onAction }),
    ...(isDisabled === undefined ? {} : { isDisabled }),
    ...(isPending ? { isDisabled: true, 'data-loading': '', 'data-pending': '' } : {}),
  };
}

/**
 * The menu chooses (`single` or `multiple`), so its items keep a check column: a plain action in it (a
 * `selectionMode="none"` section) keeps the empty column too, and its icon lines up with the choices' icons.
 */
const HasChecks = createContext(false);

function ItemFace({ look, state }: { readonly look: Omit<MenuItemProps, 'id'>; readonly state: ItemState }) {
  const { children, icon, leading, isLabelInLeading = false, description, meta, kbd, isChecked = false } = look;
  const { isCheckAtEnd = false } = look;
  // In a choice, the item's own checked state (aria-checked) says it instead.
  const isCurrent = isChecked && !isCheckAtEnd;
  const hasChecks = useContext(HasChecks);
  return (
    <>
      {!isCheckAtEnd && (state.selectionMode !== 'none' || hasChecks) && (
        <span className={styles.check}>{state.isSelected && <Icon name="check" size="sm" />}</span>
      )}
      {/* The icon is quiet, as Attio's and Linear's are: the label carries the row. A destructive item keeps its red. */}
      {leading ??
        (icon !== undefined && <Icon name={icon} size="sm" {...(look.isDanger === true ? {} : { tone: 'muted' })} />)}
      <span className={styles.text}>
        <Text slot="label" className={styles.label}>
          {isLabelInLeading && leading !== undefined ? <VisuallyHidden>{children}</VisuallyHidden> : children}
        </Text>
        {/* The check of what is in effect is said after the label, as the item's description ("Current"). */}
        {(description !== undefined || isCurrent) && (
          <Text slot="description" className={description === undefined ? undefined : styles.description}>
            {/* Its own element, so the shown words stay findable as they are ("Owner"), apart from "Current". */}
            {description !== undefined && <span>{description}</span>}
            {isCurrent && (
              <VisuallyHidden>{description === undefined ? strings.current : ` ${strings.current}`}</VisuallyHidden>
            )}
          </Text>
        )}
      </span>
      {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      {kbd !== undefined && (
        <span aria-hidden="true">
          <Kbd tone="soft">{kbd}</Kbd>
        </span>
      )}
      {isCurrent && <Icon name="check" size="sm" />}
      {/* Screen readers hear the choice from the item itself (aria-checked), so this check is only drawn. */}
      {isCheckAtEnd && state.selectionMode !== 'none' && state.isSelected && <Icon name="check" size="sm" />}
      {state.hasSubmenu && <Icon name="chevron-right" size="sm" tone="muted" />}
    </>
  );
}

/** One action or choice in a Menu. In a SubmenuTrigger it shows a chevron and opens the submenu. */
export function MenuItem(props: MenuItemProps) {
  return <AriaMenuItem {...itemProps(props)}>{(state) => <ItemFace look={props} state={state} />}</AriaMenuItem>;
}

/** Props for MenuSection. */
export interface MenuSectionProps {
  /** The section's heading ("Company attributes"). */
  readonly label: string;
  /**
   * Keeps the heading for screen readers only (the section's name): a group whose heading would only add height,
   * such as a schedule's actions when there is one schedule (the owner, 22 October 2026).
   */
  readonly isLabelHidden?: boolean;
  readonly children: ReactNode;
  /**
   * The section's own selection, over the menu's: `none` makes its items
   * plain actions in a menu of choices (a view's Rename under the views to
   * switch to), so they read as menu items, never as choices.
   */
  readonly selectionMode?: 'none' | 'single' | 'multiple';
  /**
   * The section's own chosen items, with `selectionMode`: a menu of two groups that each take one choice (Bookings'
   * Filter: which meetings show, and which link), so each reads and behaves as its own single choice.
   */
  readonly selectedKeys?: Iterable<MenuKey>;
  readonly onSelectionChange?: (keys: ReadonlySet<MenuKey>) => void;
  /**
   * Follows the section above with no gap and no heading, as more of its group: a choice beside its actions (the
   * command palette's themes under Actions). `label` names it for screen readers only.
   */
  readonly isJoined?: boolean;
  /**
   * Pins the section to the foot of the menu, under a hairline, where a long list scrolls behind it: a picker's
   * "Create" or "Clear" (Attio's "Create new attribute"), always in reach, still reached by the arrow keys. Put it
   * last, with no separator before it; never in a virtualised menu, whose rows are placed by the list.
   */
  readonly isPinned?: boolean;
}

/** A labelled group of items in a Menu. */
export function MenuSection({
  label,
  isLabelHidden = false,
  children,
  selectionMode,
  selectedKeys,
  onSelectionChange,
  isJoined = false,
  isPinned = false,
}: MenuSectionProps) {
  // A pinned section's heading would only add height at the foot: its label names it for screen readers.
  const isHeadingDrawn = !isLabelHidden && !isJoined && !isPinned;
  return (
    <AriaMenuSection
      className={styles.section}
      {...(isJoined ? { 'data-joined': '' } : {})}
      {...(isPinned ? { 'data-pinned': '' } : {})}
      {...(isHeadingDrawn ? {} : { 'aria-label': label })}
      {...(selectionMode === undefined ? {} : { selectionMode })}
      {...(selectedKeys === undefined ? {} : { selectedKeys })}
      {...selectionHandler(onSelectionChange)}
    >
      {isHeadingDrawn && <Header className={styles.heading}>{label}</Header>}
      {children}
    </AriaMenuSection>
  );
}

/** A hairline between groups of items in a Menu. */
export function MenuSeparator() {
  return <Separator className={styles.separator} />;
}
