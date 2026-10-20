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

/** The copy variant: a public link and an embed code to copy, read only but drawn live, with no lock. Focus selects the whole value. */
export const Copy: Story = {
  render: () => (
    <Stage width="narrow">
      <Field label="Public link" variant="copy" value="https://timefix.app/b/intro-call" copyLabel="Copy link" />
      <Field
        label="Embed code"
        variant="copy"
        isMultiline
        copyLabel="Copy embed code"
        value={'<div data-crm-form="enquiry"></div>\n<script src="https://timefix.app/embed.js" async></script>'}
      />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole<HTMLInputElement>('textbox', { name: 'Public link' });
    await expect(canvas.getByRole('textbox', { name: 'Embed code' })).toHaveAttribute('readonly');
    await expect(canvas.getByRole('button', { name: 'Copy embed code' })).toBeInTheDocument();
    await expect(input).toHaveAttribute('readonly');
    await expect(canvas.queryByRole('img', { name: 'Read only' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    await userEvent.click(input);
    await waitFor(() => expect(input.selectionEnd).toBe(input.value.length));
    await expect(input.selectionStart).toBe(0);
  },
};

/**
 * The title variant: a page's own title, such as a note's. Empty with its placeholder, filled and wrapping, read
 * only, refused and disabled: no box, border, fill, ring or lock in any state, in the note title type. A refusal
 * shows as the line under it; read only, keyboard focus outlines it, as there is no caret.
 */
export const Title: Story = {
  render: () => (
    <Stage direction="column" width="fill">
      <Field label="Title" isLabelHidden variant="title" isWrapping placeholder="Untitled" />
      <Field
        label="Long title"
        isLabelHidden
        variant="title"
        isWrapping
        defaultValue="Kickoff call with the Northwind buying committee about seats, the EU workspace and the security review"
      />
      <Field label="Read only title" isLabelHidden variant="title" isWrapping isReadOnly defaultValue="Kickoff call" />
      <Field
        label="Refused title"
        isLabelHidden
        variant="title"
        isWrapping
        defaultValue="Kickoff call"
        error="Keep the title to 200 characters."
      />
      <Field label="Disabled title" isLabelHidden variant="title" isWrapping isDisabled defaultValue="Kickoff call" />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const title = canvas.getByRole('textbox', { name: 'Title' });
    const box = title.parentElement;
    if (box === null) throw new Error('No box.');
    await userEvent.click(title);
    await userEvent.keyboard('Kickoff call');
    await expect(title).toHaveValue('Kickoff call');
    // Focused, it still draws no box or ring: the caret marks it.
    await expect(getComputedStyle(box).borderStyle).toBe('none');
    await expect(getComputedStyle(box).boxShadow).toBe('none');
    await expect(getComputedStyle(title).fontSize).toBe('28px');
    await expect(canvas.queryByRole('img', { name: 'Read only' })).toBeNull();
    const readOnly = canvas.getByRole('textbox', { name: 'Read only title' });
    await expect(readOnly).toHaveAttribute('readonly');
    await expect(canvas.getByRole('textbox', { name: 'Refused title' })).toHaveAccessibleDescription(
      'Keep the title to 200 characters.',
    );
    await expect(canvas.getByRole('textbox', { name: 'Disabled title' })).toBeDisabled();
    // Tab onto the read only title: no caret shows there, so keyboard focus outlines it.
    await userEvent.tab();
    await userEvent.tab();
    await waitFor(() => expect(readOnly).toHaveFocus());
    const readOnlyBox = readOnly.parentElement;
    if (readOnlyBox === null) throw new Error('No box.');
    await expect(getComputedStyle(readOnlyBox).outlineStyle).toBe('solid');
  },
};

/** A quiet "(optional)" after the label, as a public form marks an optional question: muted, and part of the name. */
export const OptionalMark: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="narrow">
      <Field label="Phone or WhatsApp" labelAside="(optional)" placeholder="555 000 1234" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Phone or WhatsApp (optional)' })).toBeInTheDocument();
  },
};
