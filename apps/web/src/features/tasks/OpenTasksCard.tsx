// Brief
// Purpose: a record's open tasks at a glance, on its Overview.
// Main task: see the first five open tasks, tick one, add one, or go on to the Tasks tab.
// Leaves out: completed tasks and reminders (#28).
import type { MemberSummary, RecordRefDisplay, TaskList as TaskListSource } from '@crm/data';
import { useTaskList } from '@crm/data/react';
import { Button, Card, TaskList } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { strings } from './strings.ts';
import { useTaskEntries } from './useTaskEntries.ts';

/** The most open tasks Overview draws (AC-435). */
export const OPEN_TASKS_SHOWN = 5;

/** Props for Overview's Open tasks block. */
export interface OpenTasksCardProps {
  readonly slug: string;
  readonly record: RecordRefDisplay;
  /** The record's open tasks, the same list its Tasks tab shows. */
  readonly open: TaskListSource;
  readonly members: readonly MemberSummary[];
  /** The person may change the record's object: "Add a task" shows. */
  readonly canAdd: boolean;
  readonly recordHref: (record: RecordRefDisplay) => string | undefined;
  readonly onOpenTask: (taskId: string) => void;
  /** Opens the Tasks tab. */
  readonly onViewAll: () => void;
}

/** "Open tasks": the first five drawn in place, with "Add a task" and "View all". */
export function OpenTasksCard({
  slug,
  record,
  open,
  members,
  canAdd,
  recordHref,
  onOpenTask,
  onViewAll,
}: OpenTasksCardProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const state = useTaskList(open);
  const entries = useTaskEntries(state.source, members, record.recordId);
  return (
    <Card
      title={strings.openTasks}
      isBusy={state.status === 'loading'}
      actions={
        <>
          {canAdd && (
            <Button
              variant="ghost"
              icon="plus"
              onPress={() => {
                onOpenTask('new');
              }}
            >
              {strings.addTask}
            </Button>
          )}
          <Button variant="ghost" onPress={onViewAll}>
            {strings.viewAll}
          </Button>
        </>
      }
    >
      <TaskList
        label={strings.openTasks}
        layout="inline"
        maxRows={OPEN_TASKS_SHOWN}
        tasks={entries}
        status={state.status === 'unavailable' ? 'no-access' : state.status}
        onRetry={open.retry}
        newIds={state.newIds}
        emptyTitle={strings.noOpenTasksShort}
        recordHref={recordHref}
        onToggle={(task, isDone) => {
          void data.tasks.setDone(slug, task.id, isDone);
        }}
        onAction={(task) => {
          onOpenTask(task.id);
        }}
      />
    </Card>
  );
}
