import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { NumberField } from './NumberField.tsx';

const meta = {
  title: 'Molecules/NumberField',
  component: NumberField,
  args: { label: 'Seats', onChange: fn() },
} satisfies Meta<typeof NumberField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A count: ↑ and ↓ step it, End goes to the limit, and the value is committed as it steps. */
export const Count: Story = {
  parameters: { crm: { preview: true } },
  args: { defaultValue: 4, minValue: 1, maxValue: 20, unit: 'seats' },
  render: (args) => (
    <Stage width="narrow-fill">
      <NumberField {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'Seats' });
    await userEvent.click(field);
    await userEvent.keyboard('{ArrowUp}');
    await expect(field).toHaveValue('5');
    await expect(args.onChange).toHaveBeenLastCalledWith(5);
    // The step is said politely: a plain text box says nothing when ↑ changes it.
    await expect(canvas.getByRole('status')).toHaveTextContent('5');
    await userEvent.keyboard('{End}');
    await expect(field).toHaveValue('20');
    await userEvent.keyboard('{PageDown}');
    await expect(field).toHaveValue('10');
    await userEvent.keyboard('{Home}');
    await expect(field).toHaveValue('1');
  },
};

/** Money: the symbol in front, two decimals, written neatly once the field is left. */
export const Currency: Story = {
  args: { label: 'Deal value', mode: 'currency', currency: 'USD', minValue: 0 },
  render: (args) => (
    <Stage width="narrow-fill">
      <NumberField {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'Deal value' });
    await expect(canvas.getByText('$')).toBeInTheDocument();
    await userEvent.type(field, '1234.5');
    await expect(args.onChange).not.toHaveBeenCalled();
    await userEvent.tab();
    await expect(field).toHaveValue('1,234.50');
    await expect(args.onChange).toHaveBeenLastCalledWith(1234.5);
    // What is saved is what is shown: three decimals typed as money are saved rounded to its two.
    await userEvent.clear(field);
    await userEvent.type(field, '12.345');
    await userEvent.tab();
    await expect(field).toHaveValue('12.35');
    await expect(args.onChange).toHaveBeenLastCalledWith(12.35);
  },
};

/**
 * In German, which groups with a point: a stored 1234 shows as 1.234 and reads back as 1234 after an edit that
 * changes nothing, and 1.500 typed is fifteen hundred; 2,5 and a typed 2.5 are both two and a half.
 */
export const German: Story = {
  globals: { locale: 'de-DE' },
  parameters: { crm: { screenshot: false } },
  args: { label: 'Capacity', defaultValue: 1234 },
  render: (args) => (
    <Stage width="narrow-fill">
      <NumberField {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'Capacity' });
    await expect(field).toHaveValue('1.234');
    await userEvent.click(field);
    await userEvent.keyboard('5{Backspace}');
    await userEvent.tab();
    await expect(field).toHaveValue('1.234');
    await expect(args.onChange).not.toHaveBeenCalled();
    await userEvent.clear(field);
    await userEvent.type(field, '1.500');
    await userEvent.tab();
    await expect(args.onChange).toHaveBeenLastCalledWith(1500);
    await expect(field).toHaveValue('1.500');
    await userEvent.clear(field);
    await userEvent.type(field, '2.5');
    await userEvent.tab();
    await expect(args.onChange).toHaveBeenLastCalledWith(2.5);
    await expect(field).toHaveValue('2,5');
  },
};

/** In Bengali, which writes its own digits: an edit to the shown value reads in those digits. */
export const Bengali: Story = {
  globals: { locale: 'bn-IN' },
  parameters: { crm: { screenshot: false } },
  args: { label: 'Capacity', defaultValue: 1234 },
  render: (args) => (
    <Stage width="narrow-fill">
      <NumberField {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'Capacity' });
    await expect(field).toHaveValue('১,২৩৪');
    await userEvent.click(field);
    await userEvent.keyboard('{End}{Backspace}');
    await userEvent.tab();
    await expect(args.onChange).toHaveBeenLastCalledWith(123);
    await expect(field).toHaveValue('১২৩');
  },
};

/** A text that isn't a number goes back to the last good value; a number past the limit is held at it. */
export const Refused: Story = {
  args: { label: 'Discount', mode: 'percent', defaultValue: 10 },
  render: (args) => (
    <Stage width="narrow-fill">
      <NumberField {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'Discount' });
    await expect(canvas.getByText('%')).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, 'abc{Enter}');
    await expect(field).toHaveValue('10');
    await userEvent.clear(field);
    await userEvent.type(field, '250{Enter}');
    await expect(field).toHaveValue('100');
  },
};

/** Step buttons for a small count changed one at a time; the minus turns off at the lower limit. */
export const Steppers: Story = {
  render: function Steppers(args) {
    const [guests, setGuests] = useState<number | undefined>(1);
    return (
      <Stage width="narrow-fill">
        <NumberField
          {...args}
          label="Guests"
          value={guests}
          onChange={setGuests}
          minValue={1}
          maxValue={8}
          showSteppers
        />
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const fewer = canvas.getByRole('button', { name: 'Decrease Guests' });
    await expect(fewer).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Increase Guests' }));
    await expect(canvas.getByRole('textbox', { name: 'Guests' })).toHaveValue('2');
    await expect(fewer).toBeEnabled();
  },
};

/** An error says how to fix it; disabled and read only keep the value and refuse the keys. */
export const States: Story = {
  render: (args) => (
    <Stage direction="column" width="narrow-fill">
      <NumberField {...args} label="Minimum notice" unit="min" defaultValue={0} error="Give at least 15 minutes." />
      {/* Disabled with no unit: a disabled field dims its suffix, which WCAG exempts (an inactive control) and axe
          can't tell from live text. */}
      <NumberField {...args} label="Buffer" defaultValue={10} isDisabled />
      <NumberField
        {...args}
        label="Duration"
        unit="min"
        defaultValue={30}
        isReadOnly
        readOnlyReason="Set by the team"
      />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('textbox', { name: 'Minimum notice' })).toHaveAttribute('aria-invalid', 'true');
    await expect(canvas.getByRole('textbox', { name: 'Buffer' })).toBeDisabled();
    const readOnly = canvas.getByRole('textbox', { name: 'Duration' });
    await userEvent.click(readOnly);
    await userEvent.keyboard('{ArrowUp}');
    await expect(readOnly).toHaveValue('30');
  },
};
