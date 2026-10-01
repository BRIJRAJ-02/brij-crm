import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Meter } from './Meter.tsx';

const meta = {
  title: 'Atoms/Meter',
  component: Meter,
  args: { label: 'Records', value: 4200, maxValue: 10000 },
} satisfies Meta<typeof Meter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Room to spare. Screen readers hear "4,200 of 10,000". */
export const Default: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Meter {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('meter', { name: 'Records' })).toHaveAttribute('aria-valuetext', '4,200 of 10,000');
  },
};

/** Room, near the limit, and over it. */
export const States: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column" width="narrow">
      <Meter label="Records" value={4200} maxValue={10000} />
      <Meter label="Seats" value={9} maxValue={10} />
      <Meter label="Storage (GB)" value={54} maxValue={50} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Over the limit/)).toBeInTheDocument();
  },
};
