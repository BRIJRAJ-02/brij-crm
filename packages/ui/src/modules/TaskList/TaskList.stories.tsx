import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { arraySource, type ListSource } from '../../lib/list-source.ts';
import { ADA, SAMPLE_TASKS } from '../../workbench/record-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import type { LoadStatus } from '../../lib/load-status.ts';
import { TaskList, type TaskEntry } from './TaskList.tsx';

/** 5,000 tasks made from their index, every seventh still loading. */
function longSource(onRangeChange: (range: { start: number; end: number }) => void): ListSource<TaskEntry> {
  return {
    count: 5000,
    getItem: (index) =>
      index % 7 === 6
        ? undefined
        : { id: `long-${String(index)}`, title: `Task ${String(index + 1)}`, isDone: index % 3 === 0, assignee: ADA },
    getKey: (task) => task.id,
    onRangeChange,
  };
}

interface SampleProps {
  readonly onToggle?: (task: TaskEntry, isDone: boolean) => void;
  readonly onAction?: (task: TaskEntry) => void;
  readonly onRangeChange?: (range: { start: number; end: number }) => void;
  readonly isLong?: boolean;
  readonly isEmpty?: boolean;
  readonly status?: LoadStatus;
  readonly onRetry?: () => void;
  readonly hideRecord?: boolean;
  readonly isReadOnly?: boolean;
  readonly withLocked?: boolean;
}

/** The list holding its own tasks, as the data layer would, in a fixed height slot. */
function SampleTasks({
  onToggle,
  onAction,
  onRangeChange,
  isLong = false,
  isEmpty = false,
  status,
  onRetry,
  hideRecord,
  isReadOnly,
  withLocked = false,
}: SampleProps) {
  const [tasks, setTasks] = useState<readonly TaskEntry[]>(() =>
    isEmpty
      ? []
      : withLocked
        ? SAMPLE_TASKS.map((task, index) =>
            index === 1 ? { ...task, readOnlyReason: 'Only Grace Hopper can tick this task.' } : task,
          )
        : SAMPLE_TASKS,
  );
  const source = isLong ? longSource(onRangeChange ?? (() => undefined)) : arraySource(tasks, (task) => task.id);
  return (
    <Stage height="grid">
      <TaskList
        label="Tasks"
        tasks={source}
        onToggle={(task, isDone) => {
          setTasks((previous) => previous.map((each) => (each.id === task.id ? { ...each, isDone } : each)));
          onToggle?.(task, isDone);
        }}
        {...(onAction === undefined ? {} : { onAction })}
        {...(status === undefined ? {} : { status })}
        {...(onRetry === undefined ? {} : { onRetry })}
        {...(hideRecord === undefined ? {} : { hideRecord })}
        {...(isReadOnly === undefined ? {} : { isReadOnly })}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/TaskList',
  component: SampleTasks,
} satisfies Meta<typeof SampleTasks>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open tasks with their record, due day (overdue in red) and assignee, and one already done. */
export const Default: Story = {
  args: { onAction: fn() },
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('grid', { name: 'Tasks' })).toBeInTheDocument();
    await expect(canvas.getByText('Overdue,', { exact: false })).toBeInTheDocument();
    await expect(canvas.getByText('Tomorrow')).toBeInTheDocument();
    await expect(
      canvas.getByRole('checkbox', { name: 'Mark “Send the security questionnaire” as done' }),
    ).toBeChecked();
  },
};

/** A click on the checkbox marks the task done. */
export const MarkDone: Story = {
  args: { onToggle: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    const box = canvas.getByRole('checkbox', { name: 'Mark “Send the order form” as done' });
    await userEvent.click(box);
    await expect(args.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), true);
    await waitFor(() =>
      expect(canvas.getByRole('checkbox', { name: 'Mark “Send the order form” as done' })).toBeChecked(),
    );
  },
};

/** By keyboard: the arrows move between rows, right reaches the checkbox and Space ticks it; Enter on a row opens the task. */
export const Keyboard: Story = {
  args: { onToggle: fn(), onAction: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getAllByRole('row')[1]).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }));
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('checkbox', { name: /Book the security review/ })).toHaveFocus());
    await userEvent.keyboard(' ');
    await expect(args.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }), true);
  },
};

/** On a record's own page, the record chip goes. */
export const OnARecord: Story = {
  args: { hideRecord: true },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText('Northwind Traders')).not.toBeInTheDocument();
  },
};

/** 5,000 tasks draw only the rows on screen, with skeletons for those still loading. */
export const LongList: Story = {
  args: { isLong: true, onRangeChange: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, canvas }) => {
    await waitFor(() => expect(args.onRangeChange).toHaveBeenCalled());
    await expect(canvas.getAllByRole('row').length).toBeLessThan(40);
  },
};

/** No tasks yet. */
export const Empty: Story = {
  args: { isEmpty: true },
};

/** The tasks are still coming. */
export const Loading: Story = {
  args: { status: 'loading' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading tasks')).toBeInTheDocument();
  },
};

/** The tasks failed to load. */
export const Failed: Story = {
  args: { status: 'error', onRetry: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** The viewer may not see these tasks. */
export const NoAccess: Story = {
  args: { status: 'no-access' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('You can’t see these tasks')).toBeInTheDocument();
  },
};

/** Nobody here can tick tasks; one task alone says why it is locked. */
export const ReadOnly: Story = {
  args: { isReadOnly: true, withLocked: true, onToggle: fn() },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Mark “Send the order form” as done' }));
    await expect(args.onToggle).not.toHaveBeenCalled();
    await expect(canvas.getByRole('button', { name: 'Only Grace Hopper can tick this task.' })).toBeInTheDocument();
  },
};

/** Ticking a task on a list that drops done tasks: focus stays with the row now in that place, never on a stale one. */
export const TickKeepsTheRightRow: Story = {
  args: { onToggle: fn() },
  parameters: { crm: { screenshot: false } },
  render: function Render(args) {
    const [tasks, setTasks] = useState(SAMPLE_TASKS.filter((task) => !task.isDone));
    return (
      <Stage height="grid">
        <TaskList
          label="Open tasks"
          tasks={arraySource(tasks, (task) => task.id)}
          onToggle={(task, isDone) => {
            setTasks((previous) => previous.filter((each) => each.id !== task.id));
            args.onToggle?.(task, isDone);
          }}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    const rows = () => canvas.getAllByRole('row');
    await expect(rows()).toHaveLength(4);
    canvas.getByRole('checkbox', { name: 'Mark “Send the order form” as done' }).click();
    await waitFor(() => expect(rows()).toHaveLength(3));
    await expect(rows()[0]).toHaveTextContent('Book the security review');
    await expect(canvas.getByRole('checkbox', { name: /Book the security review/ })).not.toBeChecked();
  },
};
