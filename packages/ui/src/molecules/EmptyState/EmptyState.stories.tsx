import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
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

/** A row with a line of text (Home's cards): the text sits under the title, both beside the icon. */
export const RowWithText: Story = {
  args: {
    title: 'No meetings today',
    children: 'Meetings you host and your calendar’s events show here.',
    icon: 'calendar',
    layout: 'row',
  },
  render: (args) => (
    <Stage width="narrow">
      <EmptyState {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const title = canvas.getByText('No meetings today');
    const text = canvas.getByText(/calendar’s events show here/);
    // The text starts where the title does, on the line below it.
    await expect(Math.round(text.getBoundingClientRect().left)).toBe(Math.round(title.getBoundingClientRect().left));
    await expect(text.getBoundingClientRect().top).toBeGreaterThan(title.getBoundingClientRect().top);
  },
};

/** A row that failed, with text and Try again: both under the title. */
export const RowErrorWithText: Story = {
  args: {
    title: 'Recent records didn’t load',
    children: 'Check your connection.',
    tone: 'error',
    layout: 'row',
    onRetry: fn(),
  },
  play: async ({ canvas, args }) => {
    // Try again starts where the words start, not centred under them.
    const title = canvas.getByText('Recent records didn’t load').getBoundingClientRect();
    const retry = canvas.getByRole('button', { name: 'Try again' }).getBoundingClientRect();
    await expect(Math.abs(retry.left - title.left)).toBeLessThan(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** Fill: centred in the whole height of its slot, for an empty view with the whole area. */
export const Fill: Story = {
  parameters: { crm: { screenshot: false } },
  args: { title: 'Nothing coming up', children: 'Bookings from your booking pages show up here.', layout: 'fill' },
  render: (args) => (
    <Stage height="grid">
      <EmptyState {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    // It takes the slot's height (a header and twelve rows), far more than its own block needs.
    await expect(canvas.getByRole('status').getBoundingClientRect().height).toBeGreaterThan(300);
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
