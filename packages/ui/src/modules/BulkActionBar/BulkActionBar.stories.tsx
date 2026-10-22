import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
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

/** The bar on a phone's width: the stage is a size container, as the app's view is. */
const narrow: Story['render'] = (args) => (
  <Stage width="phone">
    <BulkActionBar {...args} />
  </Stage>
);

/** Every edge of `inner` sits inside `outer` (a pixel's rounding allowed). */
const isInside = (inner: DOMRect, outer: DOMRect): boolean =>
  inner.left >= outer.left - 1 && inner.right <= outer.right + 1;

/** The bar's statuses' words: the count, and the steps of a running change (said, not shown). */
const said = (statuses: readonly HTMLElement[]): readonly string[] => statuses.map((each) => each.textContent);

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
  args: { isAllMatching: true, count: 1234 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('All 1,234 matching selected')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /Select all/ })).toBeNull();
  },
};

/** All matching with two left out: the count is what will change. */
export const AllMatchingLeftOut: Story = {
  args: { isAllMatching: true, count: 1232 },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('All 1,232 matching selected')).toBeInTheDocument();
  },
};

/** All matching of a view whose count stopped at its cap: the count says "10,000+". */
export const CappedCount: Story = {
  args: { isAllMatching: true, count: 10_000, total: 10_000, isTotalAtLeast: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('All 10,000+ matching selected')).toBeInTheDocument();
  },
};

/** Some of a capped view selected: the offer says "10,000+". */
export const CappedOffer: Story = {
  parameters: { crm: { screenshot: false } },
  args: { count: 40, total: 10_000, isTotalAtLeast: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Select all 10,000+ matching' })).toBeInTheDocument();
  },
};

/** Nothing selected (a change started from elsewhere, such as Empty trash): no count and no offer, only the note. */
export const NothingSelected: Story = {
  args: { count: 0, children: <Callout placement="bar">Nothing left to change.</Callout> },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing left to change.')).toBeInTheDocument();
    await expect(canvas.queryByText(/selected/)).toBeNull();
    await expect(canvas.queryByRole('button', { name: /Select all/ })).toBeNull();
  },
};

/**
 * Delete from the keyboard starts a background change: the button goes with
 * its progress ("Starting", nothing to press yet), and focus reaches Cancel
 * as soon as there is one, so it never stays on the page.
 */
export const Starting: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onCancel: fn() },
  render: function Render({ onCancel, ...args }) {
    const [step, setStep] = useState<'idle' | 'starting' | 'counting'>('idle');
    useEffect(() => {
      if (step !== 'starting') return;
      const timer = setTimeout(() => {
        setStep('counting');
      }, 300);
      return () => {
        clearTimeout(timer);
      };
    }, [step]);
    return (
      <Stage>
        <BulkActionBar
          {...args}
          isAllMatching
          count={1234}
          {...(step === 'idle' ? {} : { progress: { label: step === 'starting' ? 'Starting' : 'Counting…' } })}
          {...(step === 'counting' && onCancel !== undefined ? { onCancel } : {})}
        >
          <Button
            variant="danger"
            icon="trash"
            onPress={() => {
              setStep('starting');
            }}
          >
            Delete
          </Button>
        </BulkActionBar>
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Delete' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    // Its step is said as it changes.
    await waitFor(() => expect(said(canvas.getAllByRole('status'))).toContain('Counting…'));
  },
};

/** A background change counting what it will touch: progress with no value yet, and Cancel. */
export const Counting: Story = {
  args: { isAllMatching: true, count: 1234, progress: { label: 'Counting…' }, onCancel: fn() },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { name: 'Counting…' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Clear the selection' })).toBeDisabled();
  },
};

/** Counting on a phone: the progress gives up room, and Cancel stays inside the bar. */
export const CountingNarrow: Story = {
  ...Counting,
  render: narrow,
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('toolbar', { name: 'Selected records' }).getBoundingClientRect();
    await expect(isInside(canvas.getByRole('button', { name: 'Cancel' }).getBoundingClientRect(), bar)).toBe(true);
    await expect(isInside(canvas.getByRole('progressbar').getBoundingClientRect(), bar)).toBe(true);
  },
};

/** Counted: a full bar labelled with the count, Review to open the confirm, and Cancel. Nothing opens by itself. */
export const Counted: Story = {
  args: {
    isAllMatching: true,
    count: 12_345,
    total: 12_345,
    progress: { label: '12,345 people counted', value: 100 },
    onReview: fn(),
    onCancel: fn(),
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('progressbar', { name: '12,345 people counted' })).toBeInTheDocument();
    // The full bar stands for the count: no percentage beside it.
    await expect(canvas.queryByText('100%')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Review' }));
    await expect(args.onReview).toHaveBeenCalledTimes(1);
  },
};

/** Its confirm went through, so Review goes: focus moves on to Cancel, never to the page. */
export const ReviewedKeepsFocus: Story = {
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [isConfirmed, setConfirmed] = useState(false);
    return (
      <Stage>
        <BulkActionBar
          {...args}
          isAllMatching
          count={12_345}
          total={12_345}
          progress={
            isConfirmed ? { label: 'Deleting 0 of 12,345', value: 0 } : { label: '12,345 people counted', value: 100 }
          }
          onCancel={() => undefined}
          {...(isConfirmed
            ? {}
            : {
                onReview: () => {
                  setConfirmed(true);
                },
              })}
        />
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Review' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    await waitFor(() => expect(said(canvas.getAllByRole('status'))).toContain('Deleting 0 of 12,345'));
  },
};

/** An action running: its progress and Cancel in the actions' place, and Clear waits. */
export const InProgress: Story = {
  args: {
    isAllMatching: true,
    count: 1234,
    progress: { label: 'Deleting 4,500 of 12,345', value: 36 },
    onCancel: fn(),
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('progressbar', { name: 'Deleting 4,500 of 12,345' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Clear the selection' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(args.onCancel).toHaveBeenCalled();
  },
};

/** Running on a phone: the label and its percentage share the room, and Cancel stays inside the bar. */
export const InProgressNarrow: Story = {
  ...InProgress,
  render: narrow,
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('toolbar', { name: 'Selected records' }).getBoundingClientRect();
    await expect(isInside(canvas.getByRole('button', { name: 'Cancel' }).getBoundingClientRect(), bar)).toBe(true);
    await expect(isInside(canvas.getByRole('progressbar').getBoundingClientRect(), bar)).toBe(true);
  },
};

/** Stopping after its current batch: Cancel stays in place, pending, and reads "Cancelling". */
export const Cancelling: Story = {
  args: {
    isAllMatching: true,
    count: 1234,
    progress: { label: 'Stopping after this batch…', value: 36 },
    onCancel: fn(),
    isCancelling: true,
  },
  play: async ({ args, canvas, userEvent }) => {
    const cancel = canvas.getByRole('button', { name: 'Cancelling' });
    await userEvent.click(cancel);
    await expect(args.onCancel).not.toHaveBeenCalled();
    await expect(canvas.getByRole('progressbar', { name: 'Stopping after this batch…' })).toBeInTheDocument();
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

/** A note in the actions' place: a background change that had nothing left to do says so, quietly, in the bar. */
export const WithNote: Story = {
  args: {
    count: 620,
    children: <Callout placement="bar">Nothing left to change.</Callout>,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Nothing left to change.')).toBeInTheDocument();
    await expect(canvas.getAllByRole('status')[0]).toHaveTextContent('620 selected');
  },
};

/** A note on a phone: a long one wraps inside the bar, every word shown. */
export const WithNoteNarrow: Story = {
  args: {
    count: 620,
    children: <Callout placement="bar">You can view Opportunities but not change them.</Callout>,
  },
  render: narrow,
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('toolbar', { name: 'Selected records' }).getBoundingClientRect();
    const note = await canvas.findByText('You can view Opportunities but not change them.');
    await expect(isInside(note.getBoundingClientRect(), bar)).toBe(true);
    await expect(note.scrollWidth).toBeLessThanOrEqual(note.clientWidth + 1);
  },
};

/** A refused start: why, in the danger tone, before the actions, which stay to try again. */
export const WithDangerNote: Story = {
  args: {
    isAllMatching: true,
    count: 1234,
    children: (
      <>
        <Callout placement="bar" tone="danger">
          Your workspace is already running 20 background changes. Wait for one to finish.
        </Callout>
        <Button icon="pencil">Edit</Button>
        <Button variant="danger" icon="trash">
          Delete
        </Button>
      </>
    ),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('already running 20 background changes');
    await expect(canvas.getByRole('button', { name: 'Delete' })).toBeEnabled();
  },
};

/** Cleared: it sinks out saying what it last said, inert, then draws nothing and says it has gone. */
export const Leaving: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onLeft: fn() },
  render: function Render(args) {
    const [isOpen, setOpen] = useState(true);
    return (
      <Stage>
        <BulkActionBar
          {...args}
          isOpen={isOpen}
          count={isOpen ? 12 : 0}
          onClear={() => {
            setOpen(false);
          }}
          onLeft={() => {
            // What the bar said as it finished leaving, for the play to check.
            (args.onLeft as (words: string) => void)(document.querySelector('[role="toolbar"]')?.textContent ?? '');
          }}
        />
      </Stage>
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Clear the selection' }));
    await waitFor(() => expect(args.onLeft).toHaveBeenCalledWith(expect.stringContaining('12 selected')));
    await waitFor(() => expect(canvas.queryByRole('toolbar')).toBeNull());
  },
};
