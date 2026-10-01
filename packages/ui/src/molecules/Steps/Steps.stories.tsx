import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Steps } from './Steps.tsx';

const STEPS = [
  { id: 'upload', label: 'Upload a file', description: 'CSV or Excel, up to 50 MB.' },
  { id: 'map', label: 'Map columns', description: 'Match each column to an attribute.' },
  { id: 'review', label: 'Review', description: 'Check what will be created and updated.' },
  { id: 'import', label: 'Import' },
] as const;

const meta = {
  title: 'Molecules/Steps',
  component: Steps,
  args: { label: 'Import progress', steps: STEPS, current: 'map' },
} satisfies Meta<typeof Steps>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Partway: one done, one current, two to come. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <Steps {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('listitem', { current: 'step' })).toHaveTextContent('Map columns');
    await expect(canvas.getByText('(done)')).toBeInTheDocument();
  },
};

/** A step that failed. */
export const Failed: Story = {
  args: { current: 'review', failed: 'review' },
  render: (args) => (
    <Stage>
      <Steps {...args} />
    </Stage>
  ),
};
