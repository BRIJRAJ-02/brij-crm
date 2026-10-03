import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Field } from './Field.tsx';

const meta = {
  title: 'Molecules/Field',
  component: Field,
  args: { label: 'Domain', placeholder: 'Set Domain…', onChange: fn() },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Typing tells the caller each change. */
export const Default: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Field {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Domain' });
    await userEvent.click(input);
    await userEvent.keyboard('northwind.com');
    await expect(args.onChange).toHaveBeenLastCalledWith('northwind.com');
  },
};

/** Every state: a hint, a prefix, an error, read only with its reason, and disabled. */
export const States: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column" width="narrow">
      <Field label="Domain" placeholder="Set Domain…" hint="Without https:// or a path." />
      <Field label="Annual revenue" prefix="USD" defaultValue="1,250,000" inputMode="decimal" />
      <Field label="Domain" defaultValue="northwind .com" error="Enter a domain like halcyonlabs.io, without spaces." />
      <Field
        label="Record ID"
        defaultValue="rec_8c1f2"
        isReadOnly
        readOnlyReason="Set by the system when the record is created."
      />
      <Field
        label="Plan"
        defaultValue="Business"
        isDisabled
        disabledReason="Only workspace admins can change the plan."
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const invalid = canvas.getByRole('textbox', { name: 'Domain', description: /without spaces/ });
    await expect(invalid).toHaveAttribute('aria-invalid', 'true');
    await expect(canvas.getByRole('textbox', { name: 'Record ID' })).toHaveAttribute('readonly');
  },
};

/**
 * An error takes the hint's place: one line under the field, read as its
 * description. A read only or disabled reason would still show.
 */
export const ErrorReplacesHint: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="narrow">
      <Field
        label="Domain"
        defaultValue="northwind .com"
        hint="Without https:// or a path."
        error="Enter a domain like halcyonlabs.io, without spaces."
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Domain' });
    await expect(input).toHaveAccessibleDescription('Enter a domain like halcyonlabs.io, without spaces.');
    await expect(canvas.queryByText('Without https:// or a path.')).toBeNull();
  },
};

function Counted() {
  const [value, setValue] = useState('Met at SaaStr. Interested in the API.');
  return (
    <Field
      label="Description"
      isMultiline
      maxLength={500}
      showCounter
      value={value}
      onChange={setValue}
      placeholder="Set Description…"
    />
  );
}

/** Long text: a textarea that grows, with a counter. */
export const Multiline: Story = {
  render: () => (
    <Stage width="narrow">
      <Counted />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('37/500')).toBeInTheDocument();
  },
};

/** The search variant and the small size a cell editor uses. */
export const Variants: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Field label="Search records" isLabelHidden variant="search" placeholder="Search records…" />
      <Field label="Name" isLabelHidden size="sm" defaultValue="Northwind Traders" />
    </Stage>
  ),
};
