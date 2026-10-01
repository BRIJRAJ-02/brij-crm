// The shortcut list (spec 0003, the app shell): a dialog naming every
// shortcut in use, in groups, each with its keycaps for this keyboard.
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

/** A dialog listing the shortcuts in use, in groups, each with its keycaps. The screen opens it (with ?). */
export function ShortcutHelp({ groups, isOpen, onOpenChange }: ShortcutHelpProps) {
  return (
    <Modal title={strings.title} isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className={styles.groups}>
        {groups.map((group) => (
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
