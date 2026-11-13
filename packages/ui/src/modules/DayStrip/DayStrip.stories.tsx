import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DayStrip } from './DayStrip.tsx';

const meta = {
  title: 'Modules/DayStrip',
  component: DayStrip,
  args: {
    days: ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'],
    value: '2026-10-08',
    onChange: fn(),
  },
} satisfies Meta<typeof DayStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The days with times, sideways; the arrows move along them. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    await expect(canvas.getByRole('button', { name: /Friday, October 9/ })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** `today`: each day's month under its date, and Today on today, so a new month reads as one. */
export const WithMonths: Story = {
  args: { days: ['2026-10-08', '2026-10-09', '2026-10-30', '2026-10-31', '2026-11-02'], today: '2026-10-08' },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Today')).toBeInTheDocument();
    await expect(canvas.getByText('Nov')).toBeInTheDocument();
  },
};

/** Under a pointer a day washes (CSS only); the chosen day keeps its white pill. */
export const HoverDay: Story = {
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    const friday = canvas.getByRole('button', { name: /Friday, October 9/ });
    await userEvent.hover(friday);
    await expect(friday).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getByRole('button', { name: /Thursday, October 8/ })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** A day holding a Best time carries its dot, and says so in its name. */
export const BestDay: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    const best = canvas.getByRole('button', { name: /^Tuesday, October 13, .*a best time for you both$/ });
    await expect(best).toHaveAttribute('data-best');
    await userEvent.click(best);
    await expect(best).toHaveAttribute('aria-pressed', 'true');
  },
};

/** The days before they are known: a day's tile in each place, so the times under them never move. */
export const Loading: Story = {
  args: { days: [], isLoading: true },
  render: (args) => (
    <Stage width="fill">
      <DayStrip {...args} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-loading]').length).toBeGreaterThan(0);
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull();
  },
};

/** The story's own state, in a component so the artifact's preview can render it too. */
function Interactive(args: ComponentProps<typeof DayStrip>) {
  const [value, setValue] = useState(args.value);
  return (
    <Stage width="fill">
      <DayStrip {...args} value={value} onChange={setValue} bestDays={new Set(['2026-10-13'])} />
    </Stage>
  );
}
