import {
  Menu as AriaMenu, type MenuProps as AriaMenuProps, MenuItem as AriaMenuItem, type MenuItemProps as AriaMenuItemProps,
  MenuSection as AriaMenuSection, type MenuSectionProps as AriaMenuSectionProps, MenuTrigger as AriaMenuTrigger, type MenuTriggerProps,
  SubmenuTrigger as AriaSubmenuTrigger, type SubmenuTriggerProps, Header, Separator, Text, Autocomplete, useFilter,
  RootMenuTriggerStateContext, type Key, type Selection,
} from 'react-aria-components';
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { Kbd } from '../Kbd/Kbd.tsx';
import { Popover, PopoverSearch, type PopoverProps } from '../Popover/Popover.tsx';
import './Menu.css';

/** How long a picked option's tick shows before its menu closes. */
export const CLOSE_AFTER_PICK_MS = 120;

/** Closes a menu that isn't driven by a MenuTrigger (a ContextMenu). */
const MenuCloseContext = createContext<(() => void) | undefined>(undefined);

/** Returns a function that closes the open menu (and its parents) ~120ms later, so the picked tick is seen drawing first. */
function useCloseAfterPick(): () => void {
  const root = useContext(RootMenuTriggerStateContext);
  const closeOwn = useContext(MenuCloseContext);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => (root ? root.close() : closeOwn?.()), CLOSE_AFTER_PICK_MS);
  };
}

/** Props shared by the selection wrappers. */
type PickProps = { readonly selectionMode?: 'none' | 'single' | 'multiple'; readonly onSelectionChange?: (keys: Selection) => void };
function usePickProps({ selectionMode, onSelectionChange }: PickProps) {
  const closeLater = useCloseAfterPick();
  if (selectionMode === undefined || selectionMode === 'none') return {};
  return {
    shouldCloseOnSelect: false,
    onSelectionChange: (keys: Selection) => {
      onSelectionChange?.(keys);
      if (selectionMode === 'single') closeLater();
    },
  };
}

/** Wires a trigger (a Button or IconButton) to the Menu after it. The trigger stays pressed while the menu is open. */
export function MenuTrigger(props: MenuTriggerProps) {
  return <AriaMenuTrigger {...props} />;
}

/** Wires a MenuItem to the Menu after it, opening it to the side on hover, → or Enter. */
export function SubmenuTrigger(props: SubmenuTriggerProps) {
  return <AriaSubmenuTrigger {...props} delay={120} />;
}

/** Props for MenuList: React Aria's menu with an optional filter box. */
export interface MenuListProps<T> extends Omit<AriaMenuProps<T>, 'className' | 'shouldCloseOnSelect'> {
  /** Adds a filter box at the top (Linear's "Move to…"), filtering items by their text. */
  readonly filterPlaceholder?: string;
  /** A step inside a panel that goes on to another step (FilterBar's field, then operator): picking doesn't close the panel. */
  readonly keepOpen?: boolean;
}

/** The bare list of a menu, for use inside a surface you already have. Most code wants Menu. */
export function MenuList<T extends object>({ filterPlaceholder, selectionMode, onSelectionChange, renderEmptyState, keepOpen = false, ...rest }: MenuListProps<T>) {
  const pick = usePickProps({ selectionMode, onSelectionChange });
  const { contains } = useFilter({ sensitivity: 'base' });
  const list = (
    <AriaMenu<T>
      {...rest}
      {...pick}
      selectionMode={selectionMode}
      shouldCloseOnSelect={keepOpen ? false : undefined}
      className="tf-menu"
      renderEmptyState={renderEmptyState ?? (() => <div className="tf-menu__empty">No matches</div>)}
    />
  );
  if (filterPlaceholder === undefined) return list;
  return (
    <Autocomplete filter={contains}>
      <PopoverSearch placeholder={filterPlaceholder} />
      {list}
    </Autocomplete>
  );
}

/** Props for Menu. */
export interface MenuProps<T> extends MenuListProps<T> {
  readonly placement?: PopoverProps['placement'];
  readonly width?: PopoverProps['width'];
}

/** A list of actions or choices in our Popover. Put it after a trigger inside MenuTrigger or SubmenuTrigger. Single choices tick, then close 120ms later. */
export function Menu<T extends object>({ placement, width = 'menu', ...rest }: MenuProps<T>) {
  return (
    <Popover width={width} {...(placement ? { placement } : {})}>
      <MenuList<T> {...rest} />
    </Popover>
  );
}

/** Props for MenuItem. */
export interface MenuItemProps<T> extends Omit<AriaMenuItemProps<T>, 'children' | 'className'> {
  readonly children: ReactNode;
  /** A 16px Lucide icon, an Avatar or a StatusIcon before the label. */
  readonly icon?: ReactNode;
  /** A grey line under the label. */
  readonly description?: ReactNode;
  /** One shortcut, shown as a keycap at the end ("⌘D"). */
  readonly kbd?: string;
  /** A small tag after the label (a "Pro" Tag), or a count. */
  readonly badge?: ReactNode;
  /** Red label and icon: deletes, removes, cancels. Keep it last, under a separator. */
  readonly isDanger?: boolean;
}

/** One row of a menu: 36px, icon, label, optional description, badge, shortcut; a check when its section picks; a chevron when it opens a submenu. */
export function MenuItem<T extends object>({ children, icon, description, kbd, badge, isDanger = false, textValue, ...rest }: MenuItemProps<T>) {
  return (
    <AriaMenuItem<T>
      {...rest}
      textValue={textValue ?? (typeof children === 'string' ? children : undefined)}
      className={cx('tf-menu__item', description !== undefined && 'tf-menu__item--tall', isDanger && 'tf-menu__item--danger')}
    >
      {({ selectionMode, hasSubmenu }) => (
        <>
          {icon !== undefined && <span className="tf-menu__icon" aria-hidden="true">{icon}</span>}
          <span className="tf-menu__text">
            <Text slot="label" className="tf-menu__label">{children}</Text>
            {description !== undefined && <Text slot="description" className="tf-menu__desc">{description}</Text>}
          </span>
          {badge}
          {kbd !== undefined && <Kbd>{kbd}</Kbd>}
          {selectionMode !== 'none' && (
            <svg className="tf-menu__check" width={16} height={16} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" pathLength={1} />
            </svg>
          )}
          {hasSubmenu && <ChevronRight className="tf-menu__chev" size={14} strokeWidth={1.75} aria-hidden="true" />}
        </>
      )}
    </AriaMenuItem>
  );
}

/** Props for MenuSection. */
export interface MenuSectionProps<T> extends Omit<AriaMenuSectionProps<T>, 'className' | 'shouldCloseOnSelect' | 'children'> {
  /** A small grey heading over the group. */
  readonly title?: string;
  readonly children: ReactNode;
}

/** A group of items with an optional heading. Give it `selectionMode` for a group of choices (Sort by): a single choice ticks then closes; multiple stays open. */
export function MenuSection<T extends object>({ title, children, selectionMode, onSelectionChange, ...rest }: MenuSectionProps<T>) {
  const pick = usePickProps({ selectionMode, onSelectionChange });
  return (
    <AriaMenuSection<T> {...rest} {...pick} selectionMode={selectionMode} className="tf-menu__section">
      {title !== undefined && <Header className="tf-menu__header">{title}</Header>}
      {children}
    </AriaMenuSection>
  );
}

/** A hairline between groups of a menu. */
export function MenuSeparator() {
  return <Separator className="tf-menu__sep" />;
}

/** Props for ContextMenu. */
export interface ContextMenuProps {
  /** The row (or card) that opens the menu on right-click, Shift+F10 or the menu key. */
  readonly children: ReactNode;
  /** MenuItems, MenuSections and MenuSeparators. */
  readonly items: ReactNode;
  /** Names the menu for screen readers ("Actions for Priya Raman"). */
  readonly label: string;
  readonly onAction?: (key: Key) => void;
}

/** A right-click menu for a row or card. It opens at the pointer (or under the focused row from the keyboard), and the row stays washed while it is open. */
export function ContextMenu({ children, items, label, onAction }: ContextMenuProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [point, setPoint] = useState<{ readonly x: number; readonly y: number } | undefined>(undefined);
  const close = () => setPoint(undefined);
  const openAtPointer = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setPoint({ x: e.clientX, y: e.clientY });
  };
  const openFromKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
    e.preventDefault();
    const r = (e.target as HTMLElement).getBoundingClientRect();
    setPoint({ x: r.left + 12, y: r.bottom });
  };
  return (
    <div className="tf-ctx" data-open={point ? true : undefined} onContextMenu={openAtPointer} onKeyDown={openFromKeys}>
      {children}
      <span ref={anchor} className="tf-ctx__anchor" style={point ? { left: point.x, top: point.y } : undefined} aria-hidden="true" />
      <MenuCloseContext.Provider value={close}>
        <Popover triggerRef={anchor} isOpen={point !== undefined} onOpenChange={(open) => { if (!open) close(); }} placement="bottom start" offset={2} width="menu">
          <MenuList aria-label={label} autoFocus="first" onAction={(key) => { onAction?.(key); close(); }} onClose={close}>
            {items}
          </MenuList>
        </Popover>
      </MenuCloseContext.Provider>
    </div>
  );
}
