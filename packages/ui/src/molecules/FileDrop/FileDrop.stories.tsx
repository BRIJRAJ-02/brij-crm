import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FileDrop } from './FileDrop.tsx';

const meta = {
  title: 'Molecules/FileDrop',
  component: FileDrop,
  args: { label: 'Upload a CSV', acceptedTypes: ['text/csv', '.xlsx'], maxSize: 50_000_000, onFiles: fn() },
} satisfies Meta<typeof FileDrop>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Says what it takes; browse is a button. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('text/csv, .xlsx · up to 50 MB')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'browse' })).toBeInTheDocument();
  },
};

/** Disabled. */
export const Disabled: Story = {
  args: { isDisabled: true },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
};
