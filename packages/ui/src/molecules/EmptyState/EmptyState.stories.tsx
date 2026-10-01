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
