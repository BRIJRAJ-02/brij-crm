import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { ChoiceChips } from '../../molecules/ChoiceChips/ChoiceChips.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingDetails, type BookingDetailsDraft, type BookingDetailsOutcome } from './BookingDetails.tsx';

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
    // At a pointer, the first empty field takes focus as the step arrives.
    await expect(canvas.getByRole('textbox', { name: /Your name/ })).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }));
    await expect(canvas.getByText('Give your name.')).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('textbox', { name: /Your name/ })).toHaveFocus());
    await userEvent.type(canvas.getByRole('textbox', { name: /Your name/ }), 'Grace Hopper');
    await userEvent.type(canvas.getByRole('textbox', { name: /Email/ }), 'grace@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Add guests' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Guest 1 email' })).toHaveFocus());
    // Enter in a filled last row opens the next one.
    await userEvent.type(canvas.getByRole('textbox', { name: 'Guest 1 email' }), 'alan@example.com{Enter}');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Guest 2 email' })).toHaveFocus());
    await userEvent.type(canvas.getByRole('textbox', { name: 'Guest 2 email' }), 'katherine@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }));
    await expect(args.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Grace Hopper',
        email: 'grace@example.com',
        guests: ['alan@example.com', 'katherine@example.com'],
      }),
    );
  },
};

/**
 * The booking page's step (`arrangement="paired"`, the v5 mock): Name and Email side by side at the public pages'
 * taller field, the page's own questions, the guests' rows, then the note.
 */
export const Paired: Story = {
  args: {
    arrangement: 'paired',
    questions: [
      { id: 'cover', key: 'cover', label: 'What would you like to cover?', answerType: 'long_text', required: false },
    ],
  },
  render: (args) => (
    <Stage width="fill">
      <BookingDetails {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const name = canvas.getByRole('textbox', { name: /Your name/ });
    const email = canvas.getByRole('textbox', { name: /Email/ });
    // Side by side on a wide card: one row.
    await expect(Math.abs(name.getBoundingClientRect().top - email.getBoundingClientRect().top)).toBeLessThan(2);
    await userEvent.click(canvas.getByRole('button', { name: 'Add guests' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Guest 1 email' })).toHaveFocus());
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

/** A table reservation (spec 0066 B7): a phone to call, no invites, its own words, the occasion as chips (the page's). */
export const Reservation: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <WithOccasion {...args} />,
  args: {
    needsPhone: true,
    maxGuests: 0,
    labels: {
      confirm: 'Reserve',
      confirming: 'Reserving',
      done: 'Reserved',
      note: 'Anything the restaurant should know?',
    },
    questions: [
      {
        id: 'marketing',
        key: 'marketing',
        label: 'Send me news and offers from Somewhere.',
        answerType: 'checkbox',
        required: false,
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Reserve' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Add guests' })).toBeNull();
    await expect(canvas.getByText('Birthday')).toBeInTheDocument();
  },
};

/** The occasion as the reservation page holds it: chips by key, after the note. */
function WithOccasion(args: Parameters<typeof BookingDetails>[0]) {
  const [occasion, setOccasion] = useState<readonly string[]>([]);
  return (
    <Stage width="fill">
      <BookingDetails
        {...args}
        extra={
          <ChoiceChips
            label="Occasion"
            labelAside="Optional"
            tone="strong"
            isSingle
            choices={[
              { id: 'birthday', label: 'Birthday' },
              { id: 'anniversary', label: 'Anniversary' },
              { id: 'date', label: 'Date night' },
              { id: 'business', label: 'Business' },
              { id: 'other', label: 'Other' },
            ]}
            selected={occasion}
            onChange={setOccasion}
          />
        }
      />
    </Stage>
  );
}

/** One page (a table reservation after checklabs): no Back, the send button the form's width, named for the time. */
export const OnePage: Story = {
  render: (args) => <WithOccasion {...args} />,
  play: async ({ canvas }) => {
    // Nothing arrives on a one page form: no field takes focus, and there is no Back.
    await expect(canvas.getByRole('textbox', { name: /Your name/ })).not.toHaveFocus();
    await expect(canvas.queryByRole('button', { name: 'Back' })).toBeNull();
    // What the page still needs is said before any field is checked.
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm Fri 26 Jun at 19:30' }));
    await expect(canvas.getByText('Choose a time first.')).toBeInTheDocument();
    await expect(canvas.queryByText('Give your name.')).toBeNull();
  },
  args: {
    needsPhone: true,
    maxGuests: 0,
    onBack: undefined,
    labels: {
      heading: 'Your details',
      confirm: 'Confirm Fri 26 Jun at 19:30',
      confirming: 'Confirming',
      done: 'Confirmed',
    },
    blocked: () => 'Choose a time first.',
  },
};

/**
 * A restaurant's details step after checklabs (5 November 2026): the guest's 42px fields, Full name, Phone, Email and
 * Special requests in that order, a line under the heading, Back beside a send button that takes the row, and a line
 * under it. Phone and email are both required.
 */
export const GuestReservation: Story = {
  render: (args) => <WithOccasion {...args} />,
  args: {
    needsPhone: true,
    maxGuests: 0,
    fieldSize: 'lg',
    isPhoneFirst: true,
    intro: 'We’ll send your confirmation here. Free to cancel — no prepayment needed.',
    confirmNote: 'Free cancellation · No prepayment required',
    labels: {
      name: 'Full name',
      phone: 'Phone',
      note: 'Special requests',
      notePlaceholder: 'Dietary, high chair, accessibility…',
      confirm: 'Confirm Fri 26 Jun at 19:30',
      confirming: 'Confirming',
      done: 'Confirmed',
    },
    questions: [
      {
        id: 'marketing',
        key: 'marketing',
        label: 'Send me news and offers from Somewhere.',
        answerType: 'checkbox',
        required: false,
      },
    ],
  },
  play: async ({ canvas, canvasElement }) => {
    const fields = [...canvasElement.querySelectorAll('input[name], textarea[name]')].map((field) =>
      field.getAttribute('name'),
    );
    await expect(fields.slice(0, 4)).toEqual(['name', 'phone', 'email', 'note']);
    await expect(canvas.getByText('Free cancellation · No prepayment required')).toBeInTheDocument();
    await expect(canvas.getByRole('checkbox', { name: /news and offers/ })).not.toBeChecked();
    // Both ways to reach the guest are required: an empty Confirm marks the name first, then the phone and the email.
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm Fri 26 Jun at 19:30' }));
    await expect(await canvas.findByText('Give a number to call you on.')).toBeInTheDocument();
    await expect(canvas.getByText(/Give an email address/)).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole('textbox', { name: /Full name/ })).toHaveFocus());
  },
};

/**
 * The page keeps what is typed (`onDraft`) while the step is away and hands it back (`draft`): Back, then the step
 * again, and every field is as the guest left it, with no "Booking as" line.
 */
export const KeepsTheDraft: Story = {
  parameters: { crm: { screenshot: false } },
  args: { needsPhone: true, maxGuests: 0, isPhoneFirst: true, fieldSize: 'lg' },
  render: (args) => <Drafting {...args} />,
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: /Your name/ }), 'Ada Lovelace');
    await userEvent.type(canvas.getByRole('textbox', { name: /Number to call/ }), '07700 900123');
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Open the step again' }));
    await expect(canvas.getByRole('textbox', { name: /Your name/ })).toHaveValue('Ada Lovelace');
    await expect(canvas.getByRole('textbox', { name: /Number to call/ })).toHaveValue('07700 900123');
    await expect(canvas.queryByText(/Booking as/)).toBeNull();
  },
};

/** The step away and back, as a one page form's Back does, with the draft kept by the page. */
function Drafting(args: Parameters<typeof BookingDetails>[0]) {
  const [isOpen, setOpen] = useState(true);
  const [draft, setDraft] = useState<BookingDetailsDraft | undefined>(undefined);
  return (
    <Stage width="fill">
      {isOpen ? (
        <BookingDetails
          {...args}
          {...(draft === undefined ? {} : { draft })}
          onDraft={setDraft}
          onBack={() => setOpen(false)}
        />
      ) : (
        <Button onPress={() => setOpen(true)}>Open the step again</Button>
      )}
    </Stage>
  );
}

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
