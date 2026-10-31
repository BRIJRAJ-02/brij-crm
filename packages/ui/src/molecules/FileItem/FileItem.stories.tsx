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
    const remove = canvas.getByRole('button', { name: 'Remove Q4 deck.pdf' });
    await userEvent.click(remove);
    await expect(args.onRemove).toHaveBeenCalled();
    // Leave the button at rest, so the screenshot never catches its hover or press mid transition.
    await userEvent.unhover(remove);
    remove.blur();
  },
};

/** A record's Files tab: who added it and when after the size, and an image that opens in a new tab. */
export const WithDetail: Story = {
  // The row is States' own; only its second line differs, so no screenshot of its own.
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage direction="column" width="narrow">
      <FileItem {...args} href="/files/f1" detail="Ada Lovelace, 2 days ago" />
      <FileItem name="Site visit.jpg" size={640_000} contentType="image/jpeg" href="/files/f2" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('2.4 MB · Ada Lovelace, 2 days ago')).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: /Site visit\.jpg/u })).toHaveAttribute('target', '_blank');
  },
};
