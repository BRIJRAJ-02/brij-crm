import { arraySource, Board, type BoardCard, type BoardMove, type FieldAttribute } from '@crm/ui';
import { type DemoDeal, STAGES } from '../data.ts';
import { ViewHeader } from '../ViewHeader/ViewHeader.tsx';
import styles from './DealsView.module.css';

/** Props for DealsView. */
export interface DealsViewProps {
  readonly deals: readonly DemoDeal[];
  readonly onMove: (dealId: string, stageId: string) => void;
}

/** The deal's value, the one field each card shows. */
const AMOUNT: FieldAttribute = {
  id: 'amount',
  name: 'Amount',
  type: 'currency',
  defaultCurrency: 'USD',
  allowMultiple: false,
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
};

/** A deal as the board's card. */
const toCard = (deal: DemoDeal): BoardCard => ({
  id: deal.id,
  record: { objectId: 'deals', recordId: deal.id, name: deal.name, kind: 'other' },
  values: { amount: { amount: String(deal.amount), currency: 'USD' } },
});

/** The live demo's Deals: the library's Board by stage, with real drag and drop (pointer or keyboard). */
export function DealsView({ deals, onMove }: DealsViewProps) {
  const columns = STAGES.map((stage) => {
    const cards = deals.filter((deal) => deal.stageId === stage.id).map(toCard);
    return {
      id: stage.id,
      title: stage.title,
      hue: stage.hue,
      count: cards.length,
      cards: arraySource(cards, (card) => card.id),
    };
  });
  return (
    <div className={styles.root}>
      <ViewHeader icon="kanban" hue="orange" title="Deals" count={deals.length} />
      <div className={styles.board}>
        <Board
          label="Deals by stage"
          columns={columns}
          cardFields={[AMOUNT]}
          showEmptyColumns
          onMove={(move: BoardMove) => {
            onMove(move.cardId, move.toColumnId);
          }}
        />
      </div>
    </div>
  );
}
