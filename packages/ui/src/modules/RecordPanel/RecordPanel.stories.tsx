import type { RecordRefDisplay } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { RecordFacts } from '../../molecules/RecordFacts/RecordFacts.tsx';
import { attributeOf } from '../../workbench/attributes.ts';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
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
  /** The stat strip over the tabs (on by default), or its values still coming. */
  readonly stats?: 'shown' | 'loading' | 'none';
  /** The record was deleted while open (a notice over the tabs), or isn't available at all (in place of the tabs). */
  readonly gone?: 'lost' | 'unavailable';
  /** The next record is on its way (a held ↓): a thin progress line along the body's top edge. */
  readonly isStepping?: boolean;
  /** The record at a glance under the header, with its quick actions (owner, 31 Oct). */
  readonly withSummary?: boolean;
}

const DOMAIN = attributeOf('domain', 'Domains');

/** A company opened from the table: details, activity and tasks, stepping through three companies. */
function SamplePanel({
  startOpen = true,
  onOpenPage,
  status = 'ready',
  stats = 'shown',
  gone,
  isStepping = false,
  withSummary = false,
}: SampleProps) {
  const [isOpen, setOpen] = useState(startOpen);
  const [tab, setTab] = useState('details');
  const isLoadingStats = stats === 'loading';
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
        isStepping={isStepping}
        {...(status === 'loading' || gone === 'unavailable' ? {} : { record })}
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
        {...(gone === 'lost'
          ? {
              notice: (
                <Callout tone="danger" isAnnounced>
                  This company is no longer available.
                </Callout>
              ),
            }
          : {})}
        {...(gone === 'unavailable'
          ? {
              empty: (
                <EmptyState icon="search" title="This record isn’t available.">
                  It may have been deleted, or you can’t see it.
                </EmptyState>
              ),
            }
          : {})}
        {...(withSummary
          ? {
              facts: (
                <RecordFacts
                  label={`About ${record.name}`}
                  facts={[
                    {
                      id: 'domain',
                      label: 'Domains',
                      content: (
                        <AttributeDisplay attribute={DOMAIN} value={['northwind.com'] as never} surface="panel" />
                      ),
                    },
                  ]}
                />
              ),
              quickActions: (
                <>
                  <Button icon="pen">Log activity</Button>
                  <Button icon="list-plus">Add task</Button>
                </>
              ),
            }
          : {})}
        selectedTab={tab}
        onTabChange={setTab}
        stats={
          stats === 'none'
            ? []
            : [
                { id: 'meeting', label: 'Next meeting', icon: 'calendar', isLoading: isLoadingStats },
                {
                  id: 'activity',
                  label: 'Last activity',
                  icon: 'activity',
                  isLoading: isLoadingStats,
                  ...(SAMPLE_ACTIVITY[0] === undefined ? {} : { time: SAMPLE_ACTIVITY[0].at }),
                  onPress: () => {
                    setTab('activity');
                  },
                },
              ]
        }
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

/** A company beside the table: its avatar and name, Previous and Next, Open full page, its stat strip, and its tabs. */
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

/** The record at a glance: its facts and quick actions under the header; Previous and Next sit apart from Open and Close. */
export const WithSummary: Story = {
  args: { onOpenPage: fn(), withSummary: true },
  play: async ({ canvas }) => {
    const panel = canvas.getByRole('dialog', { name: 'Northwind Traders' });
    await expect(within(panel).getByRole('list', { name: 'About Northwind Traders' })).toBeInTheDocument();
    await expect(within(panel).getByRole('button', { name: 'Log activity' })).toBeInTheDocument();
    await expect(within(panel).getByRole('button', { name: 'Close' })).toBeInTheDocument();
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

/** ↓ and ↑ step through the list as Next and Previous do; inside the tabs the arrows stay the tabs'. */
export const ArrowKeysStep: Story = {
  args: { onOpenPage: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Open full page' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('dialog', { name: 'Globex' })).toBeInTheDocument();
    canvas.getByRole('button', { name: 'Open full page' }).focus();
    await userEvent.keyboard('{ArrowUp}');
    await expect(canvas.getByRole('dialog', { name: 'Northwind Traders' })).toBeInTheDocument();
    canvas.getByRole('tab', { name: 'Details' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('dialog', { name: 'Northwind Traders' })).toBeInTheDocument();
  },
};

/** The record was deleted while open: the notice says so over the tabs, which stay. */
export const NoLongerAvailable: Story = {
  args: { gone: 'lost', stats: 'none' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('This company is no longer available.')).toBeInTheDocument();
    await expect(canvas.getByRole('tab', { name: 'Details' })).toBeInTheDocument();
  },
};

/** A record that doesn't exist or is hidden: the screen's EmptyState in place of the tabs, Close in the header. */
export const Unavailable: Story = {
  args: { gone: 'unavailable', stats: 'none' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('dialog', { name: 'Record unavailable' })).toBeInTheDocument();
    await expect(canvas.getByText('This record isn’t available.')).toBeInTheDocument();
    await expect(canvas.queryByRole('tab')).not.toBeInTheDocument();
  },
};

/** A stat that goes somewhere opens its tab: Last activity shows the Activity tab. */
export const StatOpensTab: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('group', { name: 'About Northwind Traders' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Last activity' }));
    await expect(canvas.getByRole('tab', { name: /Activity/ })).toHaveAttribute('aria-selected', 'true');
  },
};

/** The stats still coming: a skeleton in place of each value. */
export const StatsLoading: Story = {
  args: { stats: 'loading' },
  play: async ({ canvas }) => {
    const strip = canvas.getByRole('group', { name: 'About Northwind Traders' });
    const values = within(strip).getAllByRole('definition');
    await expect(values.every((value) => value.getAttribute('aria-busy') === 'true')).toBe(true);
  },
};

/** Without stats the tabs start right under the panel's bar. */
export const NoStats: Story = {
  args: { stats: 'none' },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('group', { name: /About/ })).not.toBeInTheDocument();
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

/** The next record is on its way: after the loading delay a thin progress line shows over the body and the tabs dim, with no change of layout. */
export const Stepping: Story = {
  args: { isStepping: true },
  play: async ({ canvas }) => {
    const panel = canvas.getByRole('dialog', { name: 'Northwind Traders' });
    await waitFor(() => expect(within(panel).getByRole('progressbar', { name: 'Loading record' })).toBeInTheDocument());
    await expect(within(panel).getByRole('region', { name: 'Details' })).toBeInTheDocument();
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
