import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { ProgressBar } from './ProgressBar.tsx';

const meta = {
  title: 'Atoms/ProgressBar',
  component: ProgressBar,
  args: { label: 'Importing 2,400 people', value: 42, showValue: true },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Partway, with the percentage. */
export const Default: Story = {
  render: (args) => (
    <Stage width="narrow">
      <ProgressBar {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('progressbar', { name: 'Importing 2,400 people' });
    await expect(bar).toHaveAttribute('aria-valuenow', '42');
    await expect(canvas.getByText('42%')).toBeInTheDocument();
  },
};

/** Determinate and indeterminate, and one whose label is the text beside it. */
export const States: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column" width="narrow">
      <ProgressBar label="Merging duplicates" value={80} showValue />
      <ProgressBar label="Preparing the export" />
      <ProgressBar label="Uploading deck.pdf" value={15} isLabelHidden />
    </Stage>
  ),
};
