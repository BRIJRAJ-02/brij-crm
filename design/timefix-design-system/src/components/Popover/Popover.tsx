import { Popover as AriaPopover, type PopoverProps as AriaPopoverProps, Dialog, DialogTrigger, Button as AriaButton, Link, SearchField, Input, PopoverContext, useSlottedContext } from 'react-aria-components';
import type { ReactNode } from 'react';
import { Info, Search } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import './Popover.css';

/**
 * The filled field every picker trigger wears (Select, ComboBox, DatePicker, TimeField, the hex field): grey at rest, no border;
 * white with a 1px accent edge and a 2px accent-border ring while focused or open; a danger edge when invalid.
 */
export const PICKER_FIELD = 'tf-pickfield';
/** The 13px label over a picker field, its grey help line and its red error line. */
export const PICKER_LABEL = 'tf-pickfield-label';
/** The grey help line under a picker field. */
export const PICKER_HELP = 'tf-pickfield-help';
/** The red error line under a picker field. */
export const PICKER_ERROR = 'tf-pickfield-error';

/** How wide a popover is: its content, a menu (240 or the trigger's width), at least the trigger's width, or a fixed panel. */
export type PopoverWidth = 'content' | 'menu' | 'trigger' | 'panel';

/** Props for Popover: React Aria's popover plus our width and an optional dialog name. */
export interface PopoverProps extends Omit<AriaPopoverProps, 'children' | 'className'> {
  readonly children: ReactNode;
  readonly width?: PopoverWidth;
  /** Names the content as a dialog. Give it for anything that isn't a Menu or ListBox. */
  readonly label?: string;
  /** Drops the 6px inner padding (a calendar or a grid that pads itself). */
  readonly flush?: boolean;
  readonly className?: string;
}

/**
 * The one floating surface every menu, select, picker and help bubble opens in: raised, 20px corners, shadow-md, 6px padding.
 * It grows from its trigger (transitions.dev menu dropdown: 250ms in from 0.97, 150ms out to 0.99), origin taken from React Aria's anchor point.
 */
export function Popover({ children, width = 'content', label, flush = false, className, placement, ...rest }: PopoverProps) {
  // A submenu takes React Aria's side placement; everything else opens below its trigger's start.
  const isSubmenu = useSlottedContext(PopoverContext)?.trigger === 'SubmenuTrigger';
  const place = placement ?? (isSubmenu ? undefined : 'bottom start');
  return (
    <AriaPopover {...rest} {...(place ? { placement: place } : {})} className={cx('tf-popover', 'tf-overlay', `tf-popover--${width}`, flush && 'tf-popover--flush', className)}>
      {label !== undefined ? <Dialog className="tf-popover__dialog" aria-label={label}>{children}</Dialog> : children}
    </AriaPopover>
  );
}

/** Props for InfoTip. */
export interface InfoTipProps {
  /** What it explains, as the label beside it says it; the button is named "About <label>". */
  readonly label: string;
  /** One or two plain sentences. */
  readonly children: ReactNode;
  readonly href?: string;
  readonly linkLabel?: string;
  readonly placement?: AriaPopoverProps['placement'];
}

/** A small (i) beside a label that needs a word of help. Opens on press (so phones can open it) a short popover with a sentence and a link. */
export function InfoTip({ label, children, href, linkLabel = 'Learn more', placement = 'bottom start' }: InfoTipProps) {
  return (
    <DialogTrigger>
      <AriaButton className="tf-infotip" aria-label={`About ${label}`}>
        <Info size={14} strokeWidth={1.75} aria-hidden="true" />
      </AriaButton>
      <Popover placement={placement} label={`About ${label}`} className="tf-infotip__pop" offset={6}>
        <p className="tf-infotip__text">{children}</p>
        {href !== undefined && <Link className="tf-infotip__link" href={href} target="_blank" rel="noopener noreferrer">{linkLabel}</Link>}
      </Popover>
    </DialogTrigger>
  );
}

/** Props for PopoverSearch. */
export interface PopoverSearchProps {
  readonly placeholder: string;
  readonly autoFocus?: boolean;
}

/** The filter box at the top of a popover list (Linear's "Move to…"): a search icon and a bare input over a hairline. Put it inside an Autocomplete, which owns its text. */
export function PopoverSearch({ placeholder, autoFocus = true }: PopoverSearchProps) {
  return (
    <SearchField className="tf-popover__search" aria-label={placeholder} autoFocus={autoFocus}>
      <Search size={14} strokeWidth={1.75} aria-hidden="true" />
      <Input className="tf-popover__search-input" placeholder={placeholder} />
    </SearchField>
  );
}
