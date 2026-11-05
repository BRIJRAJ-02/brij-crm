import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { QrSheet, type QrSheetCard } from './QrSheet.tsx';

const cards = (count: number): readonly QrSheetCard[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `t${String(index + 1)}`,
    name: `Table ${String(index + 1)}`,
    value: `https://timefix.com/m/AbCdEfGhIjKlMnOp?t=Q7n2Xc9LmB4vTz8RkP1wYd${String(index)}`.slice(0, 64),
  }));

/** Cards with their tables' codes printed under the names (Menu QR's own labels, T1 to T8). */
const coded = (count: number): readonly QrSheetCard[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `t${String(index + 1)}`,
    name: `T${String(index + 1)}`,
    code: `Q7n2Xc9LmB4vTz8RkP1wY${String(index)}`,
    value: `https://timefix.com/m/AbCdEfGhIjKlMnOp?t=Q7n2Xc9LmB4vTz8RkP1wY${String(index)}`,
  }));

const meta = {
  title: 'Modules/QrSheet',
  component: QrSheet,
  args: { venue: 'Somewhere', cards: cards(4), perPage: 2 },
} satisfies Meta<typeof QrSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two wide tents an A4 sheet, each folded along its dashed line: four tables on two sheets. */
export const TwoPerPage: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('region')).toHaveLength(2);
    await expect(canvas.getByRole('region', { name: 'Page 1 of 2' })).toBeVisible();
    await expect(canvas.getAllByRole('img', { name: 'QR code for Table 1' })).toHaveLength(1);
  },
};

/** Four small tents a sheet: the code over the words, centred. */
export const FourPerPage: Story = {
  args: { cards: cards(6), perPage: 4 },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('region')).toHaveLength(2);
    await expect(canvas.getAllByRole('article')).toHaveLength(6);
  },
};

/** With the brand's accent on the modules and the controls above, which never print. */
export const WithControls: Story = {
  args: {
    colour: '#1f5fd6',
    controls: <span>4 tables</span>,
    actions: (
      <Button variant="primary" icon="printer">
        Print
      </Button>
    ),
  },
};

/** A long venue name and table label wrap inside their card. */
export const LongNames: Story = {
  args: {
    venue: 'The Somewhere Nowhere Kitchen and Wine Bar',
    cards: [{ id: 'a', name: 'Terrace 12', value: 'https://timefix.com/m/AbCdEfGhIjKlMnOp?t=Q7n2Xc9LmB4vTz8RkP1wYd' }],
  },
};

/** Tiles (stickers), six an A4 sheet, each with the venue and the table's code under its name: eight on two sheets. */
export const Tiles: Story = {
  args: { cards: coded(8), layout: 'tiles', summary: '8 tables · scan-ready' },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('region')).toHaveLength(2);
    await expect(canvas.getAllByRole('article')).toHaveLength(8);
    await expect(canvas.getByText('Somewhere · Q7n2Xc9LmB4vTz8RkP1wY0')).toBeInTheDocument();
    await expect(canvas.getByText('8 tables · scan-ready')).toBeVisible();
    // A tile is one face: one code a table, nothing upside down.
    await expect(canvas.getAllByRole('img', { name: 'QR code for T1' })).toHaveLength(1);
  },
};

/** Tents with each table's code printed under its name. */
export const TentsWithCodes: Story = {
  args: { cards: coded(2), perPage: 2 },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText('Q7n2Xc9LmB4vTz8RkP1wY0').length).toBeGreaterThan(0);
  },
};

/** No cards: no sheet at all; the caller shows its own empty state. */
export const Empty: Story = {
  args: { cards: [] },
  play: async ({ canvas }) => {
    await expect(canvas.queryAllByRole('region')).toHaveLength(0);
  },
};
