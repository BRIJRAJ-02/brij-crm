// The board's shapes: its cards, its columns and a move, as the screen gives
// and hears them.
import type { RecordRefDisplay } from '@crm/contracts/values';
import type { Hue } from '../../hue.ts';
import type { ListSource } from '../../lib/list-source.ts';

/** One card: a record, its values and their display shapes by attribute id, and why it can't move, if it can't. */
export interface BoardCard {
  readonly id: string;
  readonly record: RecordRefDisplay;
  readonly values: Readonly<Record<string, unknown>>;
  readonly displays?: Readonly<Record<string, unknown>>;
  /** Set when this card can't be moved: shown in its tooltip, and it has no handle. */
  readonly readOnlyReason?: string;
}

/** One column: an option of the grouping attribute. */
export interface BoardColumn {
  readonly id: string;
  readonly title: string;
  readonly hue?: Hue;
  /** Every card in the column, loaded or not, from the screen. */
  readonly count: number;
  /** The count is a floor (a filtered count past its cap): it shows as "10,000+". */
  readonly isCountAtLeast?: boolean;
  /**
   * The column's total of the field the view totals ("$42,300", the CRM flow pass), worked out by the screen across
   * every card in the column; "…" while it is read. Absent, nothing shows.
   */
  readonly total?: string;
  readonly cards: ListSource<BoardCard>;
  /** An archived option: shown while it has cards, and never a drop target. */
  readonly isArchived?: boolean;
  /**
   * Narrow while it holds no card (the "No <field>" column, as Linear and Attio keep it out of the way): its
   * title runs down a slim strip with its count, and it opens to full width while a card moves, to take a drop.
   */
  readonly isCollapsedWhenEmpty?: boolean;
  /** Never a drop target, for this reason, shown while a card is moving (a required field's "No <field>" column). */
  readonly refusesDrop?: { readonly reason: string };
}

/**
 * The "+ Add stage" column at the board's end: what it says ("Add stage", "Add option"), and what makes a column of
 * the name typed. It settles once the column is made (the field clears for the next one) or rejects (the name stays,
 * and the screen says why).
 */
export interface BoardAddColumn {
  readonly label: string;
  readonly onAdd: (title: string) => Promise<void>;
}

/** A card moved: where to, and (when the board can reorder) the card it now sits before. */
export interface BoardMove {
  readonly cardId: string;
  readonly fromColumnId: string;
  readonly toColumnId: string;
  readonly beforeCardId?: string;
}
