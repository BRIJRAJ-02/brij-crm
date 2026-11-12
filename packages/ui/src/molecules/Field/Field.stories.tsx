import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { InfoTip } from '../InfoTip/InfoTip.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Select } from '../Select/SelectWithFaces.tsx';
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

/** `size="guest"`: a guest page's 42px field (a reservation's details), a one line value and a note, one with an error. */
export const Guest: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Field label="Full name" size="guest" autoComplete="name" defaultValue="Ada Lovelace" />
      <Field label="Phone" size="guest" type="tel" error="Give a number we can call you on." />
      <Field
        label="Special requests"
        labelAside="Optional"
        size="guest"
        isMultiline
        placeholder="Dietary, high chair, accessibility…"
      />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('textbox', { name: 'Full name' })).toHaveValue('Ada Lovelace');
    await expect(canvasElement.querySelectorAll('[data-size="guest"]')).toHaveLength(3);
  },
};

/** A row's picker and its remove button in the suffix: the Invite dialog's address with its role. */
export const AfterControls: Story = {
  args: { label: 'Email', placeholder: 'name@company.com', defaultValue: 'grace@example.com' },
  render: (args) => (
    <Stage width="narrow">
      <Field
        {...args}
        after={
          <>
            <Select
              label="Role for grace@example.com"
              isLabelHidden
              optionDescription="below"
              items={[
                { id: 'admin', label: 'Admin', description: 'Manages members, settings and every record.' },
                { id: 'member', label: 'Member', description: "Works with records; can't change settings or members." },
              ]}
              defaultValue="member"
            />
            <Button variant="ghost" icon="x" label="Remove grace@example.com" />
          </>
        }
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    // The role and remove sit beside the box, not in it.
    const input = canvas.getByRole('textbox', { name: 'Email' });
    const remove = canvas.getByRole('button', { name: 'Remove grace@example.com' });
    await expect(input.parentElement?.contains(remove)).toBe(false);
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

/** One error replaced by another: the error line stays and only its words change, so it doesn't fade in twice. */
export const ErrorChangesInPlace: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <Rechecked />,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Email' });
    await expect(input).toHaveAccessibleDescription('Give an email address.');
    const errorLine = () => canvas.getByText(/^Give an email address/).parentElement;
    const before = errorLine();
    await userEvent.type(input, 'ada');
    await expect(input).toHaveAccessibleDescription('Give an email address such as name@example.com.');
    await expect(errorLine()).toBe(before);
  },
};

function Rechecked() {
  const [value, setValue] = useState('');
  return (
    <Stage width="narrow">
      <Field
        label="Email"
        value={value}
        onChange={setValue}
        error={value === '' ? 'Give an email address.' : 'Give an email address such as name@example.com.'}
      />
    </Stage>
  );
}

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

/** A textarea taking a held column's spare height, down to what follows it. */
export const Filling: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <div
      ref={(element) => {
        if (element !== null)
          element.style.cssText = 'display:flex;flex-direction:column;block-size:var(--size-sidebar)';
      }}
    >
      <Field label="Note" isMultiline isFilling />
      {/* The library's Button, never a bare <button>: the reset makes a bare one inherit the dark theme's light text
          while WebKit paints its own light button face behind it (axe, 1.55:1 in CI's WebKit). */}
      <Button>Send</Button>
    </div>
  ),
  play: async ({ canvas }) => {
    const box = canvas.getByRole('textbox', { name: 'Note' }).getBoundingClientRect();
    const next = canvas.getByRole('button', { name: 'Send' }).getBoundingClientRect();
    await expect(box.height).toBeGreaterThan(100);
    await expect(next.top - box.bottom).toBeLessThan(16);
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

/** The large size: the one field a block is about (a form question's words), a row tall in the title type, over a normal field. */
export const Large: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Field label="Question" size="lg" defaultValue="How likely are you to recommend us?" />
      <Field label="Placeholder" defaultValue="Pick a number" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const question = canvas.getByRole('textbox', { name: 'Question' });
    const placeholder = canvas.getByRole('textbox', { name: 'Placeholder' });
    // The question reads first: taller and in larger type than the field under it.
    await expect(question.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      placeholder.getBoundingClientRect().height,
    );
    await expect(parseFloat(getComputedStyle(question).fontSize)).toBeGreaterThan(
      parseFloat(getComputedStyle(placeholder).fontSize),
    );
  },
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
    // A click leaves the caret at the end first, so wait for the whole value, start and end, selected on the next frame.
    await waitFor(() => expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]));
  },
};

/** A long link to copy that wraps rather than cutting its end off, its Copy button at the top of the box's end. */
export const CopyWrapping: Story = {
  render: () => (
    <Stage width="narrow">
      <Field
        label="Address"
        variant="copy"
        isWrapping
        copyLabel="Copy address"
        value="https://brij-crm-phi.vercel.app/w/northwind-traders-international-sales-team"
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Address' });
    await expect(input).toHaveAttribute('readonly');
    await expect(input).toHaveValue('https://brij-crm-phi.vercel.app/w/northwind-traders-international-sales-team');
    await expect(canvas.getByRole('button', { name: 'Copy address' })).toBeInTheDocument();
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
      <Field
        label="Line under it"
        isLabelHidden
        variant="title"
        size="sm"
        isWrapping
        placeholder="Add a line under it"
      />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const title = canvas.getByRole('textbox', { name: 'Title' });
    const box = title.parentElement;
    if (box === null) throw new Error('No box.');
    await userEvent.click(title);
    await userEvent.keyboard('Kickoff call');
    await expect(title).toHaveValue('Kickoff call');
    // Focused, it wears the field's ring around its words (the owner, 5 November 2026: "doesn't look editable"),
    // but still no border, so it reads as the page's title.
    await expect(getComputedStyle(box).borderStyle).toBe('none');
    await expect(getComputedStyle(box).boxShadow).not.toBe('none');
    // title-lg at the app's density (spec 0071).
    await expect(getComputedStyle(title).fontSize).toBe('21px');
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
/** Underline: a public form's one large answer, a line in the accent; focus doubles it. */
export const Underline: Story = {
  args: { label: 'Your name', variant: 'underline', placeholder: 'Ada Lovelace' },
  render: (args) => (
    <Stage width="dialog">
      <Field {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Your name' }));
    await expect(canvas.getByRole('textbox', { name: 'Your name' })).toHaveFocus();
  },
};

/** Underline's states: refused, read only and disabled. */
export const UnderlineStates: Story = {
  render: () => (
    <Stage direction="column" width="dialog">
      <Field label="Work email" variant="underline" value="ada@" error="Enter an email address." />
      <Field label="Company" variant="underline" value="Acme" isReadOnly />
      <Field label="Job title" variant="underline" isDisabled />
    </Stage>
  ),
};

/** Underline refused and focused: the doubled line is danger too, never blue under red (5 November 2026). */
export const UnderlineInvalidFocused: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="dialog">
      <Field label="Work email" variant="underline" value="ada@" error="Enter an email address." />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Work email' });
    await userEvent.click(input);
    await expect(input).toHaveFocus();
    const box = input.parentElement;
    const style = box === null ? undefined : getComputedStyle(box);
    // The line under the words and the focus line under it are one colour: the border's (once the edge's fade ends).
    await waitFor(() => expect(style?.boxShadow ?? '').toContain(style?.borderBottomColor ?? 'none'));
  },
};

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

/** With `info`, read only: an InfoTip beside the label, for a field whose label alone isn't clear. The label row keeps its height. */
export const WithInfo: Story = {
  args: {
    label: 'API name',
    value: 'people',
    isReadOnly: true,
    info: <InfoTip label="API name">Developers use it to point at this object from the API.</InfoTip>,
  },
  render: (args) => (
    <Stage width="narrow">
      <Field {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'API name' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'About API name' })).toBeVisible();
  },
};

/** Free values offered under the field: pressing one fills it. */
export const WithSuggestions: Story = {
  render: function Render() {
    const [value, setValue] = useState('stealth');
    return (
      <Stage width="narrow">
        <Field
          label="Web address"
          prefix="/w/"
          value={value}
          onChange={setValue}
          {...(value === 'stealth'
            ? {
                error: 'Taken',
                suggestions: { label: 'Free addresses', items: ['stealth-design', 'stealth-team'], onPick: setValue },
              }
            : { hint: 'Available' })}
        />
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'stealth-design' }));
    await expect(canvas.getByRole('textbox', { name: 'Web address' })).toHaveValue('stealth-design');
  },
};

/** A long text prefix on a narrow box: the address's fixed start gives way, cut with an ellipsis, and the input keeps room. */
export const LongPrefix: Story = {
  render: () => (
    <Stage width="narrow">
      <Field label="Web address" prefix="app.timefix.com/ada-lovelace-consulting/" defaultValue="intro-call" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Web address' });
    await expect(input.getBoundingClientRect().width).toBeGreaterThanOrEqual(80);
  },
};

/**
 * Typed exactly as shown (`isVerbatim`): a backup code with no automatic capitals, corrections or spell check, so a
 * phone's keyboard never capitalises its first letter. Behaviour only, no look of its own: no screenshot.
 */
export const Verbatim: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="narrow">
      <Field label="Backup code" name="backupCode" autoComplete="off" isVerbatim />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Backup code' });
    await expect(input).toHaveAttribute('autocapitalize', 'off');
    await expect(input).toHaveAttribute('autocorrect', 'off');
    await expect(input).toHaveAttribute('spellcheck', 'false');
  },
};

/** Phase 2's options: tabular figures for an amount (NumberField), and a shortcut the input states (SearchField). */
export const TabularAndShortcut: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage direction="column" width="narrow">
      <Field label="Amount" isTabular defaultValue="1,250.00" inputMode="decimal" />
      <Field label="Search people" variant="search" aria-keyshortcuts="Meta+K" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const amount = canvas.getByRole('textbox', { name: 'Amount' });
    await expect(getComputedStyle(amount).fontVariantNumeric).toBe('tabular-nums');
    const search = canvas.getByRole('textbox', { name: 'Search people' });
    await expect(search).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
  },
};

/** The prototype's filled box: no edge at rest; typed in, white with the accent edge and its ring. */
export const FilledThenFocused: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="narrow">
      <Field label="Company" placeholder="Acme Corp" />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Company' });
    const box = input.parentElement;
    if (box === null) throw new Error('The input has no box.');
    await expect(getComputedStyle(box).borderTopColor).toBe('rgba(0, 0, 0, 0)');
    await userEvent.click(input);
    await waitFor(() => expect(getComputedStyle(box).borderTopColor).not.toBe('rgba(0, 0, 0, 0)'));
    await expect(getComputedStyle(box).boxShadow).not.toBe('none');
  },
};

/** The platform's own date control (`temporal`, a hosted form's Date question): its earliest day, and an error. */
export const Temporal: Story = {
  args: {
    label: 'Start date',
    temporal: { type: 'date', min: '2026-11-01' },
    value: '2026-10-30',
    error: 'Pick 2026-11-01 or later.',
  },
  play: async ({ canvas }) => {
    const input = canvas.getByLabelText('Start date');
    await expect(input).toHaveAttribute('type', 'date');
    await expect(input).toHaveAttribute('min', '2026-11-01');
    await expect(input).toHaveAccessibleDescription('Pick 2026-11-01 or later.');
  },
};

/** A time, read only. */
export const TemporalReadOnly: Story = {
  args: { label: 'Best time to call', temporal: { type: 'time' }, value: '14:30', isReadOnly: true },
};
