import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import { SortableList, useSortableItem } from '../../lib/drag/drag.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DragHandle } from './DragHandle.tsx';

const NAMES = ['Name', 'Stage', 'Owner'];

/** One row: its grip (none for the locked first row) and its name. */
function SampleRow({ id, reach }: { readonly id: string; readonly reach?: 'around' | 'end' }) {
  const { bind, grip } = useSortableItem(id, { isDisabled: id === 'Name' });
  return (
    <li ref={bind}>
      <DragHandle label={`Move ${id}`} drag={grip} {...(reach === undefined ? {} : { reach })} />
      {id}
    </li>
  );
}

/** Three rows that sort by their handles; the first can't move. */
function SampleRows({ reach }: { readonly reach?: 'around' | 'end' }) {
  const [names, setNames] = useState<readonly string[]>(NAMES);
  return (
    <Stage width="narrow">
      <SortableList
        ids={names}
        nameOf={(id) => id}
        onMove={({ id, toIndex }) => {
          const rest = names.filter((name) => name !== id);
          setNames([...rest.slice(0, toIndex), id, ...rest.slice(toIndex)]);
        }}
      >
        <ul aria-label="Columns">
          {names.map((id) => (
            <SampleRow key={id} id={id} {...(reach === undefined ? {} : { reach })} />
          ))}
        </ul>
      </SortableList>
    </Stage>
  );
}

const meta = {
  title: 'Atoms/DragHandle',
  component: SampleRows,
} satisfies Meta<typeof SampleRows>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A handle per row that can move; the locked row has none. Not an artifact
 * preview: a handle needs the drag wrapper around it. The SortBuilder and
 * Board previews show it in use.
 */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Move Stage' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Move Name' })).not.toBeInTheDocument();
  },
};

/** By keyboard: Space lifts the row (focus waits on the move), Down moves it, Space drops it and focus comes back. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const handle = canvas.getByRole('button', { name: 'Move Stage' });
    handle.focus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard(' ');
    await waitFor(() =>
      expect(canvas.getAllByRole('listitem').map((row) => row.textContent)).toEqual(['Name', 'Owner', 'Stage']),
    );
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Move Stage' })).toHaveFocus());
  },
};

/** Escape puts a lifted row back where it was. */
export const PutBack: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    const handle = canvas.getByRole('button', { name: 'Move Stage' });
    handle.focus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getAllByRole('listitem').map((row) => row.textContent)).toEqual(NAMES));
  },
};

/** `reach="end"`: the 24px hit area starts on the handle and grows toward the end, for a handle by an edge that clips. */
export const ReachEnd: Story = {
  args: { reach: 'end' },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    const handle = canvas.getByRole('button', { name: 'Move Stage' });
    const hit = getComputedStyle(handle, '::after');
    await expect(hit.insetInlineStart).toBe('0px');
    await expect(
      handle.getBoundingClientRect().width + Number.parseFloat(hit.insetInlineEnd) * -1,
    ).toBeGreaterThanOrEqual(24);
  },
};
