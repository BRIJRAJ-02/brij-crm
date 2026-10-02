import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { SAMPLE_RECORD, sampleDetails, sampleEditorProps } from '../../workbench/record-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { AttributeList } from './AttributeList.tsx';

interface SampleProps {
  readonly onCommit?: (attributeId: string, value: unknown) => void;
  readonly isLoading?: boolean;
  readonly isReadOnly?: boolean;
  readonly width?: 'auto' | 'narrow';
  readonly errorOn?: string;
}

/** The list holding the sample company's values, as a record page would through the data layer. */
function SampleList({ onCommit, isLoading = false, isReadOnly = false, width = 'auto', errorOn }: SampleProps) {
  const [values, setValues] = useState(SAMPLE_RECORD.values);
  const sections = sampleDetails(values).map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.attribute.id === errorOn ? { ...item, error: 'Someone else changed this. Try again.' } : item,
    ),
  }));
  return (
    <Stage width={width}>
      <AttributeList
        label="Details"
        sections={sections}
        isLoading={isLoading}
        editorProps={sampleEditorProps}
        {...(isReadOnly
          ? {}
          : {
              onCommit: (attributeId: string, value: unknown) => {
                setValues((previous) => ({ ...previous, [attributeId]: value }));
                onCommit?.(attributeId, value);
              },
            })}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/AttributeList',
  component: SampleList,
} satisfies Meta<typeof SampleList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A record's details: the same displays as the grid, each one a button that edits it. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('region', { name: 'Details' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Edit Domain' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: /northwindtraders\.com/ })).toBeInTheDocument();
    await expect(canvas.getByText('Set Description…')).toBeInTheDocument();
  },
};

/** Enter on a value opens its editor in place; Enter commits, and focus comes back to the value. */
export const EditInPlace: Story = {
  args: { onCommit: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByText('London'));
    const input = await canvas.findByRole('textbox', { name: 'City' });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.clear(input);
    await userEvent.type(input, 'Leeds{Enter}');
    await expect(args.onCommit).toHaveBeenCalledWith('city', 'Leeds');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Edit City' })).toHaveFocus());
    await expect(canvas.getByText('Leeds')).toBeInTheDocument();
  },
};

/** Esc leaves the value as it was. */
export const EscCancels: Story = {
  args: { onCommit: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Edit City' }).focus();
    await userEvent.keyboard('{Enter}');
    const input = await canvas.findByRole('textbox', { name: 'City' });
    await userEvent.type(input, 'xyz');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Edit City' })).toHaveFocus());
    await expect(canvas.getByText('London')).toBeInTheDocument();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/** A status opens as its list; one pick commits and closes it. */
export const PickAStatus: Story = {
  args: { onCommit: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Edit Stage' }));
    const listbox = await within(document.body).findByRole('listbox');
    await userEvent.click(within(listbox).getAllByRole('option')[1] as HTMLElement);
    await waitFor(() => expect(args.onCommit).toHaveBeenCalledWith('stage', expect.any(String)));
    await waitFor(() => expect(within(document.body).queryByRole('listbox')).not.toBeInTheDocument());
  },
};

/** A checkbox toggles where it is, with no editor to open. */
export const Toggle: Story = {
  args: { onCommit: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Is customer' }));
    await expect(args.onCommit).toHaveBeenCalledWith('is_customer', false);
  },
};

/** Nobody can edit: values are plain text, and a system value says why with a lock. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Edit Domain' })).not.toBeInTheDocument();
    await expect(
      canvas.getByRole('button', { name: 'The system sets this when the record is made.' }),
    ).toBeInTheDocument();
  },
};

/** A refusal from the data layer shows under its value. */
export const WithError: Story = {
  args: { errorOn: 'domain' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Someone else changed this. Try again.')).toBeInTheDocument();
  },
};

/** While the record loads, skeleton rows after the loading delay. */
export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading details')).toBeInTheDocument();
  },
};

/** In a narrow slot the name sits above its value. */
export const Narrow: Story = {
  args: { width: 'narrow' },
};
