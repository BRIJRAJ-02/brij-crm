import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Checkbox } from './Checkbox.tsx';

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

/** The label for screen readers only, as in a table's header. */
export const HiddenLabel: Story = {
  args: { label: 'Select all', isLabelHidden: true, isIndeterminate: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('checkbox', { name: 'Select all' })).toBePartiallyChecked();
  },
};
