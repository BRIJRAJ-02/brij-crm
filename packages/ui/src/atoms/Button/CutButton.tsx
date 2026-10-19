// Brief
// Purpose: the tooltip that shows a Button's whole label when it is cut short (`tooltipWhenCut`).
// Main task: open only when the label really is cut, around the very same button element.
// Leaves out: the button itself (Button draws it); this file loads on demand, so Tooltip stays out of the first load.
import { useState, type ReactElement, type RefObject } from 'react';
import { Tooltip } from '../Tooltip/Tooltip.tsx';

/** Props for CutButton. */
export interface CutButtonProps {
  /** The whole label, shown in the tooltip. */
  readonly label: string;
  /** The class of the button's label span, measured to tell whether it is cut. */
  readonly labelClass: string;
  /** The button element, read when the tooltip would open. */
  readonly target: RefObject<HTMLButtonElement | null>;
  /** The button. */
  readonly children: ReactElement;
}

/** Wraps a Button in a Tooltip that opens only while its label is cut short. Button loads it lazily. */
export function CutButton({ label, labelClass, target, children }: CutButtonProps) {
  const [isOpen, setOpen] = useState(false);
  const isCut = () => {
    const span = target.current?.querySelector<HTMLElement>(`.${labelClass}`);
    return span !== null && span !== undefined && span.scrollWidth > span.clientWidth;
  };
  return (
    <Tooltip
      content={label}
      isOpen={isOpen}
      onOpenChange={(next) => {
        setOpen(next && isCut());
      }}
    >
      {children}
    </Tooltip>
  );
}
