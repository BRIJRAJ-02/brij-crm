import { useRef, type ReactElement } from 'react';
import { useFocusable, useFocusVisible } from 'react-aria';
import { Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';
import styles from './Tooltip.module.css';

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
export function Tooltip({ content, children, placement = 'top', isTextTrigger = false, isDisabled }: TooltipProps) {
  const { isFocusVisible } = useFocusVisible();
  return (
    <TooltipTrigger {...(isDisabled === undefined ? {} : { isDisabled })}>
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
