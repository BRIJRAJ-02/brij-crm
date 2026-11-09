import { Tooltip as AriaTooltip, TooltipTrigger, OverlayArrow } from 'react-aria-components';
import type { ReactElement, ReactNode } from 'react';
import { Kbd } from '../Kbd/Kbd.tsx';
import './Tooltip.css';

/** Props for Tooltip. */
export interface TooltipProps {
  /** A focusable trigger (a Button or IconButton). */
  readonly children: ReactElement;
  readonly label: ReactNode;
  readonly shortcut?: string;
  readonly placement?: 'top' | 'bottom' | 'left' | 'right';
}

/** A short ink label on hover or focus: names icon buttons and shows their shortcut. Opens after 500ms, instantly when moving between tooltips. */
export function Tooltip({ children, label, shortcut, placement = 'top' }: TooltipProps) {
  return (
    <TooltipTrigger delay={500} closeDelay={80}>
      {children}
      <AriaTooltip className="tf-tooltip tf-overlay" placement={placement} offset={8}>
        <OverlayArrow className="tf-tooltip__arrow"><svg width={8} height={8} viewBox="0 0 8 8"><path d="M0 0 L4 4 L8 0" /></svg></OverlayArrow>
        {label}{shortcut && <Kbd>{shortcut}</Kbd>}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
