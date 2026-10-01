import { useKeyboardPlatform } from '../../provider/context.ts';
import styles from './Kbd.module.css';
import { keycapText } from './shortcuts.ts';

/** How a keycap sits: `raised` on its own, `soft` inside buttons and menu items, `onAccent` inside a primary button. */
export type KbdTone = 'raised' | 'soft' | 'onAccent';

/** Props for Kbd: one keycap's text, written with the Mac symbols ⌘ ⇧ ⌥ ↵; other keyboards see Ctrl, Shift and Alt. */
export interface KbdProps {
  /** The keys on this cap, such as `⌘K`, `ESC` or `↵`. */
  readonly children: string;
  readonly tone?: KbdTone;
}

/** A keycap that shows the shortcut for the control it sits in, after its label. ⌘ reads Ctrl on keyboards that aren't a Mac's. */
export function Kbd({ children, tone = 'raised' }: KbdProps) {
  const platform = useKeyboardPlatform();
  return (
    <kbd className={styles.root} data-tone={tone}>
      {keycapText(children, platform)}
    </kbd>
  );
}
