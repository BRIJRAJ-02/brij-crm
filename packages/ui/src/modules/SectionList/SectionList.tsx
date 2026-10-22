import type { ReactNode } from 'react';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { SortableList, useSortableItem } from '../../lib/drag/drag.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import styles from './SectionList.module.css';
import { strings } from './strings.ts';

/** One section: its heading, what it holds, and its own actions. */
export interface SectionListSection {
  readonly id: string;
  /**
   * Its heading ("Sales"), a Card title one level under the section heading around the list. Left out for a
   * section with none, which then draws no header unless it moves or has actions.
   */
  readonly title?: string;
  /** What it holds: its rows, a LinkList (`density="compact" placement="card"`). */
  readonly content: ReactNode;
  /** At its header's end, after its grip: the section's menu (Move up and Move down, for a pointer that can't drag). */
  readonly actions?: ReactNode;
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
}

/** A section's name in what a move says and on its grip: its title, else its place ("Section 2"). */
function nameAt(sections: readonly SectionListSection[], index: number): string {
  return sections[index]?.title ?? strings.numbered(index + 1);
}

/**
 * Titled sections in an order that matters, each a Card, moving as wholes: a
 * profile's sections, each holding its own rows. With `onMove` a grip sits
 * in each section's header, before its actions; the others slide out of the
 * way as one moves, and each step is said. What a section holds keeps its own
 * keys and its own moves (a LinkList's rows move only within their section).
 */
export function SectionList({ label, sections, onMove, emptyState }: SectionListProps) {
  if (sections.length === 0) return <>{emptyState}</>;
  if (onMove === undefined || sections.length < 2) {
    return (
      <ol className={styles.root} aria-label={label}>
        {sections.map((section) => (
          <li key={section.id} className={styles.item}>
            <SectionCard section={section} />
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
      <ol className={styles.root} aria-label={label}>
        {sections.map((section, index) => (
          <MovableSection
            key={section.id}
            section={section}
            gripLabel={section.title === undefined ? strings.moveNumbered(index + 1) : strings.move(section.title)}
          />
        ))}
      </ol>
    </SortableList>
  );
}

/** One section's Card: its title, then its grip and its actions at the header's end, then what it holds. */
function SectionCard({ section, grip }: { readonly section: SectionListSection; readonly grip?: ReactNode }) {
  const actions =
    grip === undefined && section.actions === undefined ? undefined : (
      <>
        {grip}
        {section.actions}
      </>
    );
  return (
    <Card
      {...(section.title === undefined ? {} : { title: section.title })}
      {...(actions === undefined ? {} : { actions })}
    >
      {section.content}
    </Card>
  );
}

/** A section that moves: its item in the sorting list, lifted while it moves, with its grip in its header. */
function MovableSection({ section, gripLabel }: { readonly section: SectionListSection; readonly gripLabel: string }) {
  const { bind, grip } = useSortableItem(section.id);
  return (
    <li ref={bind} className={styles.item}>
      <SectionCard section={section} grip={<DragHandle label={gripLabel} drag={grip} />} />
    </li>
  );
}
