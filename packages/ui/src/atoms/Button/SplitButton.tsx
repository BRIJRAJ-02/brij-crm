// SplitButton lives in its own file so the menu code it needs (React Aria's
// MenuTrigger, and the popover and dialog code behind it) stays out of the
// first load, which only draws plain Buttons (the toasts).
import { MenuTrigger, type PressEvent } from 'react-aria-components';
import type { ReactNode } from 'react';
import { Icon } from '../Icon/Icon.tsx';
import { SplitFrame, SplitHalf } from './Button.tsx';
import { strings } from './strings.ts';

/** Props for SplitButton: the main action, and a menu of its variants. */
export interface SplitButtonProps {
  /** The main action's label ("Save"). */
  readonly children: string;
  readonly onPress?: (event: PressEvent) => void;
  readonly variant?: 'primary' | 'secondary';
  readonly kbd?: string | readonly string[];
  /** The name of the menu half. Defaults to "More options". */
  readonly menuLabel?: string;
  /** The menu the chevron opens: a `Menu` holding the variants (Save as new view). */
  readonly menu: ReactNode;
  readonly isDisabled?: boolean;
  readonly isPending?: boolean;
}

/** A primary action with a menu of its variants beside it: Save, and Save as new view. */
export function SplitButton({
  children,
  onPress,
  variant = 'primary',
  kbd,
  menuLabel = strings.moreOptions,
  menu,
  isDisabled = false,
  isPending = false,
}: SplitButtonProps) {
  return (
    <SplitFrame>
      <SplitHalf
        half="start"
        variant={variant}
        kbd={kbd}
        onPress={onPress}
        isDisabled={isDisabled}
        isPending={isPending}
      >
        {children}
      </SplitHalf>
      <MenuTrigger>
        <SplitHalf half="end" variant={variant} label={menuLabel} isDisabled={isDisabled} isPending={isPending}>
          <Icon name="chevron-down" size="sm" />
        </SplitHalf>
        {menu}
      </MenuTrigger>
    </SplitFrame>
  );
}
