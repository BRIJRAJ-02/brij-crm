// What a board card shows: the record's avatar and name, its handle (or a
// lock that says why it can't move), then the view's card fields through
// their one display on the card surface.
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { DragHandle } from '../../atoms/DragHandle/DragHandle.tsx';
import { LockReason } from '../../atoms/Tooltip/LockReason.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import type { FieldAttribute } from '../../fields/types.ts';
import { isEmptyValue } from '../../fields/values.ts';
import styles from './KanbanCard.module.css';
import { strings } from './strings.ts';
import type { BoardCard } from './types.ts';

/** Props for KanbanCard. */
export interface KanbanCardProps {
  readonly card: BoardCard;
  readonly fields: readonly FieldAttribute[];
  /** The board lets cards move: draw the handle, unless this card is locked. */
  readonly canMove: boolean;
}

/**
 * A read only card's content: the handle to move it, the record's avatar and
 * name, and each card field that has a value. A locked card has a lock whose
 * tooltip says why, reachable by keyboard, in place of its handle.
 */
export function KanbanCard({ card, fields, canMove }: KanbanCardProps) {
  const { record } = card;
  const shown = fields.filter((attribute) => !isEmptyValue(card.values[attribute.id]));
  return (
    <span className={styles.root}>
      <span className={styles.head}>
        <Avatar
          name={record.name}
          id={record.recordId}
          size="xs"
          shape={record.kind === 'person' ? 'circle' : 'square'}
          isDecorative
          {...(record.imageSrc === undefined ? {} : { src: record.imageSrc })}
          {...(record.hue === undefined ? {} : { hue: record.hue })}
        />
        <span className={styles.name}>{record.name}</span>
        {card.readOnlyReason !== undefined && <LockReason reason={card.readOnlyReason} />}
        <DragHandle label={strings.move(record.name)} isDisabled={!canMove || card.readOnlyReason !== undefined} />
      </span>
      {shown.length > 0 && (
        <span className={styles.fields}>
          {shown.map((attribute) => {
            const display = card.displays?.[attribute.id];
            return (
              <span key={attribute.id} className={styles.field}>
                <VisuallyHidden>{`${attribute.name}: `}</VisuallyHidden>
                <AttributeDisplay
                  attribute={attribute}
                  value={card.values[attribute.id] as never}
                  surface="card"
                  {...(display === undefined ? {} : { display: display as never })}
                />
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}
