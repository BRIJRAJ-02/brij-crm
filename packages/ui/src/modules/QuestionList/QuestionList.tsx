import { Fragment, useId, type KeyboardEvent, type ReactNode } from 'react';
import { Button as AriaButton, GridList, GridListItem } from 'react-aria-components';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import type { IconName } from '../../atoms/Icon/icons.ts';
import { SortableList, SortableRowGrip } from '../../lib/drag/drag.tsx';
import { reorder } from '../../lib/reorder.ts';
import styles from './QuestionList.module.css';
import { strings } from './strings.ts';

/** One question as its closed card shows it. */
export interface QuestionListItem {
  readonly id: string;
  /**
   * `step` draws a page break rather than a question (spec 0063, AC-6303; T20, 5 November 2026): an inline header
   * on the ground, no card ("Step 2 · About you"), so the list reads as pages of question cards. It moves and is
   * announced as a question is; its end holds the caller's menu (`renderStepEnd`).
   */
  readonly kind?: 'question' | 'step';
  /** The question; empty shows "Untitled question", muted. */
  readonly label: string;
  /**
   * The answer type's name, first on the row's second line ("Short text"). Left out where a question has no type
   * of its own: a link page's FAQ, whose second line is its answer's first words (`note`).
   */
  readonly typeLabel?: string;
  /**
   * The answer type's icon, on a tile at the row's start ("type" for short text, "mail" for email). Left out
   * where there is no type: the row then begins with its grip, or with nothing when the list is read only.
   */
  readonly typeIcon?: IconName;
  readonly isRequired?: boolean;
  /** The row's second line where the question has no type: the start of its answer, on one line. */
  readonly note?: string;
  /** For a choice question: how many choices it has. */
  readonly choiceCount?: number;
  /**
   * Where its answers go, after the type on the second line: "Person › Budget band", or "Not filed". Left out
   * on a form that keeps its submissions only, where no answer is filed.
   */
  readonly filed?: string;
  /** Its Show when, last on the second line (spec 0043): "Shows when Budget is Large". Left out when it always shows. */
  readonly condition?: string;
  /**
   * How the question performs, last on the second line (spec 0063, AC-6322): "82% answered", so a weak question
   * is visible where it is edited. Left out when the form has no analytics, or when nobody reached this question:
   * a figure for a question no one has seen would say nothing about the question.
   */
  readonly stat?: string;
  /** What `stat` is of, as its tooltip: the denominator the card has no room to spell out. */
  readonly statTitle?: string;
  /** The question a publish refused: marked, and the caller keeps it open until it is fixed. */
  readonly hasProblem?: boolean;
}

/** Props for QuestionList. */
export interface QuestionListProps {
  /** The list's name, and the section's heading ("Questions"), with the count beside it. */
  readonly label: string;
  /** The section header's end: Add a question and its menu. */
  readonly actions?: ReactNode;
  /**
   * Actions shown before `actions` only where the list is wide enough (480px and up): a secondary button whose
   * action the caller's menu in `actions` also holds (a form's Add a step), so a phone keeps one primary and the
   * menu, and nothing is pushed off the row.
   */
  readonly wideActions?: ReactNode;
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
  /** Leaves the count out of the header, for a list whose rows are not questions (a form's After they send). */
  readonly isCountHidden?: boolean;
  /**
   * What sits in the gap above a row, shown while a pointer is over the gap or focus is in it: a form's "Split here"
   * between two questions of one step. Nothing for a row it returns null for.
   */
  readonly renderGap?: (id: string) => ReactNode;
  /** A step header's end: its ⋯ menu (Rename, Add logic, Merge). */
  readonly renderStepEnd?: (id: string) => ReactNode;
  /** In a step header, in place of its name while it is being renamed: a field. Undefined keeps the name. */
  readonly renderStepTitle?: (id: string) => ReactNode;
  /** A step header's name was pressed: the form builder shows that step in its preview. */
  readonly onStepPress?: (id: string) => void;
  /**
   * An open question's head, in place of its tile and two lines (T40, 5 November 2026: the question typed in the
   * header row): the caller's type menu and the question's own field. The chevron stays, as its own button that
   * closes the card. Undefined or null keeps the closed head's look.
   */
  readonly renderOpenHead?: (id: string) => ReactNode;
  /**
   * `shown` keeps each gap's action in view, quietly, rather than only on hover or focus (T39: "adding a step in
   * between feels like a find"): the cards part a little further to hold it, and touch sees it too.
   */
  readonly gaps?: 'hover' | 'shown';
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
  wideActions,
  renderFooter,
  renderFooterStart,
  isCountHidden = false,
  renderGap,
  renderStepEnd,
  renderStepTitle,
  onStepPress,
  renderOpenHead,
  gaps = 'hover',
}: QuestionListProps) {
  const headingId = useId();

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
        {/* Questions only: a step break is not one more question. */}
        {!isCountHidden && <Badge count={items.filter((item) => item.kind !== 'step').length} label={label} />}
        {(actions !== undefined || wideActions !== undefined) && (
          <span className={styles.actions}>
            {wideActions !== undefined && <span className={styles.wide}>{wideActions}</span>}
            {actions}
          </span>
        )}
      </header>
      <SortableList
        ids={items.map((item) => item.id)}
        nameOf={(id) => {
          const item = items.find((each) => each.id === id);
          return item === undefined || item.label === '' ? strings.untitled : item.label;
        }}
        onMove={(move) => {
          if (onMove === undefined) return;
          const next = reorder(items, (item) => item.id, new Set([move.id]), move.targetId, move.position);
          const index = next.findIndex((item) => item.id === move.id);
          if (index >= 0) onMove(move.id, index);
        }}
      >
        <GridList
          aria-label={label}
          items={items}
          // Rows draw again when what they show beside their item changes: which are open, and their editors.
          dependencies={[
            openIds,
            renderOpen,
            renderFooter,
            renderFooterStart,
            renderGap,
            renderStepEnd,
            renderStepTitle,
            renderOpenHead,
          ]}
          className={styles.list}
          data-gaps={gaps}
          keyboardNavigationBehavior="tab"
        >
          {(item) => {
            const name = item.label === '' ? strings.untitled : item.label;
            const isOpen = openIds.has(item.id);
            const gap = renderGap?.(item.id);
            const gapNode =
              gap === undefined || gap === null || gap === false ? null : <div className={styles.gap}>{gap}</div>;
            if (item.kind === 'step') {
              const renaming = renderStepTitle?.(item.id);
              const isRenaming = renaming !== undefined && renaming !== null && renaming !== false;
              const body = isOpen ? renderOpen(item.id) : null;
              return (
                <GridListItem
                  id={item.id}
                  textValue={name}
                  className={styles.row}
                  data-kind="step"
                  data-gap={gapNode === null ? undefined : true}
                  data-problem={item.hasProblem === true || undefined}
                >
                  {gapNode}
                  <div className={styles.stepHead}>
                    {onMove !== undefined && (
                      <span className={styles.stepHandle}>
                        <SortableRowGrip id={item.id} label={strings.move(name)} />
                      </span>
                    )}
                    {isRenaming ? (
                      <span className={styles.stepTitle}>{renaming}</span>
                    ) : (
                      <AriaButton
                        className={styles.stepToggle}
                        onPress={() => {
                          onStepPress?.(item.id);
                        }}
                      >
                        <span className={styles.stepName}>{name}</span>
                        {item.hasProblem === true && (
                          <span className={styles.problem}>
                            <Icon name="circle-alert" size="sm" />
                            {strings.hasProblem}
                          </span>
                        )}
                        {[item.note, item.condition].some((part) => part !== undefined && part !== '') && (
                          <span className={styles.stepMeta}>
                            {[item.note, item.condition]
                              .filter((part): part is string => part !== undefined && part !== '')
                              .join(strings.separator)}
                          </span>
                        )}
                      </AriaButton>
                    )}
                    {renderStepEnd !== undefined && <span className={styles.stepEnd}>{renderStepEnd(item.id)}</span>}
                  </div>
                  {body !== null && body !== undefined && body !== false && (
                    <div className={styles.stepBody}>{body}</div>
                  )}
                </GridListItem>
              );
            }
            const openHead = isOpen ? renderOpenHead?.(item.id) : undefined;
            const hasOpenHead = openHead !== undefined && openHead !== null && openHead !== false;
            return (
              <GridListItem
                id={item.id}
                textValue={name}
                className={styles.row}
                data-gap={gapNode === null ? undefined : true}
                data-open={isOpen || undefined}
                data-open-head={hasOpenHead || undefined}
                data-problem={item.hasProblem === true || undefined}
              >
                {gapNode}
                <div className={styles.head}>
                  {onMove !== undefined && (
                    <span className={styles.handle}>
                      <SortableRowGrip id={item.id} label={strings.move(name)} />
                    </span>
                  )}
                  {hasOpenHead ? (
                    <>
                      <div className={styles.openHead}>{openHead}</div>
                      {item.hasProblem === true && (
                        <span className={styles.problem}>
                          <Icon name="circle-alert" size="sm" />
                          {strings.hasProblem}
                        </span>
                      )}
                      <AriaButton
                        className={styles.close}
                        aria-expanded
                        aria-label={strings.close(name)}
                        onPress={() => {
                          onOpenChange(item.id, false);
                        }}
                      >
                        <Icon name="chevron-up" size="sm" />
                      </AriaButton>
                    </>
                  ) : (
                    <AriaButton
                      className={styles.toggle}
                      aria-expanded={isOpen}
                      onPress={() => {
                        onOpenChange(item.id, !isOpen);
                      }}
                    >
                      {item.typeIcon !== undefined && (
                        <span className={styles.tile}>
                          <Icon name={item.typeIcon} tile="gray" />
                        </span>
                      )}
                      <span className={styles.text}>
                        <span className={styles.title}>
                          <span className={styles.name} data-untitled={item.label === '' || undefined}>
                            {name}
                          </span>
                          {item.isRequired === true && <span className={styles.required}>{strings.required}</span>}
                          {item.hasProblem === true && (
                            <span className={styles.problem}>
                              <Icon name="circle-alert" size="sm" />
                              {strings.hasProblem}
                            </span>
                          )}
                        </span>
                        <span className={styles.meta}>
                          {/* Each part stays whole: a narrow column breaks the line between parts, never inside one. */}
                          {[
                            ...(item.typeLabel === undefined ? [] : [item.typeLabel]),
                            ...(item.note === undefined || item.note === '' ? [] : [item.note]),
                            ...(item.choiceCount === undefined
                              ? []
                              : [item.choiceCount === 0 ? strings.noChoices : strings.choices(item.choiceCount)]),
                            ...(item.filed === undefined ? [] : [item.filed]),
                            ...(item.condition === undefined
                              ? []
                              : [
                                  <span key="logic" className={styles.logic}>
                                    <Icon name="git-branch" size="sm" />
                                    {item.condition}
                                  </span>,
                                ]),
                            ...(item.stat === undefined
                              ? []
                              : [
                                  <span key="stat" title={item.statTitle}>
                                    {item.stat}
                                  </span>,
                                ]),
                          ].map((part, at) => (
                            // The separator stays outside the part, so its spaces are where a line may break.
                            <Fragment key={at}>
                              {at === 0 ? null : strings.separator}
                              <span className={styles.part}>{part}</span>
                            </Fragment>
                          ))}
                        </span>
                      </span>
                      <span className={styles.chevron} aria-hidden="true">
                        <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size="sm" />
                      </span>
                    </AriaButton>
                  )}
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
      </SortableList>
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
