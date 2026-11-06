import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
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

/** A one pixel PNG, standing in for a picture our own origin serves. `data:` is in every policy here. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Replacing a picture that is there already: it takes the upload icon's place, so nobody replaces it unseen. */
export const WithPreview: Story = {
  args: {
    label: 'Picture when shared',
    acceptedTypes: ['image/png', 'image/jpeg'],
    maxSize: 500_000,
    preview: { src: PIXEL, alt: 'Your page’s share picture' },
  },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByAltText('Your page’s share picture')).toBeInTheDocument();
  },
};

/** A picture there already that can be cropped again (spec 0068, AC-6809): Adjust crop opens the screen's PhotoCrop. */
export const WithAdjust: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    label: 'Cover photo',
    acceptedTypes: ['image/png', 'image/jpeg'],
    preview: { src: PIXEL, alt: 'Your cover photo' },
    onAdjust: fn(),
  },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Adjust crop' }));
    await expect(args.onAdjust).toHaveBeenCalledTimes(1);
  },
};

/** An image from anywhere but our own origin is never drawn: the upload icon stays, with no word about it. */
export const PreviewRefused: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Picture when shared', preview: { src: 'https://example.com/other.png', alt: 'Somewhere else' } },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByAltText('Somewhere else')).not.toBeInTheDocument();
  },
};

/** The types as people name them (`typesText`), in the hint and the refusal, in place of the raw MIME types. */
export const NamedTypes: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    label: 'Add your logo',
    acceptedTypes: ['image/png', 'image/jpeg', 'image/webp'],
    typesText: 'PNG, JPG or WebP',
    maxSize: 4_000_000,
  },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('PNG, JPG or WebP · up to 4 MB', { exact: false })).toBeInTheDocument();
    await expect(canvas.queryByText('image/png', { exact: false })).not.toBeInTheDocument();
  },
};

/** Read only: the picture that is there, and nothing to press (a member's view of the workspace's logo). */
export const ReadOnly: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Logo', isReadOnly: true, preview: { src: PIXEL, alt: 'Your logo' } },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByAltText('Your logo')).toBeInTheDocument();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
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

/** `variant="button"`: the browse button alone, beside what it changes (first run's avatar). */
export const AsButton: Story = {
  args: { label: 'Upload photo', variant: 'button', acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'] },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Upload photo' })).toBeEnabled();
  },
};

/** The button variant while what was picked is on its way: it spins and takes no second press. */
export const AsButtonPending: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Upload photo', variant: 'button', isPending: true },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
};

/** Uploading what was picked: the zone stays, says so, and takes no second pick (spec 0061). */
export const Pending: Story = {
  args: { label: 'Choose a picture', acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'], isPending: true },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /uploading/ })).toBeInTheDocument();
  },
};

/** The screen's own refusal, in the zone's refusal line. */
export const Refused: Story = {
  args: {
    label: 'Choose a picture',
    acceptedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    error: 'Add a picture.',
  },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Add a picture.');
  },
};

/** `variant="row"` with nothing there: one line, the picture mark, the label and Upload (a link page's cover). */
export const AsRow: Story = {
  // New after the last baselines were shot on CI; its screenshot joins with the next baseline run.
  parameters: { crm: { screenshot: false } },
  args: { label: 'Cover photo', variant: 'row', acceptedTypes: ['image/png', 'image/jpeg'] },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Upload cover photo' })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: 'Adjust crop' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Remove cover photo' })).not.toBeInTheDocument();
  },
};

/** The row with a square tile, for a picture you have to recognise (a menu item's photo). */
export const AsRowSquare: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    label: 'Photo',
    variant: 'row',
    thumb: 'square',
    acceptedTypes: ['image/png', 'image/jpeg'],
    preview: { src: PIXEL, alt: '' },
    onAdjust: fn(),
  },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Adjust crop' })).toBeEnabled();
  },
};

/** The row with a picture there: a small picture of it, Change, Adjust crop and Remove. */
export const AsRowWithPicture: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    label: 'Cover photo',
    variant: 'row',
    acceptedTypes: ['image/png', 'image/jpeg'],
    preview: { src: PIXEL, alt: 'Your cover photo' },
    onAdjust: fn(),
    onRemove: fn(),
  },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ args, canvas }) => {
    await expect(canvas.getByAltText('Your cover photo')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Change cover photo' })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Adjust crop' }));
    await expect(args.onAdjust).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove cover photo' }));
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};

/** The row while what was picked is on its way: Change spins, and nothing else takes a press. */
export const AsRowPending: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    label: 'Cover photo',
    variant: 'row',
    isPending: true,
    preview: { src: PIXEL, alt: 'Your cover photo' },
    onAdjust: fn(),
    onRemove: fn(),
  },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Adjust crop' })).toBeDisabled();
  },
};

/** The row disabled: its words at the tertiary text colour, every button off. */
export const AsRowDisabled: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Cover photo', variant: 'row', isDisabled: true },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Upload cover photo' })).toBeDisabled();
  },
};

/** The row with the screen's own refusal, in its refusal line under it. */
export const AsRowRefused: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Cover photo', variant: 'row', error: 'That picture couldn’t be read. Try a JPEG, PNG or WebP.' },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('That picture couldn’t be read.');
  },
};

const PHOTO_SRC =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect width="400" height="300" fill="%23efe7dc"/%3E%3Ccircle cx="200" cy="150" r="110" fill="%23d9a26b"/%3E%3C/svg%3E';

/** `variant="photo"` with nothing there: one box to press, drop on or paste into (a menu item's photo). */
export const AsPhoto: Story = {
  args: { label: 'Photo', variant: 'photo', acceptedTypes: ['image/png', 'image/jpeg'], onFiles: fn() },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('button', { name: /^Add photo/ })).toBeEnabled();
    // A picture pasted anywhere around it lands here; text in the clipboard stays the field's.
    const paste = (data: DataTransfer) =>
      document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: data }));
    const file = new DataTransfer();
    file.items.add(new File(['x'], 'dish.png', { type: 'image/png' }));
    paste(file);
    await expect(args.onFiles).toHaveBeenCalledTimes(1);
    const both = new DataTransfer();
    both.items.add(new File(['x'], 'dish.png', { type: 'image/png' }));
    both.setData('text/plain', 'Grilled salmon');
    paste(both);
    await expect(args.onFiles).toHaveBeenCalledTimes(1);
  },
};

/** `variant="photo"` with a picture: large enough to check it by, its buttons beside it. */
export const AsPhotoWithPicture: Story = {
  args: {
    label: 'Photo',
    variant: 'photo',
    preview: { src: PHOTO_SRC, alt: 'A bowl of soup' },
    onAdjust: fn(),
    onRemove: fn(),
  },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByRole('img', { name: 'A bowl of soup' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Change photo' })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Adjust crop' }));
    await expect(args.onAdjust).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Remove photo' }));
    await expect(args.onRemove).toHaveBeenCalledTimes(1);
  },
};

/** `variant="photo"` read only: the picture alone, nothing to press. */
export const AsPhotoReadOnly: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Photo', variant: 'photo', isReadOnly: true, preview: { src: PHOTO_SRC, alt: 'A bowl of soup' } },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'A bowl of soup' })).toBeVisible();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};

/** `variant="photo"` off: the box steps back. */
export const AsPhotoDisabled: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Photo', variant: 'photo', isDisabled: true },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /^Add photo/ })).toBeDisabled();
  },
};

/** `variant="photo"` while a picture goes up: the box says so and takes no second pick. */
export const AsPhotoPending: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Photo', variant: 'photo', isPending: true },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /uploading/ })).toBeInTheDocument();
  },
};

/** `variant="photo"` refused: the screen's own words in the refusal line. */
export const AsPhotoRefused: Story = {
  parameters: { crm: { screenshot: false } },
  args: { label: 'Photo', variant: 'photo', error: 'That photo couldn’t be read.' },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('That photo couldn’t be read.');
  },
};
