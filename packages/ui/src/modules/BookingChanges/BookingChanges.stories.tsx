import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingReceipt } from '../BookingReceipt/BookingReceipt.tsx';
import { BookingChanges, type BookingChangesProps, type CancelOutcome, type GuestsOutcome } from './BookingChanges.tsx';

const meta = {
  title: 'Modules/BookingChanges',
  component: BookingChanges,
  args: {
    hostName: 'Ada Lovelace',
    guests: [],
    canMove: true,
    move: 'The booking page’s own picker goes here.',
    onInvite: fn((): Promise<GuestsOutcome> => Promise.resolve({ kind: 'done', added: 1 })),
    onRemove: fn((): Promise<CancelOutcome> => Promise.resolve({ kind: 'done' })),
    onCancel: fn((): Promise<CancelOutcome> => Promise.resolve({ kind: 'done' })),
  },
} satisfies Meta<typeof BookingChanges>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Under the guest's booking: Need a change?, the two changes as equal toggles, and Cancel booking at the row's end. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => <OnReceipt {...args} />,
};

/** Guests: one list with Remove on each, then one field whose Add (or Enter) invites, and the count. */
export const Guests: Story = {
  args: { guests: ['ann@navy.example'] },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas, args }) => {
    const toggle = canvas.getByRole('button', { name: 'Guests (1)' });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('region', { name: 'Guests' })).toBeInTheDocument();
    await expect(canvas.getByText('1 of 10')).toBeInTheDocument();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Add a guest by email' }), 'Bob@navy.example{Enter}');
    await expect(args.onInvite).toHaveBeenCalledWith('bob@navy.example');
    // Enter added them: the field is empty again and keeps focus.
    await expect(canvas.getByRole('textbox', { name: 'Add a guest by email' })).toHaveValue('');
    await expect(canvas.getByRole('textbox', { name: 'Add a guest by email' })).toHaveFocus();
    await expect(canvas.getByText('2 of 10')).toBeInTheDocument();
    await expect(await canvas.findByRole('status')).toHaveTextContent('Invited bob@navy.example.');
    await userEvent.click(canvas.getByRole('button', { name: 'Remove ann@navy.example' }));
    await expect(args.onRemove).toHaveBeenCalledWith('ann@navy.example');
  },
};

/** A wrong address is named under the field, and nothing is sent. */
export const GuestInvalid: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add guests' }));
    // Add with nothing typed says what's missing rather than looking disabled.
    await userEvent.click(canvas.getByRole('button', { name: 'Add' }));
    await expect(canvas.getByText('Give an email address such as name@example.com.')).toBeInTheDocument();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Add a guest by email' }), 'not an email{Enter}');
    await expect(canvas.getByText('Give an email address such as name@example.com.')).toBeInTheDocument();
    await expect(args.onInvite).not.toHaveBeenCalled();
  },
};

/** Cancel always asks first, with an optional reason; Keep it puts focus back on Cancel booking. */
export const Cancel: Story = {
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel booking' }));
    await expect(canvas.getByRole('heading', { name: 'Cancel this booking?' })).toBeInTheDocument();
    await userEvent.type(canvas.getByRole('textbox', { name: 'Reason' }), 'Something came up.');
    await userEvent.click(canvas.getByRole('button', { name: 'Keep it' }));
    await expect(canvas.getByRole('button', { name: 'Cancel booking' })).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel booking' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, cancel it' }));
    await expect(args.onCancel).toHaveBeenCalledWith('');
  },
};

/** A cancel the server refused says why, above the buttons. */
export const CancelFailed: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    startsWith: 'cancel',
    onCancel: fn((): Promise<CancelOutcome> =>
      Promise.resolve({
        kind: 'failed',
        message: 'That meeting has already happened, so it can no longer be cancelled.',
      }),
    ),
  },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Yes, cancel it' }));
    await expect(await canvas.findByText(/already happened/)).toBeInTheDocument();
  },
};

/** Arriving from Move: the picker open under its title, with which clock its times are on; Moved. over the card after. */
export const MoveOpen: Story = {
  args: { startsWith: 'move', moveNote: 'Times in London time (GMT+1)' },
  render: (args) => (
    <OnReceipt {...args} notice="Moved. Both calendars are updated and a confirmation is on its way." />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('region', { name: 'Pick a new time' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Move to another time' })).toHaveAttribute('aria-expanded', 'true');
  },
};

/** An invitation the server refused says why, under the list; the address stays to fix. */
export const InviteFailed: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    onInvite: fn((): Promise<GuestsOutcome> =>
      Promise.resolve({ kind: 'failed', message: 'Too many attempts just now.' }),
    ),
  },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add guests' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Add a guest by email' }), 'bob@navy.example{Enter}');
    await expect(await canvas.findByText('Too many attempts just now.')).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Add a guest by email' })).toHaveValue('bob@navy.example');
  },
};

/** A booking that can't move offers Guests and Cancel only; a full one says so in place of the field. */
export const NoMoveFull: Story = {
  parameters: { crm: { screenshot: false } },
  args: { canMove: false, maxGuests: 2, guests: ['ann@navy.example', 'bob@navy.example'] },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Move to another time' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Guests (2)' }));
    await expect(canvas.getByText('That’s the most guests a booking takes (2).')).toBeInTheDocument();
  },
};

/** On the guest's receipt, where the page puts it, with its guests kept as the page keeps them. */
function OnReceipt(args: BookingChangesProps & { readonly notice?: string }) {
  const [guests, setGuests] = useState(args.guests);
  return (
    <Stage width="fill" height="page">
      <BookingReceipt
        state="confirmed"
        hostName="Ada Lovelace"
        date={{ weekday: 'Fri', day: '9', month: 'Oct' }}
        range="9:30 – 10:00 AM"
        when="Friday, October 9, 2026 · London time (GMT+1)"
        relative="Tomorrow morning"
        facts={[{ term: 'What', description: 'Intro call' }]}
        {...(args.notice === undefined ? {} : { notice: <Callout tone="success">{args.notice}</Callout> })}
        changes={
          <BookingChanges
            {...args}
            guests={guests}
            onInvite={(email) =>
              args.onInvite(email).then((outcome) => {
                if (outcome.kind === 'done') setGuests((current) => [...current, email]);
                return outcome;
              })
            }
            onRemove={(email) =>
              args.onRemove(email).then((outcome) => {
                if (outcome.kind === 'done') setGuests((current) => current.filter((each) => each !== email));
                return outcome;
              })
            }
          />
        }
      />
    </Stage>
  );
}
