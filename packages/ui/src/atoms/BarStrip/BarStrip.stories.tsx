import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { hoverFresh, shownTooltip } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BarStrip } from './BarStrip.tsx';

const COUNTS = [2, 3, 0, 4, 1, 5, 3, 2, 0, 4, 6, 3];
const weeks = (counts: readonly number[]) =>
  counts.map((value, index) => ({
    id: `w${String(index)}`,
    label: `Week ${String(index + 1)}: ${String(value)}`,
    value,
  }));

const meta = {
  title: 'Atoms/BarStrip',
  component: BarStrip,
  args: { label: 'Sam Lee, meetings per week', bars: weeks(COUNTS) },
} satisfies Meta<typeof BarStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Twelve weeks, the tallest bar full height; empty weeks keep a stub on the baseline. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <BarStrip {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Week 6: 5')).toBeInTheDocument();
  },
};

/**
 * Hover (spec 0072, Chart's look): the pointer on a week's bar opens its tooltip with the week's line (the other bars
 * dim, in CSS). The bars stay out of the tab order; the hidden list is what a screen reader hears.
 */
export const HoverBar: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <BarStrip {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    // The drawn bars, hidden from screen readers; the sixth is week 6.
    const week = canvasElement.querySelector('[aria-hidden="true"]')?.children[5];
    if (week === undefined) throw new Error('no bar for week 6');
    await hoverFresh(userEvent, week);
    await expect(await shownTooltip()).toHaveTextContent('Week 6: 5');
    await expect(canvas.getByRole('list')).toHaveTextContent('Week 6: 5');
  },
};

/** Strips sharing one `max`, so a quieter member's bars stay short beside a busier one's. */
export const SharedScale: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <BarStrip label="Sam Lee" bars={weeks(COUNTS)} max={6} />
      <BarStrip label="Ada Park" bars={weeks([1, 0, 1, 2, 0, 1, 1, 0, 2, 1, 0, 1])} max={6} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Ada Park')).toBeInTheDocument();
  },
};

/** Nothing yet: every week a stub. */
export const Empty: Story = {
  args: { bars: weeks(COUNTS.map(() => 0)) },
  render: (args) => (
    <Stage>
      <BarStrip {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Week 1: 0')).toBeInTheDocument();
  },
};

/** A chart: thirty days across the container's width, the axis naming both ends (the operator console, spec 0047). */
export const Chart: Story = {
  args: {
    size: 'chart',
    label: 'Visitors per day',
    bars: Array.from({ length: 30 }, (_, index) => ({
      id: `d${String(index)}`,
      label: `Day ${String(index + 1)}: ${String((index * 7) % 11)}`,
      value: (index * 7) % 11,
    })),
    axis: { start: '24 Sep', end: 'Today' },
  },
  render: (args) => (
    <Stage>
      <BarStrip {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Day 2: 7')).toBeInTheDocument();
    await expect(canvas.getByText('Today')).toBeInTheDocument();
  },
};

/** A chart with nothing in its period: every day a stub on the baseline, the axis still naming both ends. */
export const ChartEmpty: Story = {
  args: {
    size: 'chart',
    label: 'Visitors per day',
    bars: Array.from({ length: 30 }, (_, index) => ({
      id: `d${String(index)}`,
      label: `Day ${String(index + 1)}: 0`,
      value: 0,
    })),
    axis: { start: '24 Sep', end: 'Today' },
  },
  render: (args) => (
    <Stage>
      <BarStrip {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Day 30: 0')).toBeInTheDocument();
  },
};

/** Loading: the chart's days as stubs, no tooltips, busy for screen readers. */
export const ChartLoading: Story = {
  args: {
    size: 'chart',
    label: 'Visitors per day',
    isLoading: true,
    bars: Array.from({ length: 30 }, (_, index) => ({ id: `d${String(index)}`, label: '', value: 0 })),
  },
  render: (args) => (
    <Stage>
      <BarStrip {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Visitors per day')).toBeInTheDocument();
  },
};
