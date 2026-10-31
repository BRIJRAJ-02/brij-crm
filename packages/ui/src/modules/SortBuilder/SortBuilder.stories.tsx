import type { SortRule } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, waitFor } from 'storybook/test';
import type { FieldAttribute } from '../../fields/types.ts';
import { attributeOf } from '../../workbench/attributes.ts';
import { hoverFresh, shownTooltip } from '../../workbench/pointer.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SortBuilder } from './SortBuilder.tsx';

const ATTRIBUTES: readonly FieldAttribute[] = [
  attributeOf('text', 'Name'),
  attributeOf('currency', 'Funding raised'),
  attributeOf('status', 'Stage'),
  attributeOf('date', 'Close date'),
  attributeOf('timestamp', 'Last email interaction with the account owner'),
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
    <Stage>
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

/** By keyboard: Enter on a grip lifts the sort, the arrows move it, Enter drops it; it now decides first. */
export const ReorderByKeyboard: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowRight}');
    const handle = canvas.getByRole('button', { name: 'Move the sort by Name' });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    // Lifted: focus waits on the move itself, away from the list's own arrow keys.
    await waitFor(() => expect(handle).not.toHaveFocus());
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
    await expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
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

/** One sort: nothing to order it against, so no grip; the row sizes to its content. */
export const OneSort: Story = {
  args: { initial: [{ attributeId: 'name', direction: 'ascending' }] },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('row')).toHaveLength(1);
    await expect(canvas.queryByRole('button', { name: /^Move the sort/ })).toBeNull();
  },
};

/** System fields (Record ID, Created at) come last in the attribute menu, under System. */
export const SystemLast: Story = {
  args: { initial: [] },
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <SortBuilder
        attributes={[
          attributeOf('text', 'Record ID', { isSystem: true }),
          attributeOf('text', 'Name'),
          attributeOf('timestamp', 'Created at', { isSystem: true }),
        ]}
        value={[]}
        onChange={fn()}
      />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Add sort' }));
    const items = await screen.findAllByRole('menuitem');
    await expect(items.map((item) => item.textContent)).toEqual(['Name', 'Record ID', 'Created at']);
    await expect(screen.getByText('System')).toBeInTheDocument();
  },
};

/** No sorts yet: one line saying the order that runs, then Add sort. */
export const Empty: Story = {
  args: { initial: [] },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Newest records first')).toBeInTheDocument();
  },
};

/** A view you can't change: the sorts as words. */
export const ReadOnly: Story = {
  args: { isReadOnly: true },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Add sort' })).toBeNull();
    await expect(canvas.getByText('Funding raised')).toBeInTheDocument();
    await expect(canvas.getByText('Descending')).toBeInTheDocument();
  },
};

/** Rows line up as columns whatever the names; a long name is cut, and shows whole in a tooltip on hover. */
export const Columns: Story = {
  args: {
    initial: [
      { attributeId: 'name', direction: 'ascending' },
      { attributeId: 'last_email_interaction_with_the_account_owner', direction: 'descending' },
      { attributeId: 'stage', direction: 'ascending' },
    ],
  },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const long = canvas.getByRole('button', { name: 'Last email interaction with the account owner' });
    const short = canvas.getByRole('button', { name: 'Name' });
    await expect(long.getBoundingClientRect().width).toBe(short.getBoundingClientRect().width);
    await expect(long.getBoundingClientRect().left).toBe(short.getBoundingClientRect().left);
    await hoverFresh(userEvent, long);
    await expect(await shownTooltip()).toHaveTextContent('Last email interaction with the account owner');
  },
};

/** The direction is a menu, like a filter's operator. */
export const Direction: Story = {
  args: { onChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button', { name: 'Descending' })[0] ?? canvas.getByRole('grid'));
    await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    await userEvent.keyboard('{ArrowUp}{Enter}');
    await expect(args.onChange).toHaveBeenLastCalledWith([
      { attributeId: 'funding_raised', direction: 'ascending' },
      { attributeId: 'name', direction: 'ascending' },
    ]);
    // Focus comes back to the direction, so Esc then closes the Popover holding the builder.
    await waitFor(() => expect(canvas.getAllByRole('button', { name: 'Ascending' })[0]).toHaveFocus());
  },
};
