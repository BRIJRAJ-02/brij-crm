import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { arraySource, type ListSource } from '../../lib/list-source.ts';
import { ADA, SAMPLE_TASKS } from '../../workbench/record-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { Disclosure } from '../../molecules/Disclosure/Disclosure.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
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
  /** A phone's column: under 480px the record chips step aside so titles keep the row. */
  readonly isPhone?: boolean;
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
  isPhone = false,
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
    <Stage height="grid" {...(isPhone ? { width: 'phone' as const } : {})}>
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

/** On a phone: each title keeps at least a narrow column, and the record chip gives way first. */
export const OnAPhone: Story = {
  args: { isPhone: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Send the order form')).toBeVisible();
    const title = canvas.getByText('Send the order form');
    const row = title.closest('[role="row"]');
    // The title keeps at least a narrow column (120px) beside the chip, due day and assignee.
    await expect(row).not.toBeNull();
    await expect(title.getBoundingClientRect().width).toBeGreaterThanOrEqual(120);
    await expect(canvas.getAllByText('Northwind Traders')[0]).toBeVisible();
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

/** The first linked record as a chip and "+2" for the others, the field set's one row of records: it opens them all. */
export const ManyRecords: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Show 2 more' }));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  },
};

/** A task just made here carries the "New" badge until its list settles. */
export const NewTask: Story = {
  render: function Render() {
    return (
      <Stage height="grid">
        <TaskList
          label="Tasks"
          tasks={arraySource(SAMPLE_TASKS, (task) => task.id)}
          newIds={new Set(['t4'])}
          onToggle={() => undefined}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('New')).toBeInTheDocument();
  },
};

/** Runs of tasks under headings (My tasks' Overdue, Today, Upcoming); the arrows skip the headings. */
export const Sections: Story = {
  render: function Render() {
    const sectionOf = (task: TaskEntry) =>
      task.dueOn === undefined
        ? { id: 'none', title: 'No date' }
        : task.dueOn < '2026-10-08'
          ? { id: 'overdue', title: 'Overdue' }
          : task.dueOn === '2026-10-08'
            ? { id: 'today', title: 'Today' }
            : { id: 'upcoming', title: 'Upcoming' };
    const open = SAMPLE_TASKS.filter((task) => !task.isDone);
    return (
      <Stage height="grid">
        <TaskList
          label="My tasks"
          tasks={arraySource(open, (task) => task.id)}
          sectionOf={sectionOf}
          onToggle={() => undefined}
        />
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('rowheader', { name: 'Overdue' })).toBeInTheDocument();
    await expect(canvas.getByRole('rowheader', { name: 'Upcoming' })).toBeInTheDocument();
    await userEvent.tab();
    await waitFor(() => expect(canvas.getByRole('row', { name: /Send the order form/ })).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(canvas.getByRole('row', { name: /Book the security review/ })).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(canvas.getByRole('row', { name: /Prepare the renewal deck/ })).toHaveFocus());
  },
};

/** Drawn in place on Overview: a few rows, no scroll of its own. */
export const Inline: Story = {
  render: function Render() {
    return (
      <Stage>
        <TaskList
          label="Open tasks"
          layout="inline"
          tasks={arraySource(
            SAMPLE_TASKS.filter((task) => !task.isDone),
            (task) => task.id,
          )}
          onToggle={() => undefined}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('row')).toHaveLength(4);
  },
};

/** An empty list in a screen's own words. */
export const EmptyOwnWords: Story = {
  render: function Render() {
    return (
      <Stage height="grid">
        <TaskList
          label="Tasks"
          tasks={arraySource([], (task: TaskEntry) => task.id)}
          emptyTitle="No open tasks. Add one above."
          onToggle={() => undefined}
        />
      </Stage>
    );
  },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No open tasks. Add one above.')).toBeInTheDocument();
  },
};

/**
 * A record's Tasks tab: the quick add above the open tasks (it stays when the
 * list is empty), and the Completed part under them, drawn in place.
 */
export const WithQuickAdd: Story = {
  render: function Render() {
    const open = SAMPLE_TASKS.filter((task) => !task.isDone);
    const done = SAMPLE_TASKS.filter((task) => task.isDone);
    return (
      <Stage height="grid">
        <TaskList
          label="Tasks"
          tasks={arraySource(open, (task) => task.id)}
          onToggle={() => undefined}
          toolbar={
            <>
              <Field label="Add a task" isLabelHidden placeholder="Add a task and press Enter" maxLength={2000} />
              <Button size="lg">New task</Button>
            </>
          }
          footer={
            <Disclosure title="Completed" count={done.length}>
              <TaskList
                label="Completed"
                layout="inline"
                maxRows={1000}
                tasks={arraySource(done, (task) => task.id)}
                onToggle={() => undefined}
              />
            </Disclosure>
          }
        />
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByRole('textbox', { name: 'Add a task' });
    const add = canvas.getByRole('button', { name: 'New task' });
    // One composer row: the field's box and its button at one height, side by side.
    const box = field.parentElement?.getBoundingClientRect();
    await expect(Math.round(box?.height ?? 0)).toBe(Math.round(add.getBoundingClientRect().height));
    await userEvent.click(canvas.getByRole('button', { name: /Completed/ }));
    await waitFor(() => expect(canvas.getByRole('grid', { name: 'Completed' })).toBeInTheDocument());
  },
};

/**
 * A record's Tasks tab with nothing open: the empty list says so in one row
 * under the quick add, and Completed follows it rather than sinking to the
 * foot of the slot.
 */
export const EmptyWithQuickAdd: Story = {
  render: function Render() {
    const done = SAMPLE_TASKS.filter((task) => task.isDone);
    return (
      <Stage height="grid">
        <TaskList
          label="Tasks"
          tasks={arraySource([], (task: TaskEntry) => task.id)}
          emptyTitle="No open tasks. Add one above."
          onToggle={() => undefined}
          toolbar={
            <>
              <Field label="Add a task" isLabelHidden placeholder="Add a task and press Enter" maxLength={2000} />
              <Button size="lg">New task</Button>
            </>
          }
          footer={
            <Disclosure title="Completed" count={done.length}>
              <TaskList
                label="Completed"
                layout="inline"
                maxRows={1000}
                tasks={arraySource(done, (task) => task.id)}
                onToggle={() => undefined}
              />
            </Disclosure>
          }
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    const empty = canvas.getByText('No open tasks. Add one above.');
    const completed = canvas.getByRole('button', { name: /Completed/ });
    // Completed sits right under the empty row, not at the foot of the slot.
    const gap = completed.getBoundingClientRect().top - empty.getBoundingClientRect().bottom;
    await expect(gap).toBeLessThan(40);
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

/** In place (Overview), still loading: skeleton rows after the loading delay. */
export const InlineLoading: Story = {
  render: function Render() {
    return (
      <Stage>
        <TaskList
          label="Open tasks"
          layout="inline"
          tasks={arraySource([], (task: TaskEntry) => task.id)}
          status="loading"
          onToggle={() => undefined}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading tasks')).toBeInTheDocument();
  },
};

/** In place, with nothing open, in the screen's own words. */
export const InlineEmpty: Story = {
  render: function Render() {
    return (
      <Stage>
        <TaskList
          label="Open tasks"
          layout="inline"
          tasks={arraySource([], (task: TaskEntry) => task.id)}
          emptyTitle="No open tasks."
          onToggle={() => undefined}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No open tasks.')).toBeInTheDocument();
  },
};

/** Framed (a quick add above) and failed: the toolbar stays, the failure takes one row under it. */
export const FramedFailed: Story = {
  args: { onRetry: fn() },
  render: function Render(args) {
    return (
      <Stage>
        <TaskList
          label="Open tasks"
          tasks={arraySource([], (task: TaskEntry) => task.id)}
          status="error"
          toolbar={<Button>Add task</Button>}
          onToggle={() => undefined}
          {...(args.onRetry === undefined ? {} : { onRetry: args.onRetry })}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveAttribute('data-layout', 'row');
    await expect(canvas.getByRole('button', { name: 'Add task' })).toBeVisible();
  },
};

/** In place (a card on Home), failed: one row with Try again, like the inline empty list. */
export const InlineFailed: Story = {
  args: { onRetry: fn() },
  render: function Render(args) {
    return (
      <Stage>
        <TaskList
          label="Open tasks"
          layout="inline"
          tasks={arraySource([], (task: TaskEntry) => task.id)}
          status="error"
          onToggle={() => undefined}
          {...(args.onRetry === undefined ? {} : { onRetry: args.onRetry })}
        />
      </Stage>
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('alert')).toHaveAttribute('data-layout', 'row');
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/**
 * In place with more waiting: "Show more" under the rows reads the next page
 * (the Completed part); when the last page lands it goes, and focus moves to
 * the last row rather than the page.
 */
export const ShowMore: Story = {
  args: { onAction: fn() },
  render: function Render() {
    const [shown, setShown] = useState(3);
    return (
      <Stage>
        <TaskList
          label="Completed"
          layout="inline"
          maxRows={1000}
          tasks={arraySource(SAMPLE_TASKS.slice(0, shown), (task) => task.id)}
          {...(shown < SAMPLE_TASKS.length
            ? {
                onShowMore: () => {
                  setShown(SAMPLE_TASKS.length);
                },
              }
            : {})}
          onToggle={() => undefined}
        />
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getAllByRole('row')).toHaveLength(3);
    canvas.getByRole('button', { name: 'Show more' }).focus();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Show more' })).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getAllByRole('row')).toHaveLength(SAMPLE_TASKS.length));
    await waitFor(() => expect(canvas.getAllByRole('row').at(-1)).toHaveFocus());
  },
};

/** Sections with rows still loading: a loading row stays in the run it follows. */
export const SectionsLoading: Story = {
  render: function Render() {
    const open = SAMPLE_TASKS.filter((task) => !task.isDone);
    const source = {
      count: open.length + 2,
      getItem: (index: number) => open[index],
      getKey: (task: TaskEntry) => task.id,
    };
    return (
      <Stage height="grid">
        <TaskList
          label="My tasks"
          tasks={source}
          sectionOf={(task) =>
            task.dueOn !== undefined && task.dueOn < '2026-10-08'
              ? { id: 'overdue', title: 'Overdue' }
              : { id: 'upcoming', title: 'Upcoming' }
          }
          onToggle={() => undefined}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('rowheader', { name: 'Overdue' })).toBeInTheDocument();
    await expect(canvas.getByRole('rowheader', { name: 'Upcoming' })).toBeInTheDocument();
  },
};
