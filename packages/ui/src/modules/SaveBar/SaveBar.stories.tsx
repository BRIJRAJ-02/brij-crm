import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, waitFor, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SaveBar, type SaveBarStatus } from './SaveBar.tsx';

/** Discard's confirm, once it has opened (it portals out of the story). */
function discardConfirm() {
  return screen.findByRole('alertdialog', { name: 'Discard your unsaved changes?' });
}

/** Waits until Discard's confirm has gone, exit and all. */
function confirmGone() {
  return waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
}

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

/** Unsaved: the quiet status, Discard (which asks first) and Save with its keycap. */
export const Unsaved: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Unsaved changes');
    await userEvent.click(canvas.getByRole('button', { name: 'Discard' }));
    const confirm = await discardConfirm();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Discard changes' }));
    await expect(args.onDiscard).toHaveBeenCalledTimes(1);
    await confirmGone();
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};

/**
 * Discard asks first, as anything that can't be taken back does: Esc and Keep editing leave the changes and put
 * focus back on Discard; Discard changes discards, once.
 */
export const DiscardAsksFirst: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const discard = canvas.getByRole('button', { name: 'Discard' });
    discard.focus();
    await userEvent.keyboard('{Enter}');
    const confirm = await discardConfirm();
    await expect(confirm).toHaveTextContent('This can’t be undone.');
    // The safe answer comes first, and focus starts inside.
    const [keep, commit] = within(confirm).getAllByRole('button');
    await expect(keep).toHaveAccessibleName(/^Keep editing/);
    await expect(commit).toHaveAccessibleName('Discard changes');
    await waitFor(() => expect(confirm.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await confirmGone();
    await waitFor(() => expect(discard).toHaveFocus());
    await expect(args.onDiscard).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(await discardConfirm()).getByRole('button', { name: /^Keep editing/ }));
    await confirmGone();
    await waitFor(() => expect(discard).toHaveFocus());
    await expect(args.onDiscard).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(within(await discardConfirm()).getByRole('button', { name: 'Discard changes' }));
    await confirmGone();
    await expect(args.onDiscard).toHaveBeenCalledTimes(1);
  },
};

/** ⌘S inside Discard's confirm keeps the changes after all: the confirm closes and the page saves. */
export const SaveFromConfirm: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Discard' }).focus();
    await userEvent.keyboard('{Enter}');
    const confirm = await discardConfirm();
    await waitFor(() => expect(confirm.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Meta>}s{/Meta}');
    await userEvent.keyboard('{Control>}s{/Control}');
    await confirmGone();
    await expect(args.onSave).toHaveBeenCalledTimes(1);
    await expect(args.onDiscard).not.toHaveBeenCalled();
  },
};

/** A discard that goes through: the bar leaves, and focus, which was on Discard, goes where the page says. */
export const DiscardRound: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onFocusAway: fn() },
  render: function Render(args) {
    const [status, setStatus] = useState<SaveBarStatus>('unsaved');
    return (
      <Stage>
        <SaveBar
          {...args}
          status={status}
          onDiscard={() => {
            args.onDiscard?.();
            setStatus('hidden');
          }}
        />
      </Stage>
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Discard' }).focus();
    await userEvent.keyboard('{Enter}');
    const confirm = await discardConfirm();
    const commit = within(confirm).getByRole('button', { name: 'Discard changes' });
    await waitFor(() => expect(confirm.contains(document.activeElement)).toBe(true));
    // From the keyboard alone: Tab past Keep editing to the commit, then Enter.
    for (let presses = 0; presses < 3 && document.activeElement !== commit; presses += 1) {
      await userEvent.keyboard('{Tab}');
    }
    await expect(commit).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await confirmGone();
    await expect(args.onDiscard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(canvas.queryByRole('status')).toBeNull());
    await waitFor(() => expect(args.onFocusAway).toHaveBeenCalledTimes(1));
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
