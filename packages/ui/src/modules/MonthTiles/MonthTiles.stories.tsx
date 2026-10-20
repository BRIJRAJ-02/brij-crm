import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { MonthTiles } from './MonthTiles.tsx';

const OPEN = new Set([
  '2026-10-08',
  '2026-10-09',
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
]);

const meta = {
  title: 'Modules/MonthTiles',
  component: MonthTiles,
  args: {
    month: '2026-10',
    today: '2026-10-08',
    openDays: OPEN,
    value: '2026-10-08',
    onChange: fn(),
    onMonthChange: fn(),
    canPrevious: false,
    canNext: true,
  },
} satisfies Meta<typeof MonthTiles>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A month: open days filled, closed days quiet, today chosen with its dot. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => <Interactive {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /Monday, October 12/ }));
    await expect(canvas.getByRole('button', { name: /Monday, October 12/ })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** The arrows move between open days only, a week with Up and Down. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <MonthTiles {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    canvas.getByRole('button', { name: /Thursday, October 8/ }).focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expect(canvas.getByRole('button', { name: /Monday, October 12/ })).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect(canvas.getByRole('button', { name: /Friday, October 16/ })).toHaveFocus();
  },
};

/** With the visitor's calendar on: days holding a Best time carry a mark. */
export const BestDays: Story = {
  args: { bestDays: new Set(['2026-10-09', '2026-10-13']) },
  render: (args) => (
    <Stage width="narrow">
      <MonthTiles {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Friday, October 9.*best time/ })).toBeInTheDocument();
  },
};

/** The last bookable month: Next is off. */
export const LastMonth: Story = {
  parameters: { crm: { screenshot: false } },
  args: { canPrevious: true, canNext: false },
  render: (args) => (
    <Stage width="narrow">
      <MonthTiles {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('button', { name: 'Next month' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Previous month' }));
    await expect(args.onMonthChange).toHaveBeenCalledWith('2026-09');
  },
};

/** The story's own state, in a component so the artifact's preview can render it too. */
function Interactive(args: ComponentProps<typeof MonthTiles>) {
  const [value, setValue] = useState(args.value);
  return (
    <Stage width="narrow">
      <MonthTiles {...args} value={value} onChange={setValue} />
    </Stage>
  );
}
