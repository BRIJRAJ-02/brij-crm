import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Chart, type ChartPoint } from './Chart.tsx';

const money = (value: number) => `$${value.toLocaleString('en-GB')}`;
const tick = (value: number) => (value >= 1000 ? `$${String(value / 1000)}K` : `$${String(value)}`);

const stages: readonly ChartPoint[] = [
  { id: 'lead', label: 'Lead', value: 48200, valueText: money(48200) },
  { id: 'qualified', label: 'Qualified', value: 91000, valueText: money(91000) },
  { id: 'proposal', label: 'Proposal', value: 132500, valueText: money(132500) },
  { id: 'negotiation', label: 'Negotiation', value: 76400, valueText: money(76400) },
  { id: 'won', label: 'Won', value: 64000, valueText: money(64000) },
  { id: 'none', label: 'No stage', value: 0, valueText: money(0) },
];

const months: readonly ChartPoint[] = [
  ['Nov', 'November 2025', 4],
  ['Dec', 'December 2025', 7],
  ['Jan', 'January 2026', 5],
  ['Feb', 'February 2026', 9],
  ['Mar', 'March 2026', 12],
  ['Apr', 'April 2026', 8],
  ['May', 'May 2026', 15],
  ['Jun', 'June 2026', 11],
  ['Jul', 'July 2026', 0],
  ['Aug', 'August 2026', 6],
  ['Sep', 'September 2026', 14],
  ['Oct', 'October 2026', 18],
].map(([axisLabel, label, value]) => ({
  id: String(label),
  label: String(label),
  axisLabel: String(axisLabel),
  value: Number(value),
  valueText: String(value),
}));

const meta = {
  title: 'Modules/Chart',
  component: Chart,
  args: {
    kind: 'bar',
    label: 'Pipeline by stage',
    pointLabel: 'Stage',
    valueLabel: 'Value',
    points: stages,
    formatTick: tick,
  },
} satisfies Meta<typeof Chart>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Bars per group, one series in the first data colour, the largest labelled. A screen reader hears every bar. */
export const Bars: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: /Pipeline by stage\. Lead \$48,200/ })).toBeVisible();
    await expect(canvas.getByText('$132,500')).toBeVisible();
  },
};

/** A line over the last twelve periods, an empty period at zero, and an end dot. */
export const Line: Story = {
  args: {
    kind: 'line',
    label: 'New deals a month',
    pointLabel: 'Month',
    valueLabel: 'Deals',
    points: months,
    formatTick: String,
  },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: /New deals a month\. November 2025 4/ })).toBeVisible();
  },
};

/** One big number. */
export const BigNumber: Story = {
  args: {
    kind: 'number',
    label: 'Open deals',
    valueLabel: 'Deals',
    points: [{ id: 'total', label: 'Deals', value: 42, valueText: '42' }],
  },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('42')).toBeVisible();
  },
};

/** View as a table: the same figures in rows, the keyboard path to every value. */
export const AsTable: Story = {
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('radio', { name: 'Table' }));
    const table = await canvas.findByRole('grid', { name: 'Pipeline by stage' });
    await expect(within(table).getByRole('rowheader', { name: 'Proposal' })).toBeVisible();
    await expect(within(table).getByText('$132,500')).toBeVisible();
  },
};

/** Loading holds the chart's place. */
export const Loading: Story = {
  args: { status: 'loading' },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
};

/** Every value zero: the chart says there is nothing, rather than drawing flat bars. */
export const Empty: Story = {
  args: { points: stages.map((point) => ({ ...point, value: 0, valueText: money(0) })) },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No data yet')).toBeVisible();
  },
};

/** A failed read, with Try again. */
export const Failed: Story = {
  args: { status: 'error', onRetry: () => undefined },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible();
  },
};

/** For someone who may not see it. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see this')).toBeVisible();
  },
};

/** A newer read is out: the figures stay, a step dimmer, and the frame does not move. */
export const Refreshing: Story = {
  args: { isRefreshing: true },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
};
