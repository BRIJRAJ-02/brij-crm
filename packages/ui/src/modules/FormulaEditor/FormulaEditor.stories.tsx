import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FormulaEditor, type FormulaCheck, type FormulaEditorAttribute } from './FormulaEditor.tsx';

const attributes: readonly FormulaEditorAttribute[] = [
  { apiSlug: 'value', title: 'Value', type: 'currency' },
  { apiSlug: 'probability', title: 'Probability', type: 'number' },
  { apiSlug: 'stage', title: 'Stage', type: 'status' },
  { apiSlug: 'close_date', title: 'Close date', type: 'date' },
];

/** The editor with its own text, and a fixed check, as a screen would hold them. */
function Editor({ start, check, isReadOnly }: { start: string; check: FormulaCheck; isReadOnly?: boolean }) {
  const [value, setValue] = useState(start);
  return (
    <Stage width="narrow">
      <FormulaEditor
        value={value}
        onChange={setValue}
        attributes={attributes}
        check={check}
        {...(isReadOnly === true ? { isReadOnly: true, readOnlyReason: 'Owners and admins change formulas.' } : {})}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/FormulaEditor',
  component: FormulaEditor,
  args: { value: '', onChange: () => undefined, attributes, check: undefined },
} satisfies Meta<typeof FormulaEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing typed yet: the hint says how to name an attribute. */
export const Empty: Story = {
  render: () => <Editor start="" check={undefined} />,
};

/** A valid formula says what it gives. */
export const Valid: Story = {
  parameters: { crm: { preview: true } },
  render: () => <Editor start="{{value}} * {{probability}} / 100" check={{ result: 'Gives a currency amount' }} />,
};

/** The first mistake, with its character. */
export const Invalid: Story = {
  render: () => <Editor start="{{stage_x}} + 1" check={{ error: 'Unknown attribute {{stage_x}} at character 1.' }} />,
};

/** A long formula wraps in the field. */
export const Long: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Editor
      start={'IF({{stage}} = "Won", {{value}}, IF({{probability}} > 50, {{value}} * {{probability}} / 100, 0))'}
      check={{ result: 'Gives a currency amount' }}
    />
  ),
};

/** Read only, with its reason. */
export const ReadOnly: Story = {
  render: () => <Editor start="{{value}} * 2" check={{ result: 'Gives a currency amount' }} isReadOnly />,
};

/** Typing `{{` lists the attributes; the field keeps focus. */
export const SuggestingAttributes: Story = {
  render: () => <Editor start="" check={undefined} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText('Formula');
    await userEvent.click(field);
    await userEvent.keyboard('{{{{');
    const list = await within(document.body).findByRole('listbox', { name: 'Attributes' });
    await expect(within(list).getByText('Probability')).toBeInTheDocument();
    await expect(field).toHaveFocus();
  },
};

/** Typing a word lists the functions that start with it. */
export const SuggestingFunctions: Story = {
  render: () => <Editor start="" check={undefined} />,
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByLabelText('Formula');
    await userEvent.click(field);
    await userEvent.keyboard('ROU');
    const list = await within(document.body).findByRole('listbox', { name: 'Functions' });
    await expect(within(list).getByText('ROUND(x, digits)')).toBeInTheDocument();
  },
};

/** The keyboard picks (the prototype's Up, Down and Enter): Down moves the highlight, Enter puts it in, focus stays. */
export const PickByKeyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <Editor start="" check={undefined} />,
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByLabelText('Formula');
    await userEvent.click(field);
    await userEvent.keyboard('{{{{');
    await within(document.body).findByRole('listbox', { name: 'Attributes' });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(field).toHaveValue('{{probability}}'));
    await expect(field).toHaveFocus();
    await waitFor(() => expect(within(document.body).queryByRole('listbox')).toBeNull());
  },
};

/** Escape closes the list and leaves the text and the focus where they were. */
export const EscapeCloses: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <Editor start="" check={undefined} />,
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByLabelText('Formula');
    await userEvent.click(field);
    await userEvent.keyboard('{{{{va');
    await within(document.body).findByRole('listbox', { name: 'Attributes' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(document.body).queryByRole('listbox')).toBeNull());
    await expect(field).toHaveValue('{{va');
    await expect(field).toHaveFocus();
  },
};

/** Nothing matching what follows `{{`: the list gives way to a line that says so, read out politely. */
export const NothingMatching: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <Editor start="" check={undefined} />,
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByLabelText('Formula');
    await userEvent.click(field);
    await userEvent.keyboard('{{{{zzz');
    const line = await within(document.body).findByRole('status', { name: 'Attributes' });
    await expect(line).toHaveTextContent('Nothing matches');
    await expect(field).toHaveFocus();
  },
};
