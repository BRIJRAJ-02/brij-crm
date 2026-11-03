import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Reveal } from './Reveal.tsx';

const meta = {
  title: 'Atoms/Reveal',
  component: Reveal,
  args: { children: 'Anish Gupta' },
} satisfies Meta<typeof Reveal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A headline, its line and a row, each one stagger after the one before (texts reveal). */
export const Run: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <div>
        <Reveal order={1}>Anish Gupta</Reveal>
        <Reveal order={2}>Cofounder at Timefix</Reveal>
        <Reveal order={3}>Book a call</Reveal>
      </div>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Cofounder at Timefix')).toHaveAttribute('data-order', '2');
  },
};

/** A word that stays in its line. */
export const Inline: Story = {
  args: { display: 'inline', order: 2, children: 'Booked' },
};
