import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { PartyBand } from './PartyBand.tsx';

const meta = {
  title: 'Modules/PartyBand',
  component: PartyBand,
  args: { value: 2, min: 1, max: 4, onChange: fn(), phone: '020 7946 0000' },
} satisfies Meta<typeof PartyBand>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two guests, the page's default: one fewer and one more both on. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => <Counting {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Party size')).toBeInTheDocument();
    await expect(canvas.getByText('Up to 4 guests')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'One more guest' }));
    await expect(canvas.getByRole('group', { name: 'Party size' })).toHaveTextContent('3');
    await expect(canvas.queryByText(/More than/)).toBeNull();
  },
};

/** At the most: one more is off, focus moves to one fewer, and the way to book a bigger table shows with the phone. */
export const AtTheMost: Story = {
  args: { value: 3 },
  render: (args) => <Counting {...args} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'One more guest' }));
    await expect(canvas.getByRole('button', { name: 'One more guest' })).toBeDisabled();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'One fewer guest' })).toHaveFocus());
    await expect(canvas.getByText(/More than 4\?/)).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Call 020 7946 0000' })).toHaveAttribute('href', 'tel:02079460000');
  },
};

/** At the most with no phone on the page: the line says to call the restaurant. */
export const NoPhone: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: 4, phone: undefined },
  render: (args) => <Counting {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Call the restaurant\./)).toBeInTheDocument();
  },
};

/** At the fewest: one fewer is off. */
export const AtTheFewest: Story = {
  parameters: { crm: { screenshot: false } },
  args: { value: 1 },
  render: (args) => <Counting {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'One fewer guest' })).toBeDisabled();
  },
};

/** The story's own count, as the page keeps it. */
function Counting(args: ComponentProps<typeof PartyBand>) {
  const [value, setValue] = useState(args.value);
  return (
    <Stage width="narrow">
      <PartyBand {...args} value={value} onChange={setValue} />
    </Stage>
  );
}
