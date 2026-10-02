import type { SortRule } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import type { FieldAttribute } from '../../fields/types.ts';
import { attributeOf } from '../../workbench/attributes.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SortBuilder } from './SortBuilder.tsx';

const ATTRIBUTES: readonly FieldAttribute[] = [
  attributeOf('text', 'Name'),
  attributeOf('currency', 'Funding raised'),
  attributeOf('status', 'Stage'),
  attributeOf('date', 'Close date'),
];

const SORTS: readonly SortRule[] = [
  { attributeId: 'funding_raised', direction: 'descending' },
  { attributeId: 'name', direction: 'ascending' },
];

interface SampleProps {
  readonly initial?: readonly SortRule[];
  readonly isReadOnly?: boolean;
  readonly onChange?: (next: readonly SortRule[]) => void;
}

/** The builder holding its own sorts, as a view's sort popover would. */
function SampleSorts({ initial = SORTS, isReadOnly = false, onChange }: SampleProps) {
  const [value, setValue] = useState(initial);
  return (
    <Stage width="narrow">
      <SortBuilder
        attributes={ATTRIBUTES}
        value={value}
        isReadOnly={isReadOnly}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/SortBuilder',
  component: SampleSorts,
} satisfies Meta<typeof SampleSorts>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "Sort by" the first, "then by" the rest, each with its handle, attribute, direction and Remove. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid', { name: 'Sorts' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('row')).toHaveLength(2);
    await expect(canvas.getByText('then by')).toBeInTheDocument();
  },
};

/** By keyboard: Enter on a handle picks the sort up, the arrows choose where, Enter drops it; it now decides first. */
export const ReorderByKeyboard: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Move the sort by Name' })).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(args.onChange).toHaveBeenLastCalledWith([
        { attributeId: 'name', direction: 'ascending' },
        { attributeId: 'funding_raised', direction: 'descending' },
      ]),
    );
  },
};

/** Add sort offers only the attributes not sorted by yet. */
export const Add: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add sort' }));
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new globalThis.Error('No menu.');
      return found;
    });
    await expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onChange).toHaveBeenLastCalledWith([...SORTS, { attributeId: 'stage', direction: 'ascending' }]);
    // Focus moves to the new sort's attribute.
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Stage' })).toHaveFocus());
  },
};

/** Removing a sort hands focus to the sort that takes its place; changing an attribute keeps it on that sort. */
export const FocusStays: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Remove the sort by Funding raised' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Name' })).toHaveFocus());
    await userEvent.click(canvas.getByRole('button', { name: 'Name' }));
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await userEvent.keyboard('Close{ArrowDown}{Enter}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Close date' })).toHaveFocus());
  },
};

/** No sorts yet: records show in the order they were added. */
export const Empty: Story = {
  args: { initial: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No sorts yet')).toBeInTheDocument();
  },
};

/** A view you can't change: the sorts as words. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Add sort' })).toBeNull();
    await expect(canvas.getByText('Funding raised, Descending')).toBeInTheDocument();
  },
};
