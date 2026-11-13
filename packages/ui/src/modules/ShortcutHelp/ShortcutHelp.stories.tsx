import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import { GRID_SHORTCUTS } from '../DataGrid/shortcuts.ts';
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
      GRID_SHORTCUTS,
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

/** Each group is a heading over its shortcuts, each shortcut's keycaps together (the palette's sheet). */
export const Groups: Story = {
  parameters: { crm: { screenshot: false } },
  play: async () => {
    const dialog = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[role="dialog"]');
      if (found === null) throw new Error('No dialog.');
      return found;
    });
    await expect(within(dialog).getByRole('heading', { level: 3, name: 'Everywhere' })).toBeInTheDocument();
    await expect(within(dialog).getByRole('heading', { level: 3, name: GRID_SHORTCUTS.title })).toBeInTheDocument();
    await expect(within(dialog).getByText('Quick actions')).toBeInTheDocument();
    const caps = [...dialog.querySelectorAll('kbd')].map((cap) => cap.textContent);
    await expect(caps).toEqual(expect.arrayContaining(['K', '?']));
  },
};
