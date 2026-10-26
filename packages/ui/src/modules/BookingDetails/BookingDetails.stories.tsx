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

/** The page's own questions (spec 0057), after the note: Show when hides one until it applies, and a required one says so. */
export const Questions: Story = {
  args: {
    prefill: { name: 'Ada Lovelace', email: 'ada@example.com' },
    countryGuess: 'GB',
    questions: [
      {
        id: 'size',
        key: 'team_size',
        label: 'Team size',
        answerType: 'choice',
        choices: ['Just me', '2 to 10', 'More than 10'],
        required: true,
      },
      {
        id: 'tools',
        key: 'tools',
        label: 'What do you use today?',
        answerType: 'short_text',
        required: false,
        showWhen: { join: 'all', rules: [{ key: 'team_size', op: 'is', value: 'More than 10' }] },
      },
      { id: 'phone', key: 'mobile', label: 'Mobile', answerType: 'phone', required: false },
    ],
  },
  render: (args) => (
    <Stage width="fill">
      <BookingDetails {...args} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.queryByRole('textbox', { name: /What do you use today/ })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }));
    await expect(args.onSubmit).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('radio', { name: 'More than 10' }));
    await expect(canvas.getByRole('textbox', { name: /What do you use today/ })).toBeInTheDocument();
    await userEvent.type(canvas.getByRole('textbox', { name: /What do you use today/ }), 'Spreadsheets');
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }));
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: { team_size: 'More than 10', tools: 'Spreadsheets', mobile: undefined },
      }),
    );
  },
};

/** The server refused a question's answer: the message lands under that question, and focus moves to it. */
export const QuestionRefused: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    prefill: { name: 'Ada Lovelace', email: 'ada@example.com' },
    questions: [{ id: 'role', key: 'role', label: 'Your role', answerType: 'short_text', required: false }],
    onSubmit: fn((): Promise<BookingDetailsOutcome> =>
      Promise.resolve({ kind: 'invalid', fields: { 'answers.role': 'Keep it to one line.' } }),
    ),
  },
  render: (args) => (
    <Stage width="fill">
      <BookingDetails {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: /Your role/ }), 'Engineer');
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }));
    await expect(await canvas.findByText('Keep it to one line.')).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('textbox', { name: /Your role/ })).toHaveFocus());
  },
};
