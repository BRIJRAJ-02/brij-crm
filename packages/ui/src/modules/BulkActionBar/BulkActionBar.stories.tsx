import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BulkActionBar } from './BulkActionBar.tsx';

const meta = {
  title: 'Modules/BulkActionBar',
  component: BulkActionBar,
  args: {
    count: 12,
    total: 1234,
    onSelectAllMatching: fn(),
    onClear: fn(),
    children: (
      <>
        <Button icon="list-plus">Add to list</Button>
        <Button icon="pencil">Edit</Button>
        <Button variant="danger" icon="trash">
          Delete
        </Button>
      </>
    ),
  },
  render: (args) => (
    <Stage>
      <BulkActionBar {...args} />
    </Stage>
  ),
} satisfies Meta<typeof BulkActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Some selected: the count, the offer to select every match, the actions and Clear. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('toolbar', { name: 'Selected records' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Select all 1,234 matching' }));
    await expect(args.onSelectAllMatching).toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await expect(args.onClear).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Clear the selection' }));
    await expect(args.onClear).toHaveBeenCalled();
  },
};

/** Every matching record selected: the offer goes, and the count says so. */
export const AllMatching: Story = {
  args: { isAllMatching: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('All 1,234 matching selected')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /Select all/ })).toBeNull();
  },
};

/** An action running: its progress and Cancel in the actions' place, and Clear waits. */
export const InProgress: Story = {
  args: { isAllMatching: true, progress: { label: 'Deleting 1,234 records', value: 40 }, onCancel: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('progressbar', { name: 'Deleting 1,234 records' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Clear the selection' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(args.onCancel).toHaveBeenCalled();
  },
};

/** Select all, by keyboard: once it goes, focus is on the first action. */
export const SelectAllKeepsFocus: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [isAll, setAll] = useState(false);
    return (
      <Stage>
        <BulkActionBar
          {...args}
          isAllMatching={isAll}
          onSelectAllMatching={() => {
            setAll(true);
          }}
        />
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Select all 1,234 matching' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Add to list' })).toHaveFocus());
  },
};
