import type { Meta, StoryObj } from '@storybook/react-vite';
import { DialogTrigger } from 'react-aria-components';
import { expect, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Popover } from './Popover.tsx';

const meta = {
  title: 'Molecules/Popover',
  component: Popover,
  args: { label: 'About this view', children: 'Shared with the sales team. Changes save for everyone.' },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

function openDialog() {
  return waitFor(() => {
    const found = document.querySelector('[role="dialog"]');
    if (found === null) throw new Error('the popover did not open');
    return found;
  });
}

/** Plain content in a named dialog, opened from a button. */
export const Default: Story = {
  render: (args) => (
    <Stage>
      <DialogTrigger defaultOpen>
        <Button icon="info">About</Button>
        <Popover {...args} />
      </DialogTrigger>
    </Stage>
  ),
  play: async () => {
    const dialog = await openDialog();
    await expect(dialog).toHaveAccessibleName('About this view');
  },
};

/** From the keyboard it opens at once and Esc puts focus back on the trigger. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <DialogTrigger>
        <Button icon="info">About</Button>
        <Popover {...args} />
      </DialogTrigger>
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'About' });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const dialog = await openDialog();
    const popover = dialog.closest('[data-opened-by]');
    await expect(popover).toHaveAttribute('data-opened-by', 'keyboard');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
