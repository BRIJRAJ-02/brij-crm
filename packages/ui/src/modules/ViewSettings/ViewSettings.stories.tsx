import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { attributeOf } from '../../workbench/attributes.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { ViewSettings, type ViewField } from './ViewSettings.tsx';

const FIELDS: readonly ViewField[] = [
  { attribute: attributeOf('text', 'Name'), isShown: true, isLocked: true },
  { attribute: attributeOf('domain', 'Domain'), isShown: true },
  { attribute: attributeOf('status', 'Stage'), isShown: true },
  { attribute: attributeOf('currency', 'ARR'), isShown: false },
  { attribute: attributeOf('actor_reference', 'Owner'), isShown: true },
];

const MANY: readonly ViewField[] = [
  ...FIELDS,
  ...['City', 'Region', 'Industry', 'Founded', 'Employees', 'Twitter'].map((name) => ({
    attribute: attributeOf('text', name),
    isShown: false,
  })),
];

interface SampleProps {
  readonly initial?: readonly ViewField[];
  readonly onChange?: (next: readonly ViewField[]) => void;
}

/** The settings holding their own fields, as a view's settings popover would. */
function SampleSettings({ initial = FIELDS, onChange }: SampleProps) {
  const [fields, setFields] = useState(initial);
  return (
    <Stage width="narrow">
      <ViewSettings
        label="Columns"
        fields={fields}
        onChange={(next) => {
          setFields(next);
          onChange?.(next);
        }}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/ViewSettings',
  component: SampleSettings,
} satisfies Meta<typeof SampleSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A switch per column; the name is always shown and stays first. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('4 of 5 shown')).toBeInTheDocument();
    await expect(canvas.getByRole('switch', { name: 'Show Name' })).toBeDisabled();
  },
};

/** A switch shows or hides its column. */
export const ShowAndHide: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('switch', { name: 'Show ARR' }));
    await expect(args.onChange).toHaveBeenCalled();
    await expect(canvas.getByText('5 of 5 shown')).toBeInTheDocument();
  },
};

/** By keyboard: Enter on a handle picks the column up, the arrows choose where, Enter drops it. */
export const ReorderByKeyboard: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Move Stage' })).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(args.onChange).toHaveBeenCalled());
  },
};

/** Past eight attributes, a search field narrows the list. */
export const Search: Story = {
  args: { initial: MANY },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText('Search attributes'), 'reg');
    await waitFor(() => expect(canvas.getAllByRole('row')).toHaveLength(1));
  },
};
