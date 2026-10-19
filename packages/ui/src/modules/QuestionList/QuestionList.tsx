import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button as AriaButton, DropIndicator, GridList, GridListItem, useDragAndDrop } from 'react-aria-components';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Tag } from '../../atoms/Tag/Tag.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { reorder } from '../../lib/reorder.ts';
import styles from './QuestionList.module.css';
import { strings } from './strings.ts';

/** One question as its closed card shows it. */
export interface QuestionListItem {
  readonly id: string;
  /** The question; empty shows "Untitled question", muted. */
  readonly label: string;
  /** The answer type's name, shown as a Tag. */
  readonly typeLabel: string;
  readonly isRequired: boolean;
  /** For a choice question: how many choices it has. */
  readonly choiceCount?: number;
  /** Where its answers go, as a quiet line: "Person · Budget band", or "Not filed, kept with the enquiry". */
  readonly filed: string;
  /** The question a publish refused: marked, and the caller keeps it open until it is fixed. */
  readonly hasProblem?: boolean;
}

/** Props for QuestionList. */
export interface QuestionListProps {
  /** The list's name for assistive tech ("Questions"). */
  readonly label: string;
  readonly items: readonly QuestionListItem[];
  /** The questions shown open. */
  readonly openIds: ReadonlySet<string>;
  /** A card's header was pressed: open it, or close it. */
  readonly onOpenChange: (id: string, isOpen: boolean) => void;
  /** An open card's editor, under its header. */
  readonly renderOpen: (id: string) => ReactNode;
  /** A question was moved to `index` (by drag, or the keyboard). Absent: read only, with no handles. */
  readonly onMove?: (id: string, index: number) => void;
}

/**
 * QuestionList: a form's questions as cards, closed until opened. Closed, a
 * card shows its handle, the question, its answer type, Required, its
 * choices and where it is filed; the whole header opens it on press, Enter
 * or Space. Open, the editor the caller renders follows. Cards reorder by
 * the handle, with a drop line, or by the keyboard (focus the handle, Enter
 * to pick up, arrows to move, Enter to drop, Esc to cancel), and each move is
 * announced: "Budget, moved to position 3 of 6".
 */
export function QuestionList({ label, items, openIds, onOpenChange, renderOpen, onMove }: QuestionListProps) {
  const [said, setSaid] = useState('');

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    renderDropIndicator: (target) => <DropIndicator target={target} className={styles.indicator} />,
    onReorder: (event) => {
      const [moving] = [...event.keys].map(String);
      if (moving === undefined || onMove === undefined) return;
      const next = reorder(
        items,
        (item) => item.id,
        new Set([moving]),
        String(event.target.key),
        event.target.dropPosition === 'after' ? 'after' : 'before',
      );
      const index = next.findIndex((item) => item.id === moving);
      if (index < 0) return;
      onMove(moving, index);
      const item = items.find((each) => each.id === moving);
      setSaid(
        strings.moved(item === undefined || item.label === '' ? strings.untitled : item.label, index + 1, items.length),
      );
    },
  });

  // Enter in an open card's single line field never submits a form the list sits in.
  const keepEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  };

  return (
    <div className={styles.root} onKeyDownCapture={keepEnter}>
      <GridList
        aria-label={label}
        items={items}
        className={styles.list}
        keyboardNavigationBehavior="tab"
        {...(onMove === undefined ? {} : { dragAndDropHooks })}
      >
        {(item) => {
          const name = item.label === '' ? strings.untitled : item.label;
          const isOpen = openIds.has(item.id);
          return (
            <GridListItem
              id={item.id}
              textValue={name}
              className={styles.card}
              data-open={isOpen || undefined}
              data-problem={item.hasProblem === true || undefined}
            >
              <div className={styles.head}>
                {onMove !== undefined && <DragHandle label={strings.move(name)} />}
                <AriaButton
                  className={styles.toggle}
                  aria-expanded={isOpen}
                  onPress={() => {
                    onOpenChange(item.id, !isOpen);
                  }}
                >
                  <span className={styles.summary}>
                    <span className={styles.name} data-untitled={item.label === '' || undefined}>
                      {name}
                    </span>
                    <Tag>{item.typeLabel}</Tag>
                    {item.isRequired && <span className={styles.fact}>{strings.required}</span>}
                    {item.choiceCount !== undefined && (
                      <span className={styles.fact}>
                        {item.choiceCount === 0 ? strings.noChoices : strings.choices(item.choiceCount)}
                      </span>
                    )}
                    {item.hasProblem === true && (
                      <span className={styles.problem}>
                        <Icon name="circle-alert" size="sm" />
                        {strings.hasProblem}
                      </span>
                    )}
                  </span>
                  <span className={styles.filed}>{item.filed}</span>
                </AriaButton>
                <span className={styles.chevron} aria-hidden="true">
                  <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size="sm" />
                </span>
              </div>
              {isOpen && <div className={styles.body}>{renderOpen(item.id)}</div>}
            </GridListItem>
          );
        }}
      </GridList>
      <VisuallyHidden>
        <span role="status">{said}</span>
      </VisuallyHidden>
    </div>
  );
}
