import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { GuestChips } from './GuestChips.tsx';

const GUESTS = ['grace@example.com', 'alan@example.com', 'katherine.johnson@example.com'];

const meta = {
  title: 'Molecules/GuestChips',
  component: GuestChips,
  args: { guests: GUESTS, label: 'Guests to invite', removeLabel: (guest: string) => `Remove ${guest}` },
  render: (args) => (
    <Stage width="narrow">
      <GuestChips {...args} />
    </Stage>
  ),
} satisfies Meta<typeof GuestChips>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Guests that can be removed: each chip's remove button is reachable and named with its address. */
export const Default: Story = {
  render: function Removable(args) {
    const [guests, setGuests] = useState<readonly string[]>(GUESTS);
    return (
      <Stage width="narrow">
        <GuestChips {...args} guests={guests} onRemove={(index) => setGuests(guests.filter((_, at) => at !== index))} />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Remove alan@example.com' }));
    await expect(canvas.queryByText('alan@example.com')).not.toBeInTheDocument();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2);
  },
};

/** A guest the server turned down: the danger edge on that chip. */
export const Invalid: Story = { args: { invalid: new Set([1]), onRemove: () => undefined } };

/** Read only: no remove buttons. */
export const ReadOnly: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.queryAllByRole('button')).toHaveLength(0);
  },
};

/** No guests: nothing is drawn. */
export const Empty: Story = {
  args: { guests: [] },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('ul')).toBeNull();
  },
};
