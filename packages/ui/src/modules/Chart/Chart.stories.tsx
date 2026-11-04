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

/** Daily points from 7 August: a long range's axis, as Insights and a form's Analytics draw it. */
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const ninetyDays: readonly ChartPoint[] = Array.from({ length: 89 }, (_, at) => {
  const day = dayFormat.format(new Date(Date.UTC(2026, 7, 7 + at)));
  const value = (at * 37) % 23;
  return { id: day, label: day, axisLabel: day, value, valueText: String(value) };
});

/**
 * A long range (T7, 4 November 2026: "numbers are overlapping"): 89 days, its x labels thinned to the room there is
 * from their measured widths, so no two ever touch, on a wide page or a phone.
 */
export const LongRange: Story = {
  args: {
    kind: 'line',
    label: 'Views a day',
    pointLabel: 'Day',
    valueLabel: 'Views',
    points: ninetyDays,
    formatTick: String,
  },
  // Its baselines are owed: they are shot only in the pinned image (`pnpm test:visual --update`), never borrowed.
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const labels = [...canvasElement.querySelectorAll('svg text[text-anchor="middle"]')]
      .map((each) => each.getBoundingClientRect())
      .sort((a, b) => a.left - b.left);
    await expect(labels.length).toBeGreaterThan(1);
    for (let at = 1; at < labels.length; at += 1) {
      await expect((labels[at]?.left ?? 0) - (labels[at - 1]?.right ?? 0)).toBeGreaterThan(0);
    }
  },
};

/**
 * Two series on one axis (Insights, spec 0067): visits and finishes a week, each pair side by side with a surface gap,
 * a legend naming both, and the table with a column each. Never a second axis.
 */
export const Paired: Story = {
  args: {
    kind: 'bar',
    label: 'Visits and finishes by week',
    pointLabel: 'Week',
    valueLabel: 'Visits',
    compareLabel: 'Finishes',
    points: [
      [120, 31],
      [146, 40],
      [98, 22],
      [174, 51],
      [160, 49],
      [131, 30],
    ].map(([visits = 0, finishes = 0], at) => ({
      id: `w${String(at)}`,
      label: `Week of ${String(at * 7 + 1)} September`,
      axisLabel: `${String(at * 7 + 1)} Sep`,
      value: visits,
      valueText: String(visits),
      compare: finishes,
      compareText: String(finishes),
    })),
    formatTick: String,
  },
  // Its baselines are owed: they are shot only in the pinned image (`pnpm test:visual --update`), never borrowed.
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <Chart {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'Legend' })).toBeVisible();
    await expect(
      canvas.getByRole('img', { name: /Visits and finishes by week\. Week of 1 September Visits 120, Finishes 31/ }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole('radio', { name: 'Table' }));
    await expect(canvas.getByRole('columnheader', { name: 'Finishes' })).toBeVisible();
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
