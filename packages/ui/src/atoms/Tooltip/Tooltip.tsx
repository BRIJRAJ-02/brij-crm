import type { ReactElement } from 'react';
import { useFocusVisible } from 'react-aria';
import { Focusable, Tooltip as AriaTooltip, TooltipTrigger } from 'react-aria-components';
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
 * A short label that appears after a pause on hover, or at once on keyboard
 * focus. It adds to a control's name and never replaces it: an icon only
 * button still has its own `label`.
 */
export function Tooltip({ content, children, placement = 'top', isTextTrigger = false, isDisabled }: TooltipProps) {
  const { isFocusVisible } = useFocusVisible();
  return (
    <TooltipTrigger {...(isDisabled === undefined ? {} : { isDisabled })}>
      {isTextTrigger ? (
        <Focusable>
          {/* Focusable on purpose only (tabIndex -1): text adds no tab stop. */}
          <span className={styles.trigger} tabIndex={-1}>
            {children}
          </span>
        </Focusable>
      ) : (
        children
      )}
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
