import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SaveBar, type SaveBarStatus } from './SaveBar.tsx';

const meta = {
  title: 'Modules/SaveBar',
  component: SaveBar,
  args: { status: 'unsaved', onSave: fn(), onDiscard: fn() },
  render: (args) => (
    <Stage>
      <SaveBar {...args} />
    </Stage>
  ),
} satisfies Meta<typeof SaveBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Unsaved: the quiet status, Discard and Save with its keycap. */
export const Unsaved: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Unsaved changes');
    await userEvent.click(canvas.getByRole('button', { name: 'Discard' }));
    await expect(args.onDiscard).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};

/** Saving: the same words and widths, Save shows its spinner and takes no second press. */
export const Saving: Story = {
  args: { status: 'saving' },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Unsaved changes');
    await expect(canvas.getByRole('button', { name: 'Discard' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** Saved: a check and Saved, no buttons. */
export const Saved: Story = {
  args: { status: 'saved' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Saved');
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};

/** Failed: why, in the danger colour, and Save becomes Try again. */
export const Failed: Story = {
  args: { status: 'error', error: 'Can’t reach Timefix. Check your connection, then try again.' },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Can’t reach Timefix.');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onSave).toHaveBeenCalled();
  },
};

/** Failed, narrow: a long reason keeps its own lines and the buttons wrap under it, at the end. */
export const FailedNarrow: Story = {
  args: { status: 'error', error: 'Can’t reach Timefix. Check your connection, then try again.' },
  render: (args) => (
    <Stage width="narrow">
      <SaveBar {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const reason = canvas.getByRole('status').getBoundingClientRect();
    const retry = canvas.getByRole('button', { name: 'Try again' }).getBoundingClientRect();
    await expect(retry.top).toBeGreaterThanOrEqual(reason.bottom - 1);
  },
};

/** Blocked: the changes can't be saved yet, the bar says why and Save waits, from the keyboard too. */
export const Blocked: Story = {
  args: { blockedReason: 'Fix the hours marked in red to save.' },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Fix the hours marked in red to save.');
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.keyboard('{Meta>}s{/Meta}');
    await userEvent.keyboard('{Control>}s{/Control}');
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** The whole round: Esc leaves it be, ⌘S saves, Saved shows, the bar leaves, and focus on Save is handed on. */
export const SaveRound: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onFocusAway: fn() },
  render: function Render(args) {
    const [status, setStatus] = useState<SaveBarStatus>('unsaved');
    return (
      <Stage>
        <SaveBar
          {...args}
          status={status}
          onSave={() => {
            args.onSave();
            // Straight to saved: a pending Button's announcement would outlive the story (Saving shows that state).
            setStatus('saved');
          }}
        />
      </Stage>
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Save' }).focus();
    await userEvent.keyboard('{Escape}');
    await expect(args.onDiscard).not.toHaveBeenCalled();
    await userEvent.keyboard('{Meta>}s{/Meta}');
    await userEvent.keyboard('{Control>}s{/Control}');
    await expect(args.onSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Saved'));
    await waitFor(() => expect(args.onFocusAway).toHaveBeenCalled());
    await waitFor(() => expect(canvas.queryByRole('status')).toBeNull(), { timeout: 4000 });
  },
};
