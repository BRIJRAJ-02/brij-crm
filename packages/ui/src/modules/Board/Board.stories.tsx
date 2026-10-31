import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { arraySource } from '../../lib/list-source.ts';
import { SAMPLE_STAGES } from '../../workbench/field-samples.ts';
import { SAMPLE_IDS } from '../../workbench/sample-ids.ts';
import { sampleColumns, sampleRowAt } from '../../workbench/grid-samples.ts';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Board } from './Board.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { LoadingTimingContext } from '../../provider/useDelayedLoading.ts';
import type { BoardCard, BoardColumn, BoardMove } from './types.ts';

const CARD_FIELDS = sampleColumns(9)
  .map((column) => column.attribute)
  .filter((attribute) => ['ARR', 'Owner', 'Next step'].includes(attribute.name));

const STAGE_IDS = SAMPLE_IDS.stage;
const STAGE_OF = [
  STAGE_IDS.lead,
  STAGE_IDS.qualified,
  STAGE_IDS.proposal,
  STAGE_IDS.won,
  STAGE_IDS.lead,
  STAGE_IDS.qualified,
  STAGE_IDS.lead,
  STAGE_IDS.proposal,
  STAGE_IDS.legacy,
];

/** Nine sample companies, each in a stage; the fifth is locked. */
const CARDS: readonly (BoardCard & { readonly stage: string })[] = STAGE_OF.map((stage, index) => {
  const row = sampleRowAt(index);
  return {
    id: row.id,
    stage,
    record: { objectId: SAMPLE_IDS.companies, recordId: row.id, name: String(row.values.name), kind: 'company' },
    values: row.values,
    displays: row.displays,
    ...(index === 4 ? { readOnlyReason: 'You can view this deal but not change it.' } : {}),
    // The first two carry open comment threads.
    ...(index < 2 ? { openThreads: index + 1 } : {}),
  };
});

interface SampleProps {
  readonly onMove?: (move: BoardMove) => void;
  readonly isReorderable?: boolean;
  readonly isReadOnly?: boolean;
  readonly status?: LoadStatus;
  readonly onRetry?: () => void;
  readonly startShowingEmpty?: boolean;
  /** A "No Stage" column first, empty, which stays a slim strip. */
  readonly withNoValue?: boolean;
  readonly onAddCard?: (columnId: string) => void;
  /** Columns fold into strips, held by the story as the screen keeps them per view. */
  readonly canCollapse?: boolean;
  /** Columns folded when it opens. */
  readonly startCollapsed?: readonly string[];
  /** "+ Add stage" at the end: a name typed makes a column (one taken is refused). */
  readonly canAddColumn?: boolean;
  /** The card whose record is open in the panel beside the board. */
  readonly activeId?: string;
  /** A press or Enter on a card: its record's page. */
  readonly onOpen?: (card: BoardCard) => void;
  /** Each card's "Open in panel" button and Space on a card: the record beside the board. */
  readonly onOpenPanel?: (card: BoardCard) => void;
}

/** The board holding its own cards, as the data layer would: a move rewrites the card's stage. */
function SampleBoard({
  onMove,
  isReorderable,
  isReadOnly,
  status,
  onRetry,
  startShowingEmpty = false,
  withNoValue = false,
  onAddCard,
  canCollapse = false,
  startCollapsed = [],
  canAddColumn = false,
  activeId,
  onOpen,
  onOpenPanel,
}: SampleProps) {
  const [cards, setCards] = useState(CARDS);
  const [showEmpty, setShowEmpty] = useState(startShowingEmpty);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(startCollapsed));
  const [added, setAdded] = useState<readonly string[]>([]);
  const columns: readonly BoardColumn[] = [
    ...(withNoValue ? [{ id: 'none', title: 'No Stage', isArchived: false, isCollapsedWhenEmpty: true }] : []),
    ...SAMPLE_STAGES.map((stage) => ({ id: stage.id, title: stage.label, hue: stage.hue, isArchived: stage.archived })),
    { id: 'lost', title: 'Lost', hue: 'red' as const, isArchived: false },
    ...added.map((title) => ({ id: `added-${title}`, title, hue: 'gray' as const, isArchived: false })),
  ].map((column) => {
    const inColumn = cards.filter((card) => card.stage === column.id);
    return { ...column, count: inColumn.length, cards: arraySource<BoardCard>(inColumn, (card) => card.id) };
  });
  return (
    <Stage height="grid">
      <Board
        label="Deals by stage"
        columns={columns}
        cardFields={CARD_FIELDS}
        showEmptyColumns={showEmpty}
        onShowEmptyColumnsChange={setShowEmpty}
        {...(isReorderable === undefined ? {} : { isReorderable })}
        {...(isReadOnly === undefined ? {} : { isReadOnly })}
        {...(status === undefined ? {} : { status })}
        {...(onRetry === undefined ? {} : { onRetry })}
        {...(onAddCard === undefined ? {} : { onAddCard })}
        {...(activeId === undefined ? {} : { activeId })}
        {...(onOpen === undefined ? {} : { onOpen })}
        {...(onOpenPanel === undefined ? {} : { onOpenPanel })}
        {...(canCollapse
          ? {
              collapsedIds: collapsed,
              onCollapsedChange: (columnId: string, isCollapsed: boolean) => {
                setCollapsed((was) => {
                  const next = new Set(was);
                  if (isCollapsed) next.add(columnId);
                  else next.delete(columnId);
                  return next;
                });
              },
            }
          : {})}
        {...(canAddColumn
          ? {
              addColumn: {
                label: 'Add stage',
                onAdd: (title: string) =>
                  columns.some((column) => column.title.toLowerCase() === title.toLowerCase())
                    ? Promise.resolve('A stage already has this name.')
                    : Promise.resolve().then(() => {
                        setAdded((was) => [...was, title]);
                        return undefined;
                      }),
              },
            }
          : {})}
        onMove={(move) => {
          setCards((previous) =>
            previous.map((card) => (card.id === move.cardId ? { ...card, stage: move.toColumnId } : card)),
          );
          onMove?.(move);
        }}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/Board',
  component: SampleBoard,
} satisfies Meta<typeof SampleBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Deals by stage: a column per status, the archived one while it still has a card, and the empty one hidden. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Deals by stage' })).toBeInTheDocument();
    await expect(canvas.getByRole('grid', { name: /Lead/ })).toBeInTheDocument();
    await expect(canvas.getByRole('grid', { name: /Legacy/ })).toBeInTheDocument();
    await expect(canvas.queryByRole('grid', { name: /Lost/ })).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '1 hidden column' })).toBeInTheDocument();
  },
};

/** By keyboard: Enter on the grip picks a card up, the right arrow moves it a column at a time, Enter drops it, and focus comes back to its grip. */
export const MoveByKeyboard: Story = {
  args: { onMove: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const lead = canvas.getByRole('grid', { name: /Lead/ });
    const name = String(sampleRowAt(0).values.name);
    await userEvent.tab();
    await expect(within(lead).getAllByRole('row')[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    const handle = canvas.getByRole('button', { name: `Move ${name}` });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    // Lifted: focus waits on the move itself, away from the grid's own arrow keys.
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('region', { name: /Qualified/ })).toHaveAttribute('data-over'));
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('region', { name: /Proposal/ })).toHaveAttribute('data-over'));
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(args.onMove).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'company-0', fromColumnId: STAGE_IDS.lead, toColumnId: STAGE_IDS.proposal }),
      ),
    );
    await waitFor(() =>
      expect(within(canvas.getByRole('grid', { name: /Proposal/ })).getByText(name)).toBeInTheDocument(),
    );
    // Focus follows the card to its new column.
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-key', 'company-0'));
  },
};

/** A card holding keyboard focus shows its grip, the keyboard's way to move it; the card beside it keeps its grip quiet. */
export const GripOnKeyboardFocus: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const lead = canvas.getByRole('grid', { name: /Lead/ });
    await userEvent.tab();
    const [focused, other] = within(lead).getAllByRole('row');
    await expect(focused).toHaveFocus();
    const gripOf = (row: HTMLElement | undefined) =>
      within(row ?? document.body).getByRole('button', { name: /^Move / }).parentElement ?? row;
    const opacity = (element: Element | null | undefined) =>
      element === null || element === undefined ? '' : getComputedStyle(element).opacity;
    // Only where a pointer can hover is the grip quiet at rest; a touch screen always shows it.
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      await settleAnimations();
      await waitFor(() => expect(opacity(gripOf(focused))).toBe('1'));
      await expect(opacity(gripOf(other))).toBe('0');
    }
  },
};

/** Each column's head has a "+" naming its column; the archived column has none. */
export const AddCard: Story = {
  args: { onAddCard: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add to Qualified' }));
    await expect(args.onAddCard).toHaveBeenCalledWith(STAGE_IDS.qualified);
    await expect(canvas.queryByRole('button', { name: 'Add to Legacy' })).not.toBeInTheDocument();
  },
};

/** A locked card has a lock in place of its grip, says why, and a pointer can't pick it up. */
export const LockedCard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    const name = String(sampleRowAt(4).values.name);
    await expect(canvas.queryByRole('button', { name: `Move ${name}` })).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'You can view this deal but not change it.' })).toBeInTheDocument();
    await expect(canvas.queryByText('Archived. Cards can’t move here.')).not.toBeInTheDocument();
  },
};

/** The card whose record is open beside the board is tinted and marked current; cards with open threads carry a comment mark and count. */
export const OpenCardAndComments: Story = {
  args: { activeId: CARDS[1]?.id ?? '' },
  play: async ({ canvas }) => {
    const first = String(sampleRowAt(0).values.name);
    const second = String(sampleRowAt(1).values.name);
    const open = canvas.getByRole('row', { name: new RegExp(second) });
    await expect(open.querySelector('[aria-current="true"]')).not.toBeNull();
    await expect(open).toHaveTextContent('2 open comment threads');
    const other = canvas.getByRole('row', { name: new RegExp(first) });
    await expect(other.querySelector('[aria-current]')).toBeNull();
    await expect(other).toHaveTextContent('1 open comment thread');
  },
};

/**
 * A card opens as the table's name does: a press or Enter opens its page, and its hover "Open in panel" button or
 * Space opens it beside the board. A drag past a few pixels moves the card and opens nothing.
 */
export const OpenPageOrPanel: Story = {
  args: { onOpen: fn(), onOpenPanel: fn() },
  play: async ({ args, canvas, userEvent }) => {
    const name = String(sampleRowAt(0).values.name);
    const card = canvas.getByRole('row', { name: new RegExp(name) });
    await userEvent.click(within(card).getByText(name));
    await expect(args.onOpen).toHaveBeenCalledTimes(1);
    await expect(args.onOpenPanel).not.toHaveBeenCalled();
    await userEvent.hover(card);
    await userEvent.click(within(card).getByRole('button', { name: 'Open in panel' }));
    await expect(args.onOpenPanel).toHaveBeenCalledTimes(1);
    await expect(args.onOpen).toHaveBeenCalledTimes(1);
    card.focus();
    await userEvent.keyboard(' ');
    await expect(args.onOpenPanel).toHaveBeenCalledTimes(2);
    await userEvent.keyboard('{Enter}');
    await expect(args.onOpen).toHaveBeenCalledTimes(2);
  },
};

/** The grouping attribute is read only: no card has a handle. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.queryAllByRole('button', { name: /^Move / })).toHaveLength(0);
  },
};

/**
 * Showing empty columns brings back Lost, with nothing in it: a short dashed drop zone, its column no taller than
 * its head and the zone. Hiding them again is View settings' choice, so the board shows no button for it.
 */
export const EmptyColumns: Story = {
  args: { startShowingEmpty: true },
  play: async ({ canvas }) => {
    const lost = canvas.getByRole('grid', { name: /Lost/ });
    await expect(within(lost).getByText('No cards')).toBeInTheDocument();
    const column = canvas.getByRole('region', { name: /Lost/ });
    await expect(column.getBoundingClientRect().height).toBeLessThan(160);
    await expect(canvas.queryByRole('button', { name: 'Hide empty columns' })).not.toBeInTheDocument();
  },
};

/** An empty "No Stage" column is a slim strip with its title and count, out of the way until a card moves. */
export const CollapsedNoValue: Story = {
  args: { startShowingEmpty: true, withNoValue: true },
  play: async ({ canvas }) => {
    const strip = canvas.getByRole('region', { name: /No Stage/ });
    await expect(within(strip).queryByRole('grid')).not.toBeInTheDocument();
    await expect(strip.getBoundingClientRect().width).toBeLessThan(80);
    await expect(within(strip).getByText(/^0 cards$/)).toBeInTheDocument();
  },
};

/** The width every column takes, read from its token, so a skeleton column can be held to a real one. */
function columnWidth(element: Element): number {
  const probe = document.createElement('div');
  probe.style.inlineSize = 'var(--size-board-column)';
  element.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

/** The board is still coming: three columns at a real column's width, each a head and its cards, with their bars. */
export const Loading: Story = {
  args: { status: 'loading' },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('Loading the board')).toBeInTheDocument();
    const columns = canvasElement.querySelectorAll('[data-skeleton]');
    await expect(columns).toHaveLength(3);
    const width = columnWidth(canvasElement);
    for (const column of columns) await expect(column.getBoundingClientRect().width).toBeCloseTo(width, 0);
    await expect(columns[0]?.querySelector('[data-width]')).not.toBeNull();
  },
};

/** Before the loading delay: the columns' space is held, with no surface, card boxes or bars, so a fast load flashes nothing. */
export const LoadingBeforeDelay: Story = {
  args: { status: 'loading' },
  parameters: { crm: { screenshot: false } },
  decorators: [
    (Story) => (
      <LoadingTimingContext value={{ delayMs: 60_000, minimumMs: 0 }}>
        <Story />
      </LoadingTimingContext>
    ),
  ],
  play: async ({ canvasElement }) => {
    const columns = canvasElement.querySelectorAll('[data-skeleton]');
    await expect(columns).toHaveLength(3);
    const width = columnWidth(canvasElement);
    for (const column of columns) {
      await expect(column.getBoundingClientRect().width).toBeCloseTo(width, 0);
      await expect(column).toHaveAttribute('data-waiting');
      await expect(column.querySelector('[data-width]')).toBeNull();
    }
  },
};

/** While a card moves, the archived column says it can't take it, and Esc puts the card back. */
export const ArchivedRefuses: Story = {
  args: { onMove: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const name = String(sampleRowAt(0).values.name);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    const handle = canvas.getByRole('button', { name: `Move ${name}` });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    // Lifted: focus waits on the move itself, away from the grid's own arrow keys.
    await waitFor(() => expect(handle).not.toHaveFocus());
    await waitFor(() => expect(canvas.getByText('Archived. Cards can’t move here.')).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByText('Archived. Cards can’t move here.')).not.toBeInTheDocument());
    await expect(args.onMove).not.toHaveBeenCalled();
  },
};

/** On a reorderable board, a card moves within its column too, before the card it lands above. */
export const Reorder: Story = {
  args: { onMove: fn(), isReorderable: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const name = String(sampleRowAt(0).values.name);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    const handle = canvas.getByRole('button', { name: `Move ${name}` });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    // Lifted: focus waits on the move itself, away from the grid's own arrow keys.
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(args.onMove).toHaveBeenCalledWith(
        expect.objectContaining({ cardId: 'company-0', fromColumnId: STAGE_IDS.lead, toColumnId: STAGE_IDS.lead }),
      ),
    );
  },
};

/** The story below: a required field's no value column next to Lead, saying whether a card is moving. */
function RefusingBoard() {
  const [moving, setMoving] = useState(false);
  return (
    <Stage height="grid">
      <Board
        label="Deals by stage"
        columns={[
          {
            id: STAGE_IDS.lead,
            title: 'Lead',
            hue: 'gray',
            count: 1,
            cards: arraySource<BoardCard>(CARDS.slice(0, 1), (card) => card.id),
          },
          {
            id: 'none',
            title: 'No Stage',
            count: 0,
            refusesDrop: { reason: 'Stage is required, so cards can’t move here.' },
            cards: arraySource<BoardCard>([], (card) => card.id),
          },
          {
            id: 'won',
            title: 'Won',
            hue: 'green',
            count: 0,
            cards: arraySource<BoardCard>([], (card) => card.id),
          },
        ]}
        cardFields={CARD_FIELDS}
        showEmptyColumns
        onMovingChange={setMoving}
        onMove={() => undefined}
      />
      <output>{moving ? 'moving' : 'still'}</output>
    </Stage>
  );
}

/** A column that takes no card, with its reason shown while one moves (a required field's no value column). */
export const RefusesDrop: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <RefusingBoard />,
  play: async ({ canvas, userEvent }) => {
    const name = CARDS[0]?.record.name ?? '';
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    const handle = canvas.getByRole('button', { name: `Move ${name}` });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(handle).not.toHaveFocus());
    await waitFor(() => expect(canvas.getByText('Stage is required, so cards can’t move here.')).toBeInTheDocument());
    await expect(canvas.getByText('moving')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getByText('still')).toBeInTheDocument());
  },
};

/** A filtered column past the count's cap: its count is a floor, "10,000+". */
export const CountAtLeast: Story = {
  render: () => (
    <Stage height="grid">
      <Board
        label="Deals by stage"
        columns={[
          {
            id: STAGE_IDS.lead,
            title: 'Lead',
            hue: 'gray',
            count: 10_000,
            isCountAtLeast: true,
            cards: arraySource<BoardCard>(CARDS.slice(0, 2), (card) => card.id),
          },
        ]}
        cardFields={CARD_FIELDS}
        showEmptyColumns
        isReadOnly
        onMove={() => undefined}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('10,000+')).toBeInTheDocument();
    // The count pill reads its noun after the number: "10,000+ cards".
    await expect(canvas.getByText(/^10,000\+ cards$/)).toBeInTheDocument();
  },
};

/** A column totalling the view's currency field: the total at the heading's end, after the count. */
export const ColumnTotal: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage height="grid">
      <Board
        label="Deals by stage"
        columns={[
          {
            id: STAGE_IDS.lead,
            title: 'Lead',
            hue: 'gray',
            count: 2,
            total: '$42,300',
            cards: arraySource<BoardCard>(CARDS.slice(0, 2), (card) => card.id),
          },
        ]}
        cardFields={CARD_FIELDS}
        showEmptyColumns
        isReadOnly
        onMove={() => undefined}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: /Lead/ })).toHaveTextContent('$42,300');
  },
};

/** A column of 2,000 cards draws only those on screen; the source hears the range. */
export const LongColumn: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => {
    const onRangeChange = fn();
    const many: BoardColumn = {
      id: STAGE_IDS.lead,
      title: 'Lead',
      hue: 'gray',
      count: 2000,
      cards: {
        count: 2000,
        getItem: (index) => {
          const row = sampleRowAt(index);
          return {
            id: row.id,
            record: {
              objectId: SAMPLE_IDS.companies,
              recordId: row.id,
              name: String(row.values.name),
              kind: 'company',
            },
            values: row.values,
            displays: row.displays,
          };
        },
        getKey: (card) => card.id,
        onRangeChange,
      },
    };
    return (
      <Stage height="grid">
        <Board
          label="Deals by stage"
          columns={[many]}
          cardFields={CARD_FIELDS}
          showEmptyColumns={false}
          onMove={() => undefined}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await waitFor(() => expect(canvas.getAllByRole('row').length).toBeGreaterThan(0));
    await expect(canvas.getAllByRole('row').length).toBeLessThan(30);
  },
};

/** While a card moves, hidden empty columns come back as places to drop it. */
export const DropOnHiddenColumn: Story = {
  args: { onMove: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const name = String(sampleRowAt(0).values.name);
    await expect(canvas.queryByRole('grid', { name: /Lost/ })).not.toBeInTheDocument();
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    const handle = canvas.getByRole('button', { name: `Move ${name}` });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    // Lifted: focus waits on the move itself, away from the grid's own arrow keys.
    await waitFor(() => expect(handle).not.toHaveFocus());
    await waitFor(() => expect(canvas.getByRole('grid', { name: /Lost/ })).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('grid', { name: /Lost/ })).not.toBeInTheDocument());
  },
};

/** The board failed to load. */
export const Failed: Story = {
  args: { status: 'error', onRetry: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** The viewer may not see this board. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see this board')).toBeInTheDocument();
  },
};

/** The grouping attribute has no options yet, so there are no columns. */
export const NoColumns: Story = {
  render: () => (
    <Stage height="grid">
      <Board
        label="Deals by stage"
        columns={[]}
        cardFields={CARD_FIELDS}
        showEmptyColumns={false}
        onMove={() => undefined}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing to group by yet')).toBeInTheDocument();
  },
};

/** A column folds into a strip with its name and count, and opens again from the strip. */
export const CollapseColumn: Story = {
  args: { canCollapse: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse Lead' }));
    const lead = canvas.getByRole('region', { name: /Lead/ });
    await expect(lead).toHaveAttribute('data-collapsed');
    await expect(within(lead).queryByRole('grid')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Expand Lead' }));
    await expect(canvas.getByRole('region', { name: /Lead/ })).not.toHaveAttribute('data-collapsed');
  },
};

/** "+ Add stage": the name typed and Enter make a column; the field clears for the next, and Esc puts it away. */
export const AddStage: Story = {
  args: { canAddColumn: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add stage' }));
    const field = canvas.getByRole('textbox', { name: 'Add stage: name' });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.type(field, 'Negotiation{Enter}');
    await waitFor(() => expect(canvas.getByRole('region', { name: /Negotiation/ })).toBeInTheDocument());
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Add stage: name' })).toHaveValue(''));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Add stage' })).toBeInTheDocument());
  },
};

/** A name already taken is refused: it stays in the field (the screen says why). */
export const AddStageRefused: Story = {
  args: { canAddColumn: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add stage' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Add stage: name' }), 'Lost{Enter}');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Add stage: name' })).toHaveValue('Lost'));
    await expect(canvas.getByText('A stage already has this name.')).toBeInTheDocument();
  },
};

/** Lost folded out of the way: a strip with its name and count down it, and Expand at its top. */
export const Folded: Story = {
  args: { canCollapse: true, startCollapsed: ['lost'], startShowingEmpty: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('region', { name: /Lost/ })).toHaveAttribute('data-collapsed');
    await expect(canvas.getByRole('button', { name: 'Expand Lost' })).toBeInTheDocument();
  },
};
