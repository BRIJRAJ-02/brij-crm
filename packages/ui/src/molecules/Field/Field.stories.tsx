import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
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

function Counted({ label, maxLength }: { readonly label: string; readonly maxLength: number }) {
  const [value, setValue] = useState('Met at SaaStr. Interested in the API.');
  return (
    <Field
      label={label}
      isMultiline
      maxLength={maxLength}
      showCounter
      value={value}
      onChange={setValue}
      placeholder={`Set ${label}…`}
    />
  );
}

/** Long text: a textarea that grows. Its count shows only once the text nears the limit. */
export const Multiline: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Counted label="Description" maxLength={500} />
      <Counted label="Summary" maxLength={40} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByText('37/500')).toBeNull();
    await expect(canvas.getByText('37/40')).toBeInTheDocument();
  },
};

function Wrapping() {
  const [value, setValue] = useState('Send the renewal proposal');
  const [submitted, setSubmitted] = useState('');
  return (
    <>
      <Field
        label="Title"
        isWrapping
        maxLength={2000}
        showCounter
        value={value}
        onChange={setValue}
        onSubmit={() => {
          setSubmitted(value);
        }}
      />
      <Field
        label="Long title"
        isWrapping
        defaultValue="Send the renewal proposal with the new pricing tiers, the security review answers and the case study"
      />
      <output>{submitted}</output>
    </>
  );
}

/** A one line value that wraps (a task's title): one line tall, a line more as it wraps, and Enter submits. */
export const Wraps: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Wrapping />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const title = canvas.getByRole('textbox', { name: 'Title' });
    const long = canvas.getByRole('textbox', { name: 'Long title' });
    // One line tall, and the long one taller as it wraps.
    await expect(long.getBoundingClientRect().height).toBeGreaterThan(title.getBoundingClientRect().height);
    await userEvent.click(title);
    await userEvent.keyboard('{End} today{Enter}');
    await expect(title).toHaveValue('Send the renewal proposal today');
    await expect(canvas.getByText('Send the renewal proposal today', { selector: 'output' })).toBeInTheDocument();
    await expect(canvas.queryByText(/\/2,000/)).toBeNull();
    // Enter that ends an input method's composition never submits.
    await userEvent.type(title, ' 東京');
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    await expect(canvas.getByText('Send the renewal proposal today', { selector: 'output' })).toBeInTheDocument();
  },
};

/** The search variant, and the small size of a filter value or a record panel row. A grid cell edits in the `cell` variant (the DataGrid stories). */
export const Variants: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Field label="Search records" isLabelHidden variant="search" placeholder="Search records…" />
      <Field label="Name" isLabelHidden size="sm" defaultValue="Northwind Traders" />
    </Stage>
  ),
};

/** The copy variant: a public link to copy, read only but drawn live, with no lock. Focus selects the whole value. */
export const Copy: Story = {
  render: () => (
    <Stage width="narrow">
      <Field label="Public link" variant="copy" value="https://timefix.app/b/intro-call" copyLabel="Copy link" />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole<HTMLInputElement>('textbox', { name: 'Public link' });
    await expect(input).toHaveAttribute('readonly');
    await expect(canvas.queryByRole('img', { name: 'Read only' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    await userEvent.click(input);
    await waitFor(() => expect(input.selectionEnd).toBe(input.value.length));
    await expect(input.selectionStart).toBe(0);
  },
};
