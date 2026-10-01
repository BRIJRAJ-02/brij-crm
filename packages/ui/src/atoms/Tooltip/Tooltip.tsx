import { useRef, type ReactElement, type RefObject } from 'react';
import { useFocusable, useFocusVisible } from 'react-aria';
import {
  Tooltip as AriaTooltip,
  TooltipTrigger,
  TooltipTriggerStateContext,
  type TooltipTriggerState,
} from 'react-aria-components';
import styles from './Tooltip.module.css';

/**
 * How long a pointer rests before a tooltip opens (spec 0003): quick for cut
 * text and icon buttons, slow enough that crossing a table flashes nothing.
 * While one is showing, the next opens at once, and keyboard focus opens it
 * at once. A host that shows one tooltip for many elements waits the same.
 */
export const TOOLTIP_DELAY_MS = 500;

/** Where a tooltip sits against its trigger. */
export type TooltipPlacement = 'top' | 'bottom' | 'start' | 'end';

/** Props for Tooltip. */
export interface TooltipProps {
  /** One short line: the full text of something cut short, an exact time, why a control is disabled. */
  readonly content: string;
  /**
   * What it describes. A library control (Button) works as it is; plain text
   * passes `isTextTrigger` so hovering it shows the tooltip.
   */
  readonly children: ReactElement;
  readonly placement?: TooltipPlacement;
  /** The trigger is plain text, not a control: it shows on hover, and on focus when something focuses it on purpose (a grid cell). */
  readonly isTextTrigger?: boolean;
  readonly isDisabled?: boolean;
  /** Opens it from outside, as a grid does for the focused cell; pair it with `onOpenChange` so hover still works. */
  readonly isOpen?: boolean;
  readonly onOpenChange?: (isOpen: boolean) => void;
}

/**
 * Plain text as a trigger: it takes the trigger's hover and focus props, and
 * focuses on purpose only (tabIndex -1), so text adds no tab stop. React Aria's
 * `Focusable` would warn that text has no interactive role, which is the point
 * here, so this calls the hook it is built on.
 */
function TextTrigger({ children }: { readonly children: ReactElement }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { focusableProps } = useFocusable({ excludeFromTabOrder: true }, ref);
  return (
    <span ref={ref} className={styles.trigger} {...focusableProps}>
      {children}
    </span>
  );
}

/**
 * A short label that appears after a pause on hover, or at once on keyboard
 * focus. It adds to a control's name and never replaces it: an icon only
 * button still has its own `label`.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  isTextTrigger = false,
  isDisabled,
  isOpen,
  onOpenChange,
}: TooltipProps) {
  const { isFocusVisible } = useFocusVisible();
  return (
    <TooltipTrigger
      delay={TOOLTIP_DELAY_MS}
      {...(isDisabled === undefined ? {} : { isDisabled })}
      {...(isOpen === undefined ? {} : { isOpen })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
    >
      {isTextTrigger ? <TextTrigger>{children}</TextTrigger> : children}
      <AriaTooltip
        className={styles.root}
        placement={placement}
        offset={0}
        data-opened-by={isFocusVisible ? 'keyboard' : 'pointer'}
      >
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}

/** Props for AnchoredTooltip. */
export interface AnchoredTooltipProps {
  readonly content: string;
  /** The element it points at; set it before opening. */
  readonly triggerRef: RefObject<Element | null>;
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly placement?: TooltipPlacement;
}

/**
 * Tooltip's look, opened from outside against an element that has no trigger
 * of its own: one shared by a table's hundreds of cells, so each cell mounts
 * none. The host decides when it opens (after `TOOLTIP_DELAY_MS` of resting,
 * or at once on keyboard focus) and renders it only while it is open.
 */
export function AnchoredTooltip({ content, triggerRef, onOpenChange, placement = 'top' }: AnchoredTooltipProps) {
  const { isFocusVisible } = useFocusVisible();
  // React Aria's tooltip reads its state from a trigger; with none, this is it: open until the host closes it.
  const state: TooltipTriggerState = {
    isOpen: true,
    shouldSkipAnimation: false,
    open: () => undefined,
    close: () => {
      onOpenChange?.(false);
    },
  };
  return (
    <TooltipTriggerStateContext value={state}>
      <AriaTooltip
        className={styles.root}
        triggerRef={triggerRef}
        isOpen
        placement={placement}
        offset={0}
        data-opened-by={isFocusVisible ? 'keyboard' : 'pointer'}
        {...(onOpenChange === undefined ? {} : { onOpenChange })}
      >
        {content}
      </AriaTooltip>
    </TooltipTriggerStateContext>
  );
}
