import type { RecordRefDisplay } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { arraySource } from '../../lib/list-source.ts';
import { SAMPLE_COMPANIES } from '../../workbench/field-samples.ts';
import {
  SAMPLE_ACTIVITY,
  SAMPLE_RECORD,
  SAMPLE_TASKS,
  sampleDetails,
  sampleEditorProps,
} from '../../workbench/record-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { ActivityFeed } from '../ActivityFeed/ActivityFeed.tsx';
import { AttributeList } from '../AttributeList/AttributeList.tsx';
import { TaskList } from '../TaskList/TaskList.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { RecordPanel } from './RecordPanel.tsx';

interface SampleProps {
  readonly startOpen?: boolean;
  readonly onOpenPage?: () => void;
  readonly status?: LoadStatus;
}

/** A company opened from the table: details, activity and tasks, stepping through three companies. */
function SamplePanel({ startOpen = true, onOpenPage, status = 'ready' }: SampleProps) {
  const [isOpen, setOpen] = useState(startOpen);
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState(SAMPLE_RECORD.values);
  const record = SAMPLE_COMPANIES[index] as RecordRefDisplay;
  const last = 2;
  return (
    <Stage>
      <Button
        icon="building"
        onPress={() => {
          setOpen(true);
        }}
      >
        Open Northwind
      </Button>
      <RecordPanel
        status={status}
        {...(status === 'loading' ? {} : { record })}
        isOpen={isOpen}
        onClose={() => {
          setOpen(false);
        }}
        {...(index > 0
          ? {
              onPrevious: () => {
                setIndex(index - 1);
              },
            }
          : {})}
        {...(index < last
          ? {
              onNext: () => {
                setIndex(index + 1);
              },
            }
          : {})}
        {...(onOpenPage === undefined ? {} : { onOpenPage })}
        actions={<Button variant="ghost" icon="ellipsis" label="Record actions" />}
        tabs={[
          {
            id: 'details',
            label: 'Details',
            content: (
              <AttributeList
                label="Details"
                sections={sampleDetails(values)}
                editorProps={sampleEditorProps}
                onCommit={(attributeId, value) => {
                  setValues((previous) => ({ ...previous, [attributeId]: value }));
                }}
              />
            ),
          },
          {
            id: 'activity',
            label: 'Activity',
            count: SAMPLE_ACTIVITY.length,
            content: <ActivityFeed label="Activity" entries={arraySource(SAMPLE_ACTIVITY, (entry) => entry.id)} />,
          },
          {
            id: 'tasks',
            label: 'Tasks',
            count: SAMPLE_TASKS.length,
            content: (
              <TaskList
                label="Tasks"
                hideRecord
                tasks={arraySource(SAMPLE_TASKS, (task) => task.id)}
                onToggle={() => undefined}
              />
            ),
          },
        ]}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/RecordPanel',
  component: SamplePanel,
} satisfies Meta<typeof SamplePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A company beside the table: its avatar and name, Previous and Next, Open full page, and its tabs. */
export const Default: Story = {
  args: { onOpenPage: fn() },
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    const panel = canvas.getByRole('dialog', { name: 'Northwind Traders' });
    await expect(within(panel).getByRole('button', { name: 'Previous record' })).toBeDisabled();
    await expect(within(panel).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    await expect(within(panel).getByRole('region', { name: 'Details' })).toBeInTheDocument();
  },
};

/** Next steps to the record below without closing the panel; at the last record focus moves to Previous. Open full page asks the app. */
export const StepThrough: Story = {
  args: { onOpenPage: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Next record' }));
    await expect(canvas.getByRole('dialog', { name: 'Globex' })).toBeInTheDocument();
    canvas.getByRole('button', { name: 'Next record' }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Next record' })).toBeDisabled());
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Previous record' })).toHaveFocus());
    await userEvent.click(canvas.getByRole('button', { name: 'Open full page' }));
    await expect(args.onOpenPage).toHaveBeenCalled();
  },
};

/** The Activity tab: the feed fills the panel under the tabs and scrolls inside it. */
export const Activity: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('tab', { name: /Activity/ }));
    const feed = await canvas.findByRole('feed', { name: 'Activity' });
    await waitFor(() => expect(feed.clientHeight).toBeLessThan(feed.scrollHeight));
    await expect(canvas.getAllByRole('article').length).toBeGreaterThan(0);
  },
};

/** Esc in a value's editor cancels the edit and leaves the panel open; Esc again closes it. */
export const EscInAnEditor: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByText('London'));
    await canvas.findByRole('textbox', { name: 'City' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Edit City' })).toHaveFocus());
    await expect(canvas.getByRole('dialog', { name: 'Northwind Traders' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('dialog')).not.toBeInTheDocument());
  },
};

/** The record is still coming: skeletons in place of the tabs. */
export const Loading: Story = {
  args: { status: 'loading' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('dialog', { name: 'Loading record' })).toBeInTheDocument();
  },
};

/** The viewer may not see this record. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see this record')).toBeInTheDocument();
  },
};
