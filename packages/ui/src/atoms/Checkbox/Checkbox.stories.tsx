import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Checkbox, CheckboxMark } from './Checkbox.tsx';
import { CheckboxRow } from './CheckboxRow.tsx';

const meta = {
  title: 'Atoms/Checkbox',
  component: Checkbox,
  args: { label: 'Send a weekly digest', onChange: fn() },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Space toggles it and tells the caller. */
export const Default: Story = {
  play: async ({ canvas, args, userEvent }) => {
    const box = canvas.getByRole('checkbox', { name: 'Send a weekly digest' });
    await userEvent.tab();
    await expect(box).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(box).toBeChecked();
    await expect(args.onChange).toHaveBeenCalledWith(true);
  },
};

/** Every state: unchecked, checked, indeterminate, with a description, invalid, read only and disabled. */
export const States: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <Checkbox label="Unchecked" />
      <Checkbox label="Checked" defaultSelected />
      <Checkbox label="Some selected" isIndeterminate />
      <Checkbox label="Send a weekly digest" description="Every Monday at 9:00, in your time zone." defaultSelected />
      <Checkbox label="Accept the terms" error="Accept the terms to create the workspace." />
      <Checkbox label="Synced from Salesforce" defaultSelected isReadOnly />
      <Checkbox label="Disabled" isDisabled />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('checkbox', { name: 'Accept the terms' })).toHaveAccessibleDescription(
      'Accept the terms to create the workspace.',
    );
    await expect(canvas.getByRole('checkbox', { name: 'Disabled' })).toBeDisabled();
  },
};

/** Rows: a dish's add-ons on the guest menu, each a row with its price at the end, the whole row toggling it. */
export const Rows: Story = {
  render: () => (
    <Stage width="dialog" direction="column">
      <CheckboxRow label="Soft egg" description="+£1.50" />
      <CheckboxRow label="Extra chashu" description="+£3.00" defaultSelected />
      <CheckboxRow label="Bamboo shoots" description="+£1.00" isDisabled />
      <CheckboxRow label="Spring onion" description="Free" defaultSelected isReadOnly />
      <CheckboxRow label="Chilli oil" error="Choose chilli oil to add this." />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const egg = canvas.getByRole('checkbox', { name: 'Soft egg' });
    await expect(egg).toHaveAccessibleDescription('+£1.50');
    // A press on the price, at the row's end, toggles the row (asked of the browser: what is under that point).
    const price = canvas.getByText('+£1.50').getBoundingClientRect();
    const under = document.elementFromPoint(price.left + price.width / 2, price.top + price.height / 2);
    await expect(under?.closest('label')).toBe(egg.closest('label'));
    await userEvent.click(egg);
    await expect(egg).toBeChecked();
  },
};

/** The label for screen readers only, as in a table's header. */
export const HiddenLabel: Story = {
  args: { label: 'Select all', isLabelHidden: true, isIndeterminate: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('checkbox', { name: 'Select all' })).toBePartiallyChecked();
  },
};

/** The mark alone, as grid cells draw it: the cell is the control, so hundreds of rows need no checkbox each. */
export const Mark: Story = {
  render: () => (
    <Stage>
      <CheckboxMark label="Is customer" isSelected={false} />
      <CheckboxMark label="Is customer" isSelected />
      <CheckboxMark label="Select the rows on screen" isSelected={false} isIndeterminate />
      <CheckboxMark label="Has API" isSelected isReadOnly />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Is customer, checked')).toBeInTheDocument();
    await expect(canvas.queryByRole('checkbox')).toBeNull();
  },
};
