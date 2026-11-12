import { Button as AriaButton } from 'react-aria-components';
import { closestCorners, DndContext, DragOverlay, KeyboardSensor, measuring, PointerSensor, pointerWithin, SHIFT, SortableContext, translateOf, useDroppable, useReducedMotion, useSensor, useSensors, useSortable, useUnzoom, verticalListSortingStrategy, zoomOf, type Announcements, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type KeyboardCoordinateGetter } from '../../lib/drag.ts';
import { useEffect, useRef, useState, type KeyboardEventHandler, type PointerEventHandler } from 'react';
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
  /** A short figure beside the count, such as the column's total value. */
  readonly meta?: string;
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

const SETTLE_MS = 250; // --duration-fast
const LANE = 'lane:';

/** Where a drag is: the column it started in and the column it is over. */
type DragState = { readonly from: string; readonly over?: string; readonly card: string };
type Lanes = Readonly<Record<string, ReadonlyArray<string>>>;
const lanesOf = (columns: ReadonlyArray<BoardColumn>): Lanes => Object.fromEntries(columns.map((c) => [c.id, c.cards.map((card) => card.id)]));

/** The pointer's lane first (so a drop anywhere down a lane counts), then the nearest card corners inside it. */
const collideAt = (z: number): CollisionDetection => (args) => {
  const at = args.pointerCoordinates ? { x: args.pointerCoordinates.x / z, y: args.pointerCoordinates.y / z } : null;
  const within = at ? pointerWithin({ ...args, pointerCoordinates: at }) : [];
  const lane = within.find((c) => String(c.id).startsWith(LANE));
  if (!lane) return within.length ? within : closestCorners(args);
  const laneId = String(lane.id).slice(LANE.length);
  const cards = args.droppableContainers.filter((d) => d.data.current?.lane === laneId);
  const near = closestCorners({ ...args, droppableContainers: cards });
  return near.length ? near : [lane];
};

/** Keyboard steps on a board: Left and Right jump to the next open lane at the same height, Up and Down step past the card above or below. */
const boardKeys: KeyboardCoordinateGetter = (event, { context: { active, collisionRect, droppableRects, droppableContainers } }) => {
  if (!active || !collisionRect) return undefined;
  const lanes = droppableContainers.getEnabled()
    .filter((d) => d.data.current?.isLane && (droppableRects.get(d.id)?.width ?? 0) > 60)
    .map((d) => ({ id: String(d.data.current?.lane), rect: droppableRects.get(d.id) }))
    .filter((l): l is { id: string; rect: NonNullable<typeof l.rect> } => Boolean(l.rect))
    .sort((a, b) => a.rect.left - b.rect.left);
  const mid = collisionRect.left + collisionRect.width / 2;
  const here = lanes.findIndex((l) => mid >= l.rect.left && mid <= l.rect.right);
  if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    const next = lanes[(here < 0 ? 0 : here) + (event.code === 'ArrowRight' ? 1 : -1)];
    return next ? { x: next.rect.left + (next.rect.width - collisionRect.width) / 2, y: Math.max(next.rect.top, collisionRect.top) } : undefined;
  }
  if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
    const lane = lanes[here]; if (!lane) return undefined;
    const cards = droppableContainers.getEnabled()
      .filter((d) => d.id !== active.id && d.data.current?.lane === lane.id && !d.data.current?.isLane)
      .map((d) => droppableRects.get(d.id)).filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => a.top - b.top);
    const centre = collisionRect.top + collisionRect.height / 2;
    const past = event.code === 'ArrowDown' ? cards.find((r) => r.top + r.height / 2 > centre) : [...cards].reverse().find((r) => r.top + r.height / 2 < centre);
    return past ? { x: collisionRect.left, y: event.code === 'ArrowDown' ? past.bottom - collisionRect.height + 1 : past.top - 1 } : undefined;
  }
  return undefined;
};

/** A kanban board: status columns of white cards that drag between and within columns, columns that fold to a 24px rail, and counts that roll. While a card is lifted the others slide aside live, in its lane and the one it is over; the drop glides into the gap. Replaces Board. */
export function Board({ label, columns, onMove, onAdd, onToggleCollapse, onOpen, noun = 'cards' }: BoardProps) {
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef<ReadonlySet<string> | undefined>(undefined);
  const all = columns.flatMap((c) => c.cards.map((card) => card.id));
  // Cards that were not here last render drop in at the top of their column.
  const fresh = new Set(seen.current ? all.filter((id) => !seen.current?.has(id)) : []);
  useEffect(() => { seen.current = new Set(all); });

  const reduced = useReducedMotion();
  const [drag, setDrag] = useState<DragState | undefined>(undefined);
  // The live order while a card is lifted; the columns' own order otherwise.
  const [live, setLive] = useState<Lanes | undefined>(undefined);
  const lanes = live ?? lanesOf(columns);
  const laneOf = (id: string, from: Lanes = lanes): string | undefined =>
    id.startsWith(LANE) ? id.slice(LANE.length) : Object.keys(from).find((k) => from[k]?.includes(id));
  const byId = new Map(columns.flatMap((c) => c.cards.map((card) => [card.id, card] as const)));

  const boardRef = useRef<HTMLDivElement>(null);
  // The pointer moves in screen pixels; keyboard steps are already in the page's units.
  const { modifier: unzoom, zoom } = useUnzoom();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeys }),
  );

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id); const from = laneOf(id);
    if (!from) return;
    zoom.current = zoomOf(boardRef.current);
    setLive(lanesOf(columns)); setDrag({ from, card: id });
  };
  const onDragOver = (e: DragOverEvent) => {
    const id = String(e.active.id); const overId = e.over ? String(e.over.id) : undefined;
    if (!overId) return;
    setLive((cur) => {
      const now = cur ?? lanesOf(columns);
      const a = laneOf(id, now); const b = laneOf(overId, now);
      if (!a || !b || a === b) return now;
      // Crossing lanes: the card joins the lane it is over, where the pointer is (above the card it is over, or last).
      const target = now[b] ?? [];
      const at = overId.startsWith(LANE) ? target.length : Math.max(0, target.indexOf(overId));
      const rect = e.active.rect.current.translated; const overRect = e.over?.rect;
      const below = rect && overRect && !overId.startsWith(LANE) ? rect.top + rect.height / 2 > overRect.top + overRect.height / 2 : false;
      const index = below ? at + 1 : at;
      return { ...now, [a]: (now[a] ?? []).filter((x) => x !== id), [b]: [...target.slice(0, index), id, ...target.slice(index)] };
    });
    setDrag((d) => (d ? { ...d, over: laneOf(overId) } : d));
  };
  const finish = (e: DragEndEvent) => {
    const id = String(e.active.id); const overId = e.over ? String(e.over.id) : undefined;
    const now = live ?? lanesOf(columns);
    const to = laneOf(id, now); const order = to ? [...(now[to] ?? [])] : [];
    if (to && overId && !overId.startsWith(LANE) && laneOf(overId, now) === to && overId !== id) {
      // Within one lane: dnd-kit's sortable order.
      const from = order.indexOf(id); const at = order.indexOf(overId);
      order.splice(from, 1); order.splice(at, 0, id);
    }
    setLive(undefined); setDrag(undefined);
    if (!to) return;
    const before = lanesOf(columns);
    const was = laneOf(id, before);
    if (was === to && (before[to] ?? []).join() === order.join()) return;
    const i = order.indexOf(id);
    const target: BoardMove['target'] = order[i + 1] ? { id: order[i + 1] ?? '', position: 'before' } : order[i - 1] ? { id: order[i - 1] ?? '', position: 'after' } : undefined;
    onMove({ cardIds: [id], toColumnId: to, target });
    setSettled(new Set([id]));
    window.setTimeout(() => setSettled(new Set()), SETTLE_MS * 2);
  };
  const cancel = () => { setLive(undefined); setDrag(undefined); };

  const title = (id: string) => byId.get(id)?.title ?? 'card';
  const laneTitle = (id?: string) => columns.find((c) => c.id === (id ? laneOf(id) : undefined))?.title ?? '';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${title(String(active.id))}.`,
    onDragOver: ({ active, over }) => (over ? `${title(String(active.id))} is over ${laneTitle(String(over.id))}.` : `${title(String(active.id))} is not over a column.`),
    onDragEnd: ({ active, over }) => (over ? `${title(String(active.id))} dropped in ${laneTitle(String(over.id))}.` : `${title(String(active.id))} put back.`),
    onDragCancel: ({ active }) => `Moving ${title(String(active.id))} was cancelled. It is back where it was.`,
  };
  const lifted = drag ? byId.get(drag.card) : undefined;
  const source = drag && columns.find((c) => c.id === drag.from);
  return (
    <DndContext sensors={sensors} collisionDetection={collideAt(zoom.current)} measuring={measuring} modifiers={[unzoom]} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={finish} onDragCancel={cancel}
      accessibility={{ announcements, screenReaderInstructions: { draggable: 'To pick up a card, press Space or Enter on its grip. Use the arrow keys to move it, Space or Enter to drop it, Escape to put it back.' } }}>
      <div ref={boardRef} className="tf-board" role="group" aria-label={label}>
        {columns.map((col) => {
          const ids = lanes[col.id] ?? [];
          const cards = ids.map((id) => byId.get(id)).filter((c): c is BoardCard => Boolean(c));
          return (
            <KanbanColumn key={col.id} column={col} cards={cards} noun={noun} onAdd={onAdd} onToggleCollapse={onToggleCollapse} onOpen={onOpen} settled={settled} fresh={fresh}
              reduced={reduced} isOver={Boolean(drag && drag.over === col.id)} incoming={drag?.over === col.id && source && source.id !== col.id ? source : undefined} />
          );
        })}
      </div>
      <DragOverlay dropAnimation={reduced ? null : { duration: SHIFT.duration, easing: SHIFT.easing }}>
        {lifted ? <div className="tf-board__lifted"><CardBody card={lifted} /></div> : null}
      </DragOverlay>
    </DndContext>
  );
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

function KanbanColumn({ column, cards, noun, onAdd, onToggleCollapse, onOpen, settled, fresh, reduced, isOver, incoming }: {
  readonly column: BoardColumn; readonly cards: ReadonlyArray<BoardCard>; readonly noun: string; readonly onAdd?: (id: string) => void;
  readonly onToggleCollapse?: (id: string) => void; readonly onOpen?: (id: string) => void; readonly settled: ReadonlySet<string>; readonly fresh: ReadonlySet<string>;
  readonly reduced: boolean; readonly isOver: boolean; readonly incoming?: BoardColumn;
}) {
  const hue = column.hue ?? STATUS_HUE[column.status];
  const count = column.cards.length;
  const { setNodeRef } = useDroppable({ id: LANE + column.id, data: { lane: column.id, isLane: true } });

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
        {column.meta ? <span className="tf-board__meta">{column.meta}</span> : null}
        <span className="tf-board__headactions">
          {onToggleCollapse && <IconButton size="sm" label={`Collapse ${column.title}`} onPress={() => onToggleCollapse(column.id)}><ChevronsLeft size={14} strokeWidth={1.75} /></IconButton>}
          {onAdd && <IconButton size="sm" label={`Add to ${column.title}`} onPress={() => onAdd(column.id)}><Plus size={14} strokeWidth={1.75} /></IconButton>}
        </span>
      </header>
      <SortableContext id={column.id} items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className="tf-board__list" aria-label={`${column.title}, ${count} ${noun}`} data-over={isOver || undefined}>
          {cards.length === 0 ? <li className="tf-board__empty">No {noun}</li> : cards.map((card) => (
            <SortableCard key={card.id} card={card} lane={column.id} onOpen={onOpen} reduced={reduced} isSettling={settled.has(card.id)} isNew={fresh.has(card.id)} />
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

/** One card: press opens it; a drag from anywhere on it (or Space on its grip) lifts it, and it slides aside while others move. */
function SortableCard({ card, lane, onOpen, reduced, isSettling, isNew }: {
  readonly card: BoardCard; readonly lane: string; readonly onOpen?: (id: string) => void; readonly reduced: boolean; readonly isSettling: boolean; readonly isNew: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: card.id, data: { lane }, transition: reduced ? null : SHIFT });
  const style = { transform: translateOf(transform), transition: transition ?? undefined };
  return (
    // eslint-disable-next-line react/forbid-dom-props -- dnd-kit's live offset
    <li ref={setNodeRef} style={style} className={cx('tf-board__card', isSettling && 'is-settling', isNew && 'is-new')} data-dragging={isDragging || undefined}
      onPointerDown={listeners?.onPointerDown as PointerEventHandler<HTMLLIElement> | undefined}>
      <div className="tf-board__cardin">
        <button type="button" className="tf-board__open" onClick={() => onOpen?.(card.id)} aria-label={`Open ${card.title}`} />
        <CardBody card={card} />
        <button type="button" ref={setActivatorNodeRef} className="tf-board__grip" aria-label={`Move ${card.title}`} {...attributes} onKeyDown={listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined}>
          <GripVertical size={14} strokeWidth={1.75} />
        </button>
      </div>
    </li>
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
