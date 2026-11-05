import { useContext, useId, type ReactNode } from 'react';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { SortableList, useSortableItem } from '../../lib/drag/drag.tsx';
import { Card, CardTitleLevel } from '../../molecules/Card/Card.tsx';
import styles from './SectionList.module.css';
import { strings } from './strings.ts';

/** One section: its heading, what it holds, and its own actions. */
export interface SectionListSection {
  readonly id: string;
  /**
   * Its heading ("Sales"), one level under the section heading around the list. Left out for a section with none,
   * which then draws no header unless it moves or has actions.
   */
  readonly title?: string;
  /** A Skeleton in the title's place while what the section is called is on its way, so the head keeps its height. */
  readonly isTitleLoading?: boolean;
  /** Quiet words after its title: what it holds ("5 items", a menu section's count). */
  readonly description?: string;
  /** What it holds: its rows, a LinkList (`density="media"`, or `density="compact" placement="card"`). */
  readonly content: ReactNode;
  /**
   * At its header's end, always there: the section's menu (Move up and Move down, for a pointer that can't drag, and
   * whatever `quietActions` does, for a finger).
   */
  readonly actions?: ReactNode;
  /**
   * Before `actions`, after its grip, waiting with the grip for the pointer or focus, so a list of sections stays calm
   * (Edit). They simply stand there where there is no hover.
   */
  readonly quietActions?: ReactNode;
  /**
   * Folds the section to its header (a menu's section, after checklabs' category): with `onExpandedChange`, the
   * title is a disclosure with a chevron before it that turns as it opens, and what it holds slides shut.
   */
  readonly isExpanded?: boolean;
  readonly onExpandedChange?: (isExpanded: boolean) => void;
}

/** Props for SectionList. */
export interface SectionListProps {
  /** What the sections are, for screen readers ("Sections on your profile"). */
  readonly label: string;
  readonly sections: readonly SectionListSection[];
  /**
   * The sections move as wholes: a grip in each one's header, dragged, or Space on it, the arrows and Space again,
   * and a drop calls this with the section's id and its new index. Left out, or with one section, no grips.
   */
  readonly onMove?: (id: string, toIndex: number) => void;
  /** Shown with no sections at all: usually an EmptyState. */
  readonly emptyState?: ReactNode;
  /**
   * `cards` (the default): each section a Card. `groups`: a heading and its rows parted by a hairline, with no frame
   * of their own, for sections inside a section's Card (a menu's sub sections), so a card never holds a card.
   */
  readonly variant?: 'cards' | 'groups';
  /**
   * Titles start on the column a LinkList's tiles start on (`density="media"` with grips), a chevron or nothing in
   * the column before them, so a title, its rows and the title's sub sections read down one edge.
   */
  readonly isTitleInset?: boolean;
}

/** A section's name in what a move says and on its grip: its title, else its place ("Section 2"). */
function nameAt(sections: readonly SectionListSection[], index: number): string {
  return sections[index]?.title ?? strings.numbered(index + 1);
}

/** How a list draws each of its sections. */
interface SectionLook {
  readonly variant: 'cards' | 'groups';
  readonly isTitleInset: boolean;
}

/**
 * Titled sections in an order that matters, moving as wholes: each a Card, or (`groups`) a heading and rows inside
 * one. With `onMove` a grip sits in each section's header, before its actions; the others slide out of the way as one
 * moves, and each step is said. What a section holds keeps its own keys and its own moves (a LinkList's rows move only
 * within their section).
 */
export function SectionList({
  label,
  sections,
  onMove,
  emptyState,
  variant = 'cards',
  isTitleInset = false,
}: SectionListProps) {
  const look: SectionLook = { variant, isTitleInset };
  if (sections.length === 0) return <>{emptyState}</>;
  if (onMove === undefined || sections.length < 2) {
    return (
      <ol className={styles.root} data-variant={variant} aria-label={label}>
        {sections.map((section) => (
          <li key={section.id} className={styles.item} data-variant={variant}>
            <SectionBlock section={section} look={look} />
          </li>
        ))}
      </ol>
    );
  }
  const ids = sections.map((section) => section.id);
  return (
    <SortableList
      ids={ids}
      nameOf={(id) => nameAt(sections, ids.indexOf(id))}
      onMove={(move) => {
        onMove(move.id, move.toIndex);
      }}
    >
      <ol className={styles.root} data-variant={variant} aria-label={label}>
        {sections.map((section, index) => (
          <MovableSection
            key={section.id}
            section={section}
            look={look}
            gripLabel={section.title === undefined ? strings.moveNumbered(index + 1) : strings.move(section.title)}
          />
        ))}
      </ol>
    </SortableList>
  );
}

/**
 * One section: its header (the chevron and title, the quiet words, then the grip and actions at its end), then what
 * it holds, which slides shut when it folds. A Card, or bare in `groups`.
 */
function SectionBlock({
  section,
  look,
  grip,
}: {
  readonly section: SectionListSection;
  readonly look: SectionLook;
  readonly grip?: ReactNode;
}) {
  const bodyId = useId();
  const level = useContext(CardTitleLevel);
  const Title = level === 2 ? 'h2' : level === 4 ? 'h4' : 'h3';
  const { title, isTitleLoading = false, description, actions, quietActions, onExpandedChange, content } = section;
  const isFolding = onExpandedChange !== undefined;
  const isExpanded = !isFolding || section.isExpanded !== false;
  const hasQuiet = grip !== undefined || (quietActions !== undefined && quietActions !== null);
  const hasHead =
    title !== undefined || isTitleLoading || hasQuiet || (actions !== undefined && actions !== null) || isFolding;
  // One box, so a Card's stack of children never adds its own space between the head and what folds under it.
  const inner = (
    <div className={styles.group}>
      {hasHead && (
        <header className={styles.head} data-inset={look.isTitleInset && !isFolding ? '' : undefined}>
          <span className={styles.heading}>
            {isTitleLoading && (
              <span className={styles.titleLoading}>
                <Skeleton width="full" />
              </span>
            )}
            {isFolding ? (
              <Title className={styles.title}>
                <button
                  type="button"
                  className={styles.fold}
                  aria-expanded={isExpanded}
                  aria-controls={bodyId}
                  onClick={() => {
                    onExpandedChange(!isExpanded);
                  }}
                >
                  <span className={styles.chevron}>
                    <Icon name="chevron-right" size="sm" />
                  </span>
                  {title}
                </button>
              </Title>
            ) : (
              title !== undefined && <Title className={styles.title}>{title}</Title>
            )}
            {description !== undefined && <span className={styles.description}>{description}</span>}
          </span>
          {(hasQuiet || actions !== undefined) && (
            <span className={styles.actions}>
              {hasQuiet && (
                <span className={styles.quiet}>
                  {grip}
                  {quietActions}
                </span>
              )}
              {actions}
            </span>
          )}
        </header>
      )}
      {isFolding ? (
        <div id={bodyId} className={styles.foldBody} data-folded={isExpanded ? undefined : ''}>
          <div className={styles.foldInner}>
            <NestedLevel level={level}>{content}</NestedLevel>
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          <NestedLevel level={level}>{content}</NestedLevel>
        </div>
      )}
    </div>
  );
  return look.variant === 'groups' ? inner : <Card>{inner}</Card>;
}

/** What a section holds sits one heading level under its title, so its sub sections' titles never flatten. */
function NestedLevel({ level, children }: { readonly level: 2 | 3 | 4; readonly children: ReactNode }) {
  return <CardTitleLevel value={level === 2 ? 3 : 4}>{children}</CardTitleLevel>;
}

/** A section that moves: its item in the sorting list, lifted while it moves, with its grip in its header. */
function MovableSection({
  section,
  look,
  gripLabel,
}: {
  readonly section: SectionListSection;
  readonly look: SectionLook;
  readonly gripLabel: string;
}) {
  const { bind, grip } = useSortableItem(section.id);
  return (
    <li ref={bind} className={styles.item} data-variant={look.variant}>
      <SectionBlock section={section} look={look} grip={<DragHandle label={gripLabel} drag={grip} />} />
    </li>
  );
}
