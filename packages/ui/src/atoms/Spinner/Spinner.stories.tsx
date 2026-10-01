import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Spinner } from './Spinner.tsx';

const meta = {
  title: 'Atoms/Spinner',
  component: Spinner,
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Inside a button, at the small icon size. Screen readers hear "In progress". */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { name: 'In progress' })).toBeInTheDocument();
  },
};

/** In rows and menus, at the default icon size, with what is happening. */
export const Labelled: Story = {
  render: () => (
    <Stage>
      <Spinner size="md" label="Importing people" />
      <Spinner size="xs" label="Syncing" />
    </Stage>
  ),
};
