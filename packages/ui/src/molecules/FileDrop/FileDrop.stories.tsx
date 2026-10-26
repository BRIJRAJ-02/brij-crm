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

/** Disabled. */
export const Disabled: Story = {
  args: { isDisabled: true },
  render: (args) => (
    <Stage width="narrow">
      <FileDrop {...args} />
    </Stage>
  ),
};
