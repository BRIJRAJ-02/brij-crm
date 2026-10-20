import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingDetails, type BookingDetailsOutcome } from './BookingDetails.tsx';

const meta = {
  title: 'Modules/BookingDetails',
  component: BookingDetails,
  args: {
    onBack: fn(),
    onSubmit: fn((): Promise<BookingDetailsOutcome> => Promise.resolve({ kind: 'done' })),
  },
} satisfies Meta<typeof BookingDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty: Confirm says what's missing under each field and focuses the first. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="fill">
      <BookingDetails {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('heading', { name: 'Your details' })).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }));
    await expect(canvas.getByText('Give your name.')).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('textbox', { name: /Your name/ })).toHaveFocus());
    await userEvent.type(canvas.getByRole('textbox', { name: /Your name/ }), 'Grace Hopper');
    await userEvent.type(canvas.getByRole('textbox', { name: /Email/ }), 'grace@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Add guests' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Guest 1 email' })).toHaveFocus());
    await userEvent.type(canvas.getByRole('textbox', { name: 'Guest 1 email' }), 'alan@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }));
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Grace Hopper', email: 'grace@example.com', guests: ['alan@example.com'] }),
    );
  },
};

/** Filled from the visitor's sign in: "Booking as Ada. Not you?" clears it. */
export const Prefilled: Story = {
  args: { prefill: { name: 'Ada Lovelace', email: 'ada@example.com' } },
  render: (args) => (
    <Stage width="fill">
      <BookingDetails {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Not you?' }));
    await expect(canvas.getByRole('textbox', { name: /Your name/ })).toHaveValue('');
  },
};

/** A phone page asks for a number to call. */
export const Phone: Story = {
  parameters: { crm: { screenshot: false } },
  args: { needsPhone: true },
  render: (args) => (
    <Stage width="fill">
      <BookingDetails {...args} />
    </Stage>
  ),
};

/** The server refused: its message in the line above the buttons. */
export const Failed: Story = {
  args: {
    prefill: { name: 'Ada Lovelace', email: 'ada@example.com' },
    onSubmit: fn((): Promise<BookingDetailsOutcome> =>
      Promise.resolve({ kind: 'failed', message: 'Too many attempts just now. Wait a moment and try again.' }),
    ),
  },
  render: (args) => (
    <Stage width="fill">
      <BookingDetails {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }));
    await expect(await canvas.findByText(/Too many attempts/)).toBeInTheDocument();
  },
};
