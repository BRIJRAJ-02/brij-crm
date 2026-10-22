import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, spyOn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { CopyButton } from './CopyButton.tsx';

const meta = {
  title: 'Atoms/CopyButton',
  component: CopyButton,
  args: { value: 'https://timefix.app/b/k3x9', label: 'Copy link', announcement: 'Link copied' },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: the copy icon and its label. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <CopyButton {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeEnabled();
  },
};

/** Copied: a check and "Copied" for two seconds, at the same width, and "Link copied" said to screen readers. */
export const Copied: Story = {
  render: (args) => (
    <Stage>
      <CopyButton {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const button = canvas.getByRole('button', { name: 'Copy link' });
    const width = button.getBoundingClientRect().width;
    await userEvent.click(button);
    await expect(write).toHaveBeenCalledWith('https://timefix.app/b/k3x9');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    await expect(canvas.getByRole('button', { name: 'Copied' }).getBoundingClientRect().width).toBe(width);
    await expect(canvas.getByRole('status')).toHaveTextContent('Link copied');
    write.mockRestore();
  },
};

/** Icon only: the check stands in for the copy icon; the name stays. */
export const IconOnly: Story = {
  args: { isIconOnly: true },
  render: (args) => (
    <Stage>
      <CopyButton {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await userEvent.click(canvas.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Link copied'));
    write.mockRestore();
  },
};

/** Refused: an error toast says to copy it by hand, and the label stays Copy link. */
export const Failed: Story = {
  render: (args) => (
    <Stage>
      <CopyButton {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const write = spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await userEvent.click(canvas.getByRole('button', { name: 'Copy link' }));
    await waitFor(() =>
      expect(document.body).toHaveTextContent('Couldn’t copy. Select the link and copy it yourself.'),
    );
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    write.mockRestore();
  },
};

/** Disabled: nothing to copy yet. */
export const Disabled: Story = {
  args: { isDisabled: true },
  render: (args) => (
    <Stage>
      <CopyButton {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeDisabled();
  },
};
