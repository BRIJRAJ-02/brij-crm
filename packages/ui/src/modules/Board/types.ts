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
  readonly cards: ListSource<BoardCard>;
  /** An archived option: shown while it has cards, and never a drop target. */
  readonly isArchived?: boolean;
}

/** A card moved: where to, and (when the board can reorder) the card it now sits before. */
export interface BoardMove {
  readonly cardId: string;
  readonly fromColumnId: string;
  readonly toColumnId: string;
  readonly beforeCardId?: string;
}
