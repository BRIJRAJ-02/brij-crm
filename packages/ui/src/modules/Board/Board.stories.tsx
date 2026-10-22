import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { arraySource } from '../../lib/list-source.ts';
import { SAMPLE_STAGES } from '../../workbench/field-samples.ts';
import { SAMPLE_IDS } from '../../workbench/sample-ids.ts';
import { sampleColumns, sampleRowAt } from '../../workbench/grid-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Board } from './Board.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
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
}: SampleProps) {
  const [cards, setCards] = useState(CARDS);
  const [showEmpty, setShowEmpty] = useState(startShowingEmpty);
  const columns: readonly BoardColumn[] = [
    ...(withNoValue ? [{ id: 'none', title: 'No Stage', isArchived: false, isCollapsedWhenEmpty: true }] : []),
    ...SAMPLE_STAGES.map((stage) => ({ id: stage.id, title: stage.label, hue: stage.hue, isArchived: stage.archived })),
    { id: 'lost', title: 'Lost', hue: 'red' as const, isArchived: false },
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

/** By keyboard into an empty column past full ones: the column the card shows over is the one it drops in. */
export const MoveByKeyboardToEmpty: Story = {
  args: { onMove: fn(), startShowingEmpty: true },
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
    await waitFor(() => expect(handle).not.toHaveFocus());
    for (const column of [/Qualified/, /Proposal/, /Won/, /Lost/]) {
      await userEvent.keyboard('{ArrowRight}');
      await waitFor(() => expect(canvas.getByRole('region', { name: column })).toHaveAttribute('data-over'));
    }
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(args.onMove).toHaveBeenCalled());
    await waitFor(() => expect(within(canvas.getByRole('grid', { name: /Lost/ })).getByText(name)).toBeInTheDocument());
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

/** The grouping attribute is read only: no card has a handle. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.queryAllByRole('button', { name: /^Move / })).toHaveLength(0);
  },
};

/** Showing empty columns brings back Lost, with nothing in it. */
export const EmptyColumns: Story = {
  args: { startShowingEmpty: true },
  play: async ({ canvas }) => {
    const lost = canvas.getByRole('grid', { name: /Lost/ });
    await expect(within(lost).getByText('No cards')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Hide empty columns' })).toBeInTheDocument();
  },
};

/** An empty "No Stage" column is a slim strip with its title and count, out of the way until a card moves. */
export const CollapsedNoValue: Story = {
  args: { startShowingEmpty: true, withNoValue: true },
  play: async ({ canvas }) => {
    const strip = canvas.getByRole('region', { name: /No Stage/ });
    await expect(within(strip).queryByRole('grid')).not.toBeInTheDocument();
    await expect(strip.getBoundingClientRect().width).toBeLessThan(80);
    await expect(within(strip).getByText('0')).toBeInTheDocument();
  },
};

/** The board is still coming. */
export const Loading: Story = {
  args: { status: 'loading' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading the board')).toBeInTheDocument();
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
    await expect(canvas.getByLabelText('10,000 or more cards')).toBeInTheDocument();
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
