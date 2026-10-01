import { useCallback, useEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
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
import type { ListSource } from '../../lib/list-source.ts';
import { safeHref } from '../../lib/safe-href.ts';
import { sizeToken } from '../../lib/token-values.ts';
import { Popover, type PopoverPlacement, type PopoverWidth } from '../Popover/Popover.tsx';
import styles from './Menu.module.css';
import { strings } from './strings.ts';

/** A menu item's key: what `onAction` and the selection hand back. */
export type MenuKey = Key;

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

/** Tells the source which rows are drawn, once per batch of mounts and unmounts. */
function useRangeReporter<T>(source: ListSource<T> | undefined) {
  const shown = useRef(new Set<number>());
  const pending = useRef(false);
  const latest = useRef(source);
  useEffect(() => {
    latest.current = source;
  });
  // Stable, so each row's effect runs once per mount, not on every render.
  return useCallback((index: number) => {
    const report = () => {
      if (pending.current) return;
      pending.current = true;
      queueMicrotask(() => {
        pending.current = false;
        const onRangeChange = latest.current?.onRangeChange;
        if (onRangeChange === undefined || shown.current.size === 0) return;
        const indexes = [...shown.current];
        onRangeChange({ start: Math.min(...indexes), end: Math.max(...indexes) + 1 });
      });
    };
    shown.current.add(index);
    report();
    return () => {
      shown.current.delete(index);
      report();
    };
  }, []);
}

function RowShown({ index, onShown }: { readonly index: number; readonly onShown: (index: number) => () => void }) {
  useEffect(() => onShown(index), [index, onShown]);
  return null;
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
    ...selectionHandler(onSelectionChange),
  };

  let menu: ReactNode;
  if (props.source !== undefined) {
    const { source, renderItem } = props;
    menu = (
      <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: sizeToken('size-nav-item') }}>
        <AriaMenu {...menuProps} items={rows} data-virtualized="">
          {(row: Row) => {
            const item = source.getItem(row.id);
            if (item === undefined) {
              return (
                <AriaMenuItem className={styles.item} isDisabled textValue="">
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
        <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: sizeToken('size-nav-item') }}>
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
      <div className={styles.searchable}>
        <Autocomplete
          {...(search.onSearch === undefined ? { filter: contains } : { onInputChange: search.onSearch })}
          {...(search.defaultQuery === undefined ? {} : { defaultInputValue: search.defaultQuery })}
        >
          {/* A search menu opens with its field focused, the pattern React Aria expects. */}
          {/* eslint-disable-next-line jsx-a11y-x/no-autofocus */}
          <SearchField className={styles.search} aria-label={search.label} autoFocus>
            <Icon name="search" size="sm" tone="muted" />
            <Input
              className={styles.input}
              placeholder={search.placeholder ?? strings.searchPlaceholder(search.label)}
            />
          </SearchField>
          {menu}
        </Autocomplete>
      </div>
    );

  if (isInline) return content;
  return (
    <Popover width={width} {...(placement === undefined ? {} : { placement })}>
      {content}
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
}

interface ItemState {
  readonly isSelected: boolean;
  readonly selectionMode: 'none' | 'single' | 'multiple';
  readonly hasSubmenu: boolean;
}

function itemProps({ id, children, isDanger = false, href, onAction, isDisabled }: MenuItemProps) {
  const safe = safeHref(href);
  return {
    id: id ?? children,
    textValue: children,
    className: styles.item,
    'data-danger': isDanger || undefined,
    ...(safe === undefined ? {} : { href: safe }),
    ...(onAction === undefined ? {} : { onAction }),
    ...(isDisabled === undefined ? {} : { isDisabled }),
  };
}

function ItemFace({ look, state }: { readonly look: Omit<MenuItemProps, 'id'>; readonly state: ItemState }) {
  const { children, icon, leading, description, meta, kbd } = look;
  return (
    <>
      {state.selectionMode !== 'none' && (
        <span className={styles.check}>{state.isSelected && <Icon name="check" size="sm" />}</span>
      )}
      {leading ?? (icon !== undefined && <Icon name={icon} size="sm" />)}
      <span className={styles.text}>
        <Text slot="label" className={styles.label}>
          {children}
        </Text>
        {description !== undefined && (
          <Text slot="description" className={styles.description}>
            {description}
          </Text>
        )}
      </span>
      {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      {kbd !== undefined && (
        <span aria-hidden="true">
          <Kbd tone="soft">{kbd}</Kbd>
        </span>
      )}
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
  readonly children: ReactNode;
}

/** A labelled group of items in a Menu. */
export function MenuSection({ label, children }: MenuSectionProps) {
  return (
    <AriaMenuSection className={styles.section}>
      <Header className={styles.heading}>{label}</Header>
      {children}
    </AriaMenuSection>
  );
}

/** A hairline between groups of items in a Menu. */
export function MenuSeparator() {
  return <Separator className={styles.separator} />;
}
