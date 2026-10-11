// The shortcut list (spec 0003, the app shell): a dialog naming every
// shortcut in use, in groups, each with its keycaps for this keyboard.
import { useState } from 'react';
import { Kbd } from '../../atoms/Kbd/Kbd.tsx';
import { DescriptionList } from '../../molecules/DescriptionList/DescriptionList.tsx';
import { Modal } from '../../molecules/Modal/Modal.tsx';
import styles from './ShortcutHelp.module.css';
import { strings } from './strings.ts';

/** One shortcut: what it does, and its keys, written with Mac symbols (⌘K); other keyboards see Ctrl. */
export interface Shortcut {
  readonly label: string;
  /** One keycap per key pressed together: `['⌘', 'K']`, or `['ESC']`. */
  readonly keys: readonly string[];
}

/** Shortcuts that belong together: Everywhere, In a table, On a record. */
export interface ShortcutGroup {
  readonly title: string;
  readonly shortcuts: readonly Shortcut[];
}

/** Props for ShortcutHelp. */
export interface ShortcutHelpProps {
  readonly groups: readonly ShortcutGroup[];
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/** Keys held with another: on a touch screen with no keyboard there is nothing to hold them with. */
const MODIFIERS = new Set(['⌘', '⌃', '⌥', '⇧']);

/** Whether the device is touch only, read once as the list opens (no hover, a coarse pointer). */
function isTouchOnly(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/**
 * A dialog listing the shortcuts in use, in groups, each with its keycaps.
 * The screen opens it (with ?, or from a menu); its title bar has the close
 * button. On a touch only device, shortcuts held with a modifier (⌘, ⌥, ⇧)
 * are left out, and a group left empty goes too.
 */
export function ShortcutHelp({ groups, isOpen, onOpenChange }: ShortcutHelpProps) {
  const [isTouch] = useState(isTouchOnly);
  const shown = isTouch
    ? groups
        .map((group) => ({
          ...group,
          shortcuts: group.shortcuts.filter((shortcut) => !shortcut.keys.some((key) => MODIFIERS.has(key))),
        }))
        .filter((group) => group.shortcuts.length > 0)
    : groups;
  return (
    <Modal title={strings.title} isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className={styles.groups}>
        {shown.map((group) => (
          <section key={group.title} className={styles.group}>
            <h3 className={styles.title}>{group.title}</h3>
            <DescriptionList
              items={group.shortcuts.map((shortcut) => ({
                term: shortcut.label,
                description: (
                  <span className={styles.keys}>
                    {shortcut.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                ),
              }))}
            />
          </section>
        ))}
      </div>
    </Modal>
  );
}
