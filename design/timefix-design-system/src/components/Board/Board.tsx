import { Button as AriaButton, DropIndicator, GridList, GridListItem, isTextDropItem, useDragAndDrop, type DropTarget } from 'react-aria-components';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Calendar, ChevronsLeft, GripVertical, Plus } from 'lucide-react';
import { IconButton } from '../Button/Button.tsx';
import { AvatarGroup } from '../Avatar/Avatar.tsx';
import { Count, Tag, STATUS_HUE, type Hue } from '../Tag/Tag.tsx';
import { NumberRoll } from '../Motion/Motion.tsx';
import { StatusIcon, type StatusShape } from '../Icon/StatusIcon.tsx';
import { cx } from '../../lib/cx.ts';
import { formatDate, relativeDayLabel } from '../../lib/format.ts';
import './Board.css';

/** A card: tags, a title, a two-line description, then people and a date under a hairline. */
export interface BoardCard {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<{ readonly label: string; readonly hue: Hue }>;
  readonly people?: ReadonlyArray<string>;
  /** A due or close date; the card words it (Today, Tomorrow, else "13 Nov"). */
  readonly date?: Date;
}

/** A column: one option of the grouping status, its cards in order. */
export interface BoardColumn {
  readonly id: string;
  readonly title: string;
  readonly status: StatusShape;
  readonly hue?: Hue;
  readonly cards: ReadonlyArray<BoardCard>;
  readonly isCollapsed?: boolean;
}

/** A finished drag: these cards now sit in `toColumnId`, before or after `target` (or at the end). */
export interface BoardMove {
  readonly cardIds: ReadonlyArray<string>;
  readonly toColumnId: string;
  readonly target?: { readonly id: string; readonly position: 'before' | 'after' };
}

/** Applies a BoardMove to columns and returns new columns; the consumer's optimistic update. */
export function moveCards(columns: ReadonlyArray<BoardColumn>, move: BoardMove): ReadonlyArray<BoardColumn> {
  const moving = columns.flatMap((c) => c.cards).filter((card) => move.cardIds.includes(card.id));
  const without = columns.map((c) => ({ ...c, cards: c.cards.filter((card) => !move.cardIds.includes(card.id)) }));
  return without.map((c) => {
    if (c.id !== move.toColumnId) return c;
    const at = move.target ? c.cards.findIndex((card) => card.id === move.target?.id) : -1;
    const index = at < 0 ? c.cards.length : move.target?.position === 'after' ? at + 1 : at;
    return { ...c, cards: [...c.cards.slice(0, index), ...moving, ...c.cards.slice(index)] };
  });
}

/** Props for Board. */
export interface BoardProps {
  readonly label: string;
  readonly columns: ReadonlyArray<BoardColumn>;
  readonly onMove: (move: BoardMove) => void;
  readonly onAdd?: (columnId: string) => void;
  readonly onToggleCollapse?: (columnId: string) => void;
  readonly onOpen?: (cardId: string) => void;
  /** Plural noun for the cards ("deals"). */
  readonly noun?: string;
}

const CARD_TYPE = 'application/x-timefix-card';
/** How long a column waits after its last drop target is left before it stops being "the target" (moving between slots exits then enters). */
const EXIT_GRACE_MS = 60;

/** Where a drag is: the column it started in and the column it is over. */
type DragState = { readonly from: string; readonly over?: string };
const SETTLE_MS = 250; // --duration-fast

/** A kanban board: status columns of white cards that drag between and within columns, columns that fold to a 24px rail, and counts that roll. Replaces Board. */
export function Board({ label, columns, onMove, onAdd, onToggleCollapse, onOpen, noun = 'cards' }: BoardProps) {
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef<ReadonlySet<string> | undefined>(undefined);
  const all = columns.flatMap((c) => c.cards.map((card) => card.id));
  // Cards that were not here last render drop in at the top of their column.
  const fresh = new Set(seen.current ? all.filter((id) => !seen.current?.has(id)) : []);
  useEffect(() => { seen.current = new Set(all); });

  const [drag, setDrag] = useState<DragState | undefined>(undefined);
  const exitTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(exitTimer.current), []);
  const transit = {
    start: (from: string) => setDrag({ from }),
    end: () => { window.clearTimeout(exitTimer.current); setDrag(undefined); },
    enter: (id: string) => { window.clearTimeout(exitTimer.current); setDrag((d) => (d ? { ...d, over: id } : d)); },
    exit: (id: string) => {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = window.setTimeout(() => setDrag((d) => (d && d.over === id ? { from: d.from } : d)), EXIT_GRACE_MS);
    },
  };
  const move = (m: BoardMove) => {
    onMove(m);
    transit.end();
    setSettled(new Set(m.cardIds));
    window.setTimeout(() => setSettled(new Set()), SETTLE_MS * 2);
  };
  const source = drag && columns.find((c) => c.id === drag.from);
  return (
    <div className="tf-board" role="group" aria-label={label}>
      {columns.map((col) => (
        <KanbanColumn key={col.id} column={col} noun={noun} onMove={move} onAdd={onAdd} onToggleCollapse={onToggleCollapse} onOpen={onOpen} settled={settled} fresh={fresh}
          transit={transit} incoming={drag?.over === col.id && source && source.id !== col.id ? source : undefined} />
      ))}
    </div>
  );
}

/** The drag handlers a column reports to the board, so the target column can say where the card came from. */
interface Transit {
  readonly start: (from: string) => void;
  readonly end: () => void;
  readonly enter: (id: string) => void;
  readonly exit: (id: string) => void;
}

/** Jira's "Lead → Qualified": crossfades over a column's header while a card from another column is over it. */
function TransitHeader({ from, to }: { readonly from?: BoardColumn; readonly to: BoardColumn }) {
  const last = useRef(from);
  if (from) last.current = from;
  const shown = from ?? last.current;
  return (
    <div className="tf-board__transit" data-open={from ? true : undefined} aria-hidden="true">
      {shown && (
        <>
          <span className={`tf-board__status tf-board__status--${shown.hue ?? STATUS_HUE[shown.status]}`}><StatusIcon shape={shown.status} size={14} /></span>
          <span className="tf-board__transit-name">{shown.title}</span>
          <ArrowRight className="tf-board__transit-arrow" size={14} strokeWidth={1.75} />
          <span className={`tf-board__status tf-board__status--${to.hue ?? STATUS_HUE[to.status]}`}><StatusIcon shape={to.status} size={14} /></span>
          <span className="tf-board__transit-name tf-board__transit-name--to">{to.title}</span>
        </>
      )}
    </div>
  );
}

function KanbanColumn({ column, noun, onMove, onAdd, onToggleCollapse, onOpen, settled, fresh, transit, incoming }: {
  readonly column: BoardColumn; readonly noun: string; readonly onMove: (m: BoardMove) => void; readonly onAdd?: (id: string) => void;
  readonly onToggleCollapse?: (id: string) => void; readonly onOpen?: (id: string) => void; readonly settled: ReadonlySet<string>; readonly fresh: ReadonlySet<string>;
  readonly transit: Transit; readonly incoming?: BoardColumn;
}) {
  const hue = column.hue ?? STATUS_HUE[column.status];
  const count = column.cards.length;
  const targetOf = (t: DropTarget): BoardMove['target'] =>
    t.type === 'item' && t.dropPosition !== 'on' ? { id: String(t.key), position: t.dropPosition } : undefined;
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((k) => ({ [CARD_TYPE]: String(k), 'text/plain': column.cards.find((c) => c.id === k)?.title ?? String(k) })),
    acceptedDragTypes: [CARD_TYPE],
    getDropOperation: () => 'move',
    onDragStart: () => transit.start(column.id),
    onDragEnd: () => transit.end(),
    onDropEnter: () => transit.enter(column.id),
    onDropExit: () => transit.exit(column.id),
    onReorder: (e) => onMove({ cardIds: [...e.keys].map(String), toColumnId: column.id, target: targetOf(e.target) }),
    onInsert: async (e) => {
      const ids = await Promise.all(e.items.filter(isTextDropItem).map((it) => it.getText(CARD_TYPE)));
      onMove({ cardIds: ids, toColumnId: column.id, target: targetOf(e.target) });
    },
    onRootDrop: async (e) => {
      const ids = await Promise.all(e.items.filter(isTextDropItem).map((it) => it.getText(CARD_TYPE)));
      onMove({ cardIds: ids, toColumnId: column.id });
    },
    renderDropIndicator: (target) => <DropIndicator target={target} className="tf-board__slot" />,
    renderDragPreview: (items) => {
      const card = column.cards.find((c) => c.id === items[0]?.[CARD_TYPE]);
      return <div className="tf-board__preview"><div className="tf-board__lifted">{card ? <CardBody card={card} /> : null}</div></div>;
    },
  });

  if (column.isCollapsed) {
    return (
      <section className={cx('tf-board__col', 'is-collapsed')} aria-label={column.title}>
        <AriaButton className="tf-board__rail" aria-label={`Expand ${column.title}, ${count} ${noun}`} onPress={() => onToggleCollapse?.(column.id)}>
          <span className={`tf-board__status tf-board__status--${hue}`}><StatusIcon shape={column.status} size={14} /></span>
          <Count><NumberRoll value={count} /></Count>
          <span className="tf-board__railtitle">{column.title}</span>
        </AriaButton>
      </section>
    );
  }
  return (
    <section className="tf-board__col" aria-label={column.title} data-incoming={incoming ? true : undefined}>
      <header className="tf-board__head">
        <TransitHeader from={incoming} to={column} />
        <span className={`tf-board__status tf-board__status--${hue}`}><StatusIcon shape={column.status} size={16} /></span>
        <h3 className="tf-board__title">{column.title}</h3>
        <Count><NumberRoll value={count} /></Count>
        <span className="tf-board__headactions">
          {onToggleCollapse && <IconButton size="sm" label={`Collapse ${column.title}`} onPress={() => onToggleCollapse(column.id)}><ChevronsLeft size={14} strokeWidth={1.75} /></IconButton>}
          {onAdd && <IconButton size="sm" label={`Add to ${column.title}`} onPress={() => onAdd(column.id)}><Plus size={14} strokeWidth={1.75} /></IconButton>}
        </span>
      </header>
      <GridList
        aria-label={`${column.title}, ${count} ${noun}`}
        items={column.cards}
        dragAndDropHooks={dragAndDropHooks}
        onAction={onOpen ? (k) => onOpen(String(k)) : undefined}
        className="tf-board__list"
        renderEmptyState={() => <div className="tf-board__empty">No {noun}</div>}
      >
        {(card) => (
          <GridListItem id={card.id} textValue={card.title} className={cx('tf-board__card', settled.has(card.id) && 'is-settling', fresh.has(card.id) && 'is-new')}>
            <div className="tf-board__cardin">
              <AriaButton slot="drag" className="tf-board__grip" aria-label={`Move ${card.title}`}><GripVertical size={14} strokeWidth={1.75} /></AriaButton>
              <CardBody card={card} />
            </div>
          </GridListItem>
        )}
      </GridList>
    </section>
  );
}

/** A card's date: Yesterday, Today and Tomorrow by name, other days as "13 Nov". */
function dateLabel(d: Date): string {
  const rel = relativeDayLabel(d);
  return rel === 'Today' || rel === 'Tomorrow' || rel === 'Yesterday' ? rel : formatDate(d);
}

function CardBody({ card }: { readonly card: BoardCard }) {
  return (
    <div className="tf-board__body">
      {card.tags && card.tags.length > 0 && (
        <div className="tf-board__tags">{card.tags.map((t) => <Tag key={t.label} size="sm" hue={t.hue}>{t.label}</Tag>)}</div>
      )}
      <p className="tf-board__cardtitle">{card.title}</p>
      {card.description && <p className="tf-board__desc">{card.description}</p>}
      {(card.people?.length || card.date) && (
        <div className="tf-board__foot">
          {card.people && card.people.length > 0 ? <AvatarGroup names={card.people} size={20} max={3} /> : <span />}
          {card.date && <span className="tf-board__date"><Calendar size={14} strokeWidth={1.75} />{dateLabel(card.date)}</span>}
        </div>
      )}
    </div>
  );
}
