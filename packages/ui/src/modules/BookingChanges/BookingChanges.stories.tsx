import { destroyAnnouncer } from '@react-aria/live-announcer';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingReceipt } from '../BookingReceipt/BookingReceipt.tsx';
import { BookingChanges, type BookingChangesProps, type CancelOutcome, type GuestsOutcome } from './BookingChanges.tsx';

const meta = {
  title: 'Modules/BookingChanges',
  component: BookingChanges,
  args: {
    title: 'Intro call',
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

/** At the booked card's foot: Reschedule and Guests as quiet toggles, and Cancel at the row's end. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => <OnReceipt {...args} />,
};

/**
 * Guests: who is on it with Remove on each, then Invite more as one email a row, Add another guest, and Invite, live
 * only once a row holds an address ("Invite 2" for two).
 */
export const Guests: Story = {
  args: { guests: ['ann@navy.example'] },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas, args }) => {
    const toggle = canvas.getByRole('button', { name: 'Guests' });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('region', { name: 'Guests' })).toBeInTheDocument();
    await expect(canvas.getByText('1 of 10')).toBeInTheDocument();
    const invite = canvas.getByRole('button', { name: 'Invite' });
    await expect(invite).toBeDisabled();
    await userEvent.type(canvas.getByRole('textbox', { name: 'New guest 1 email' }), 'Bob@navy.example');
    await userEvent.click(canvas.getByRole('button', { name: 'Add another guest' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'New guest 2 email' }), 'cy@navy.example');
    await userEvent.click(canvas.getByRole('button', { name: 'Invite 2' }));
    await expect(args.onInvite).toHaveBeenCalledWith(['bob@navy.example', 'cy@navy.example']);
    // Invited: one empty row again.
    await expect(canvas.getByRole('textbox', { name: 'New guest 1 email' })).toHaveValue('');
    await expect(canvas.getByText('3 of 10')).toBeInTheDocument();
    await expect(await canvas.findByRole('status')).toHaveTextContent('Invited 2 guests.');
  },
};

/** Remove asks first; Cancel (or Esc) changes nothing, and Remove guest takes them off and says so. */
export const RemoveGuest: Story = {
  parameters: { crm: { screenshot: false } },
  args: { guests: ['ann@navy.example', 'bob@navy.example'] },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas, args }) => {
    const body = within(document.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Guests' }));
    const remove = canvas.getByRole('button', { name: 'Remove ann@navy.example' });
    await userEvent.click(remove);
    const dialog = await body.findByRole('alertdialog', { name: 'Remove ann@navy.example?' });
    const labels = within(dialog)
      .getAllByRole('button')
      .map((button) => button.textContent);
    // Cancel first, the verb last.
    await expect(labels.at(-2)).toMatch(/^Cancel/);
    await expect(labels.at(-1)).toMatch(/^Remove guest/);
    await userEvent.keyboard('{Escape}');
    await expect(args.onRemove).not.toHaveBeenCalled();
    await waitFor(() => expect(remove).toHaveFocus());
    await userEvent.click(remove);
    await userEvent.click(await body.findByRole('button', { name: 'Remove guest' }));
    await expect(args.onRemove).toHaveBeenCalledWith('ann@navy.example');
    await waitFor(() => expect(body.queryByRole('alertdialog')).toBeNull());
    await expect(await canvas.findByRole('status')).toHaveTextContent('Removed ann@navy.example.');
    await expect(canvas.queryByRole('button', { name: 'Remove ann@navy.example' })).toBeNull();
    // React Aria's announcer still holds Removing…, labelled by the dialog's button that has gone (see
    // .storybook/vitest.announcer.ts); clear it so the axe check reads the page, not a 7 s leftover.
    destroyAnnouncer();
  },
};

/** A remove the server refused says why inside the dialog, which stays open to try again or cancel. */
export const RemoveFailed: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    guests: ['ann@navy.example'],
    onRemove: fn((): Promise<CancelOutcome> =>
      Promise.resolve({ kind: 'failed', message: 'Too many attempts just now.' }),
    ),
  },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas }) => {
    const body = within(document.body);
    await userEvent.click(canvas.getByRole('button', { name: 'Guests' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Remove ann@navy.example' }));
    await userEvent.click(await body.findByRole('button', { name: 'Remove guest' }));
    const dialog = body.getByRole('alertdialog', { name: 'Remove ann@navy.example?' });
    await expect(await within(dialog).findByText('Too many attempts just now.')).toBeInTheDocument();
  },
};

/** A row that isn't an address is named under itself on Enter, and nothing is sent. */
export const GuestInvalid: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Guests' }));
    // Nothing typed: Invite waits, rather than saying what's missing.
    await expect(canvas.getByRole('button', { name: 'Invite' })).toBeDisabled();
    await userEvent.type(canvas.getByRole('textbox', { name: 'New guest 1 email' }), 'not an email');
    await userEvent.click(canvas.getByRole('button', { name: 'Add another guest' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'New guest 2 email' }), 'bob@navy.example');
    await userEvent.click(canvas.getByRole('button', { name: 'Invite' }));
    await expect(canvas.getByText('Give an email address such as name@example.com.')).toBeInTheDocument();
    await expect(args.onInvite).not.toHaveBeenCalled();
  },
};

/** Cancel always asks first, naming the booking, with an optional reason; Keep booking puts focus back on Cancel booking. */
export const Cancel: Story = {
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas, args }) => {
    const body = within(document.body);
    const trigger = canvas.getByRole('button', { name: 'Cancel' });
    await userEvent.click(trigger);
    const dialog = await body.findByRole('alertdialog', { name: 'Cancel Intro call with Ada Lovelace?' });
    const labels = within(dialog)
      .getAllByRole('button')
      .map((button) => button.textContent);
    // Keep booking first, the verb last.
    await expect(labels.at(-2)).toMatch(/^Keep booking/);
    await expect(labels.at(-1)).toMatch(/^Cancel booking/);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Something came up.');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Keep booking/ }));
    await expect(args.onCancel).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    const again = await body.findByRole('alertdialog', { name: 'Cancel Intro call with Ada Lovelace?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Cancel booking' }));
    await expect(args.onCancel).toHaveBeenCalledWith('Something came up.');
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
  play: async () => {
    // Arriving from the email's Cancel link: the confirm is already open.
    const dialog = within(await within(document.body).findByRole('alertdialog'));
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel booking' }));
    await expect(await dialog.findByText(/already happened/)).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: /^Keep booking/ })).toBeEnabled();
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
    await expect(canvas.getByRole('button', { name: 'Reschedule' })).toHaveAttribute('aria-expanded', 'true');
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
    await userEvent.click(canvas.getByRole('button', { name: 'Guests' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'New guest 1 email' }), 'bob@navy.example');
    await userEvent.click(canvas.getByRole('button', { name: 'Invite' }));
    await expect(await canvas.findByText('Too many attempts just now.')).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'New guest 1 email' })).toHaveValue('bob@navy.example');
  },
};

/** A booking that can't move offers Guests and Cancel only; a full one says so in place of the field. */
export const NoMoveFull: Story = {
  parameters: { crm: { screenshot: false } },
  args: { canMove: false, maxGuests: 2, guests: ['ann@navy.example', 'bob@navy.example'] },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Reschedule' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Guests' }));
    await expect(canvas.getByText('That’s the most guests a booking takes (2).')).toBeInTheDocument();
  },
};

/**
 * Inside the page's cutoffs (spec 0062, AC-6202): Move and Cancel are the host's now, and one line says so; Guests
 * stays.
 */
export const TooLate: Story = {
  // The receipt and its row are Default's; what differs is checked in play, so no shot of its own.
  parameters: { crm: { screenshot: false } },
  args: {
    canMove: false,
    canCancel: false,
    lockedNote: 'Too close to the meeting to change it here. Reply to your confirmation email.',
  },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'Reschedule' })).toBeNull();
    await expect(canvas.getByText(/Too close to the meeting/)).toBeInTheDocument();
  },
};

/** A table reservation (spec 0066 B7): no guests, its own words for change and cancel. */
export const Reservation: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    title: 'Table for 4',
    hostName: 'Somewhere',
    maxGuests: 0,
    labels: {
      move: 'Change time',
      cancel: 'Cancel reservation',
      keep: 'Keep reservation',
      cancelTitle: 'Cancel your table for 4 at Somewhere?',
      cancelText: 'Your table goes to someone else. This can’t be undone here.',
    },
  },
  render: (args) => <OnReceipt {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Add guests' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Change time' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel reservation' }));
    const dialog = within(
      await within(document.body).findByRole('alertdialog', { name: 'Cancel your table for 4 at Somewhere?' }),
    );
    await expect(dialog.getByRole('button', { name: /^Keep reservation/ })).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: /^Keep reservation/ }));
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
            onInvite={(emails) =>
              args.onInvite(emails).then((outcome) => {
                if (outcome.kind === 'done') setGuests((current) => [...current, ...emails]);
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
