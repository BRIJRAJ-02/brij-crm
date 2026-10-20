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

/** The story's own state, in a component so the artifact's preview can render it too. */
function Interactive(args: ComponentProps<typeof DayStrip>) {
  const [value, setValue] = useState(args.value);
  return (
    <Stage width="fill">
      <DayStrip {...args} value={value} onChange={setValue} bestDays={new Set(['2026-10-13'])} />
    </Stage>
  );
}
