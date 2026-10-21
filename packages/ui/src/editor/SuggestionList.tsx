// The lists the editor opens under what is being typed: members after "@"
// and blocks after "/". Each is the library's Popover (non modal), drawn like
// a Menu's rows. Focus stays in the editor while one is open (the editor's
// keys move the highlight and pick), so it is a listbox the editor points
// into with aria-activedescendant, not a Menu that takes focus. One list for
// both, since their rows differ only in what they hold: a member's Avatar,
// name and email; a block's icon, name and markdown.
import type { ReactNode, RefObject } from 'react';
import { Popover } from '../molecules/Popover/Popover.tsx';
import styles from './SuggestionList.module.css';

/** One row of a suggestion list. */
export interface SuggestionRow {
  readonly key: string;
  /** The Avatar or icon before the name. */
  readonly leading: ReactNode;
  readonly label: string;
  /** A second line of meaning after the name, in the secondary colour: a member's email. */
  readonly detail?: string;
  /** A quiet hint at the row's end: the markdown that makes a block. */
  readonly hint?: string;
}

/** Props for SuggestionList. */
export interface SuggestionListProps {
  /** The `@query` or `/query` the list opens under. */
  readonly anchorRef: RefObject<Element | null>;
  /** The listbox's id, which the editor names in aria-controls. */
  readonly id: string;
  /** The listbox's name ("Members", "Blocks"). */
  readonly label: string;
  readonly rows: readonly SuggestionRow[];
  /** The highlighted row, which Enter picks. */
  readonly activeIndex: number;
  /** What the list says with no rows: still searching, or nothing matches. */
  readonly emptyText: string;
  readonly onPick: (index: number) => void;
  /** The pointer moved onto a row. */
  readonly onHighlight: (index: number) => void;
}

/** An option's id: the listbox's id and the row's place. */
export function suggestionOptionId(listId: string, index: number): string {
  return `${listId}-option-${String(index)}`;
}

/** Rows to pick from under the text; the highlighted one takes the hover fill. */
export function SuggestionList({
  anchorRef,
  id,
  label,
  rows,
  activeIndex,
  emptyText,
  onPick,
  onHighlight,
}: SuggestionListProps) {
  return (
    <Popover triggerRef={anchorRef} isOpen isNonModal width="menu" placement="bottom start">
      {rows.length === 0 ? (
        // No rows: not a listbox with no options, but a polite word on why (still searching, or nothing matches).
        <div className={styles.root} id={id} role="status" aria-label={label}>
          <div className={styles.empty}>{emptyText}</div>
        </div>
      ) : (
        <div className={styles.root} role="listbox" id={id} aria-label={label}>
          {rows.map((row, index) => (
            <div
              key={row.key}
              id={suggestionOptionId(id, index)}
              className={styles.option}
              role="option"
              aria-selected={index === activeIndex}
              data-active={index === activeIndex || undefined}
              tabIndex={-1}
              // The editor keeps focus (and its selection) while a row is picked with the pointer.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseEnter={() => {
                onHighlight(index);
              }}
              onClick={() => {
                onPick(index);
              }}
              onKeyDown={() => undefined}
            >
              {row.leading}
              <span className={styles.name}>{row.label}</span>
              {row.detail !== undefined && <span className={styles.detail}>{row.detail}</span>}
              {row.hint !== undefined && (
                <span className={styles.hint} aria-hidden="true">
                  {row.hint}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}
