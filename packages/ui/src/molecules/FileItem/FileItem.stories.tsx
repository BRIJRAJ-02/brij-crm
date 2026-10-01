import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FileItem } from './FileItem.tsx';

const meta = {
  title: 'Molecules/FileItem',
  component: FileItem,
  args: { name: 'Q4 deck.pdf', size: 2_400_000, contentType: 'application/pdf', onRemove: fn() },
} satisfies Meta<typeof FileItem>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Done, uploading and failed. */
export const States: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage direction="column" width="narrow">
      <FileItem {...args} href="/files/f1" />
      <FileItem name="Logo.png" size={84_000} contentType="image/png" progress={40} onRemove={args.onRemove} />
      <FileItem
        name="Contacts.csv"
        size={12_800_000}
        contentType="text/csv"
        error="It’s over the 10 MB limit. Split it, then upload each part."
        onRemove={args.onRemove}
      />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByText('2.4 MB')).toBeInTheDocument();
    await expect(canvas.getByRole('progressbar', { name: 'Uploading Logo.png' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Q4 deck.pdf' }));
    await expect(args.onRemove).toHaveBeenCalled();
  },
};
