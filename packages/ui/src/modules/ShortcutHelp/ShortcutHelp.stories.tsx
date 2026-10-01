import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { ShortcutHelp } from './ShortcutHelp.tsx';

const meta = {
  title: 'Modules/ShortcutHelp',
  component: ShortcutHelp,
  args: {
    isOpen: true,
    onOpenChange: fn(),
    groups: [
      {
        title: 'Everywhere',
        shortcuts: [
          { label: 'Quick actions', keys: ['⌘', 'K'] },
          { label: 'Keyboard shortcuts', keys: ['?'] },
        ],
      },
      {
        title: 'In a table',
        shortcuts: [
          { label: 'Edit the cell', keys: ['↵'] },
          { label: 'Select the rows on screen', keys: ['⌘', 'A'] },
          { label: 'Copy', keys: ['⌘', 'C'] },
        ],
      },
    ],
  },
} satisfies Meta<typeof ShortcutHelp>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shortcuts in groups, each with its keycaps; Esc closes it. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, userEvent }) => {
    const dialog = await waitFor(() => {
      const found = document.querySelector('[role="dialog"]');
      if (found === null) throw new Error('No dialog.');
      return found;
    });
    await expect(dialog).toHaveAccessibleName('Keyboard shortcuts');
    await expect(dialog).toHaveTextContent('Select the rows on screen');
    await userEvent.keyboard('{Escape}');
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};
