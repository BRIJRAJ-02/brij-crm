import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { TilePicker, type TileItem, type TilePickerProps } from './TilePicker.tsx';

const ITEMS: readonly TileItem[] = [
  { id: 'text', label: 'Text', icon: 'type', hint: 'A line of words', group: 'Basic' },
  { id: 'number', label: 'Number', icon: 'hash', hint: 'A count or amount', group: 'Basic' },
  { id: 'date', label: 'Date', icon: 'calendar', hint: 'A day', group: 'Basic' },
  { id: 'checkbox', label: 'Checkbox', icon: 'square-check', hint: 'Yes or no', group: 'Basic' },
  { id: 'email', label: 'Email', icon: 'at-sign', hint: 'An email address', group: 'Contact' },
  { id: 'phone', label: 'Phone', icon: 'phone', hint: 'A phone number', group: 'Contact' },
  { id: 'select', label: 'Select', icon: 'list', hint: 'One from a list', group: 'Choice' },
  { id: 'status', label: 'Status', icon: 'circle-dot', hint: 'Stages in order', group: 'Choice' },
];

const meta = {
  title: 'Molecules/TilePicker',
  component: TilePicker,
  args: { label: 'Type', items: ITEMS, value: 'text', onChange: fn() },
} satisfies Meta<typeof TilePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The picker holding its own choice, as a form would. */
function HeldPicker(props: TilePickerProps) {
  const [value, setValue] = useState(props.value);
  return (
    <Stage width="dialog">
      <TilePicker
        {...props}
        value={value}
        onChange={(id) => {
          setValue(id);
          props.onChange(id);
        }}
      />
    </Stage>
  );
}

/** Every kind in sight under its heading; the arrow keys move and Enter picks. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  // A component of its own, not hooks in `render`: the artifact's preview calls `render` as a plain function.
  render: (args) => <HeldPicker {...args} />,
  play: async ({ canvas, userEvent, args }) => {
    // Each tile is an option named by its label alone, as a Select's option was.
    await expect(canvas.getByRole('option', { name: 'Text' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(canvas.getByRole('option', { name: 'Email' }));
    await expect(args.onChange).toHaveBeenCalledWith('email');
    await expect(canvas.getByRole('option', { name: 'Email' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}{Enter}');
    await expect(args.onChange).toHaveBeenLastCalledWith('phone');
  },
};

/** In a narrow slot the tiles go two a row. */
export const Narrow: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="narrow">
      <TilePicker {...args} />
    </Stage>
  ),
};

/** Disabled: nothing picks, and the label fades. */
export const Disabled: Story = {
  args: { isDisabled: true },
  render: (args) => (
    <Stage width="dialog">
      <TilePicker {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('option', { name: 'Email' })).toHaveAttribute('aria-disabled', 'true');
  },
};

/** An error line under the tiles. */
export const WithError: Story = {
  parameters: { crm: { screenshot: false } },
  args: { error: 'Pick a type.' },
  render: (args) => (
    <Stage width="dialog">
      <TilePicker {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Pick a type.')).toBeInTheDocument();
  },
};
