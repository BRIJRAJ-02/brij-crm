import { Kbd } from '../Kbd/Kbd.tsx';
import { TooltipFrame, type TooltipProps } from './Tooltip.tsx';

/** Props for ShortcutTooltip: Tooltip's, and the control's shortcut. */
export interface ShortcutTooltipProps extends TooltipProps {
  /**
   * The control's shortcut, as a keycap after the line ("Search ⌘K"), written with Mac symbols: icon buttons teach
   * their keys this way. A library Button inside states it as its `aria-keyshortcuts` by itself.
   */
  readonly kbd: string;
}

/**
 * A Tooltip with the control's shortcut as a keycap after its line ("Search ⌘K"). Its own component, not a prop
 * of Tooltip's: Tooltip is drawn on many pages that hold no keycap (the hosted form among them), and importing Kbd
 * there moved the keycap and its stylesheet out of the Button's chunk into one every page's first load fetches.
 */
export function ShortcutTooltip({ kbd, ...props }: ShortcutTooltipProps) {
  return <TooltipFrame {...props} kbd={kbd} keycap={<Kbd tone="onInverse">{kbd}</Kbd>} />;
}
