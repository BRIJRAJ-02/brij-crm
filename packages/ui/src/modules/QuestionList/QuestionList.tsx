import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button as AriaButton, DropIndicator, GridList, GridListItem, useDragAndDrop } from 'react-aria-components';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { reorder } from '../../lib/reorder.ts';
import styles from './QuestionList.module.css';
import { strings } from './strings.ts';

/** One question as its closed card shows it. */
export interface QuestionListItem {
  readonly id: string;
  /** The question; empty shows "Untitled question", muted. */
  readonly label: string;
  /** The answer type's name, shown as a quiet Badge, so the question leads. */
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
  /** The list's name, and the section's heading ("Questions"), with the count beside it. */
  readonly label: string;
  /** The section header's end: Add a question and its menu. */
  readonly actions?: ReactNode;
  /** An open card's footer, at its end: Duplicate and Delete. */
  readonly renderFooter?: (id: string) => ReactNode;
  /** An open card's footer, at its start, on the same row: a choice that closes the editor, such as Required. */
  readonly renderFooterStart?: (id: string) => ReactNode;
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
export function QuestionList({
  label,
  items,
  openIds,
  onOpenChange,
  renderOpen,
  onMove,
  actions,
  renderFooter,
  renderFooterStart,
}: QuestionListProps) {
  const [said, setSaid] = useState('');
  const headingId = useId();

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
    <section className={styles.root} aria-labelledby={headingId} onKeyDownCapture={keepEnter}>
      <header className={styles.header}>
        <h2 className={styles.heading} id={headingId}>
          {label}
        </h2>
        <Badge count={items.length} label={label} />
        {actions !== undefined && <span className={styles.actions}>{actions}</span>}
      </header>
      <GridList
        aria-label={label}
        items={items}
        // Rows draw again when what they show beside their item changes: which are open, and their editors.
        dependencies={[openIds, renderOpen, renderFooter, renderFooterStart]}
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
                    <Badge text={item.typeLabel} />
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
              {isOpen && (
                <div className={styles.body}>
                  {renderOpen(item.id)}
                  <Footer start={renderFooterStart?.(item.id)} end={renderFooter?.(item.id)} />
                </div>
              )}
            </GridListItem>
          );
        }}
      </GridList>
      <VisuallyHidden>
        <span role="status">{said}</span>
      </VisuallyHidden>
    </section>
  );
}

/** An open card's last row: what `renderFooterStart` gives at its start, the card's actions at its end; nothing when both are empty. */
function Footer({ start, end }: { readonly start: ReactNode; readonly end: ReactNode }) {
  const isEmpty = (node: ReactNode) => node === undefined || node === null || node === false;
  if (isEmpty(start) && isEmpty(end)) return null;
  return (
    <div className={styles.footer}>
      <span className={styles.footerStart}>{start}</span>
      {!isEmpty(end) && <span className={styles.footerEnd}>{end}</span>}
    </div>
  );
}
