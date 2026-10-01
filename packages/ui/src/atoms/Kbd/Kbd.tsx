import styles from './Kbd.module.css';

/** How a keycap sits: `raised` on its own, `soft` inside buttons and menu items, `onAccent` inside a primary button. */
export type KbdTone = 'raised' | 'soft' | 'onAccent';

/** Props for Kbd: one keycap's text, using the symbols ⌘ ⇧ ⌥ ↵. */
export interface KbdProps {
  /** The keys on this cap, such as `⌘K`, `ESC` or `↵`. */
  readonly children: string;
  readonly tone?: KbdTone;
}

/** A keycap that shows the shortcut for the control it sits in, after its label. */
export function Kbd({ children, tone = 'raised' }: KbdProps) {
  return (
    <kbd className={styles.root} data-tone={tone}>
      {children}
    </kbd>
  );
}
