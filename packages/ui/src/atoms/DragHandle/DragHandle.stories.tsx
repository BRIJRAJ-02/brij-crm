import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import { GridList, GridListItem, useDragAndDrop } from 'react-aria-components';
import { reorder } from '../../lib/reorder.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DragHandle } from './DragHandle.tsx';

const NAMES = ['Name', 'Stage', 'Owner'];

/** Three rows that sort by their handles; the first can't move. */
function SampleRows() {
  const [names, setNames] = useState<readonly string[]>(NAMES);
  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ 'text/plain': String(key) })),
    onReorder: (event) => {
      setNames(
        reorder(
          names,
          (name) => name,
          new Set([...event.keys].map(String)),
          String(event.target.key),
          event.target.dropPosition === 'after' ? 'after' : 'before',
        ),
      );
    },
  });
  return (
    <Stage width="narrow">
      <GridList aria-label="Columns" items={names.map((id) => ({ id }))} dragAndDropHooks={dragAndDropHooks}>
        {({ id }) => (
          <GridListItem id={id} textValue={id}>
            <DragHandle label={`Move ${id}`} isDisabled={id === 'Name'} />
            {id}
          </GridListItem>
        )}
      </GridList>
    </Stage>
  );
}

const meta = {
  title: 'Atoms/DragHandle',
  component: SampleRows,
} satisfies Meta<typeof SampleRows>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A handle per row that can move; the locked row keeps a hidden one. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Move Stage' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Move Name' })).not.toBeInTheDocument();
  },
};

/** By keyboard: the right arrow reaches the handle, Enter picks its row up, Esc puts it back. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowRight}');
    const handle = canvas.getByRole('button', { name: 'Move Stage' });
    await waitFor(() => expect(handle).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(handle).not.toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(handle).toHaveFocus());
  },
};
