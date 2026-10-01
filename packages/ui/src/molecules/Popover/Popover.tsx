import type { ReactNode, RefObject } from 'react';
import { useFocusVisible } from 'react-aria';
import { Dialog, Popover as AriaPopover, type PopoverProps as AriaPopoverProps } from 'react-aria-components';
import styles from './Popover.module.css';

/** How wide a popover is: its content (the default), a menu (240px, or the trigger's width if wider), or exactly its trigger's width (a select). */
export type PopoverWidth = 'content' | 'menu' | 'trigger';

/** Where a popover sits against its trigger, as React Aria names it ("bottom start", "top", "end"). */
export type PopoverPlacement = NonNullable<AriaPopoverProps['placement']>;

/** Props for Popover. */
export interface PopoverProps {
  /** A Menu or ListBox, or any content; give `label` when it is plain content, so it opens as a named dialog. */
  readonly children: ReactNode;
  /** The name of the dialog that holds plain content ("Date", "More tags"). Leave it out for a menu or list. */
  readonly label?: string;
  readonly placement?: PopoverPlacement;
  readonly width?: PopoverWidth;
  /** The element it opens from, when that isn't a trigger React Aria already knows (a context menu's row). */
  readonly triggerRef?: RefObject<Element | null>;
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
  /** Leaves the page around it usable: no dismiss on outside press, no focus trap. For autocomplete lists. */
  readonly isNonModal?: boolean;
}

/**
 * The floating surface menus, selects, pickers and "+N" lists open in. It grows
 * from its trigger and fades out faster than it came; opened from the
 * keyboard it appears at once. Esc closes it and puts focus back on the trigger.
 */
export function Popover({
  children,
  label,
  placement = 'bottom start',
  width = 'content',
  triggerRef,
  isOpen,
  onOpenChange,
  isNonModal,
}: PopoverProps) {
  // Read on every render, so the popover knows how it was opened when it mounts.
  const { isFocusVisible } = useFocusVisible();
  return (
    <AriaPopover
      className={styles.root}
      placement={placement}
      offset={0}
      data-width={width}
      data-opened-by={isFocusVisible ? 'keyboard' : 'pointer'}
      {...(triggerRef === undefined ? {} : { triggerRef })}
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      {...(isNonModal === undefined ? {} : { isNonModal })}
    >
      {label === undefined ? (
        children
      ) : (
        <Dialog className={styles.dialog} aria-label={label}>
          {children}
        </Dialog>
      )}
    </AriaPopover>
  );
}
