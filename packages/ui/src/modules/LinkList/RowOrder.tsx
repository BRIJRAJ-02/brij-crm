// Brief
// Purpose: the drag wrapper around a LinkList whose rows move (`onMove`): the sorting list, and each row's grip.
// Main task: hand LinkList a grip per row, and turn a drop into the row's id and its new index.
// Leaves out: the rows themselves (LinkList draws them). LinkList takes only this file's types: a screen whose rows
// move passes the wrapper in (`rowOrder={LinkListRowOrder}`), so a page whose rows hold still (a public profile's
// links) never loads the drag wrapper and dnd-kit with it. (A lazy import did the same on 23 Oct 2026, but its chunk split the
// files every page loads first: 41 of them past the budget's 40, and 1.4 kB more gzipped on each page.)
import type { ReactNode } from 'react';
import { SortableList, SortableRowGrip } from '../../lib/drag/drag.tsx';

/** Draws one row's grip, named for screen readers ("Move Intro call"); a row that can't move gets none. */
export type RowGrip = (id: string, label: string, isDisabled: boolean) => ReactNode;

/** Props for RowOrder. */
export interface RowOrderProps {
  /** The rows' ids, in their order. */
  readonly ids: readonly string[];
  /** A row's name in what a move says ("Intro call, moved to position 2 of 3."). */
  readonly nameOf: (id: string) => string;
  /** A row was dropped at `toIndex` among `ids`. */
  readonly onMove: (id: string, toIndex: number) => void;
  /** The list, drawn with each row's grip. */
  readonly children: (grip: RowGrip) => ReactNode;
}

/** The grip of one row, inside the row React Aria renders (see `SortableRowGrip`). */
const grip: RowGrip = (id, label, isDisabled) => <SortableRowGrip id={id} label={label} isDisabled={isDisabled} />;

/** The sorting list around a LinkList's rows, handed to LinkList as its `rowOrder` by a screen whose rows move. */
export function RowOrder({ ids, nameOf, onMove, children }: RowOrderProps) {
  return (
    <SortableList
      ids={ids}
      nameOf={nameOf}
      onMove={(move) => {
        onMove(move.id, move.toIndex);
      }}
    >
      {children(grip)}
    </SortableList>
  );
}
