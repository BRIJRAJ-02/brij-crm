import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from './EmptyState.tsx';

const meta = {
  title: 'Molecules/EmptyState',
  component: EmptyState,
  args: { title: 'No deals yet', children: 'Deals you add or import show here.' },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing yet, with the next step. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  args: {
    actions: (
      <>
        <Button variant="primary" icon="plus">
          Add deal
        </Button>
        <Button icon="upload">Import</Button>
      </>
    ),
  },
};

/** A row: one quiet line at a list row's height, for a list that sits above more content. */
export const Row: Story = {
  args: { title: 'No open tasks.', children: undefined, icon: 'list-todo', layout: 'row' },
  play: async ({ canvas }) => {
    const status = canvas.getByRole('status');
    await expect(status).toHaveTextContent('No open tasks.');
    await expect(Math.round(status.getBoundingClientRect().height)).toBe(34);
  },
};

/** A load that failed, with a retry. */
export const Failed: Story = {
  args: {
    tone: 'error',
    title: 'Couldn’t load deals',
    children: 'Check your connection, then try again.',
    onRetry: fn(),
  },
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Couldn’t load deals');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** A view the viewer may not see. */
export const Locked: Story = {
  args: { tone: 'locked', title: 'You can’t see this list', children: 'Ask a workspace admin for access.' },
};

/** Still loading: the tile, and skeleton lines where the title and text go, so what follows lands in place. The title is read as the busy status. */
export const Loading: Story = {
  args: { isLoading: true, title: 'Loading' },
  play: async ({ canvas }) => {
    const status = canvas.getByRole('status');
    await expect(status).toHaveAttribute('aria-busy', 'true');
    await expect(status).toHaveTextContent('Loading');
    await expect(canvas.queryByText('Deals you add or import show here.')).toBeNull();
  },
};
