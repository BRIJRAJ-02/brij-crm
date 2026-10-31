// Brief
// Purpose: the follow ups about this record, on its page's Tasks tab.
// Main task: add a task (type its title, press Enter) and tick it off.
// Leaves out: reminders (#28), tasks of related records, a task's description.
import { TASK_TITLE_MAX, type MemberSummary, type RecordRefDisplay, type TaskList as TaskListSource } from '@crm/data';
import { useTaskList } from '@crm/data/react';
import { Button, Disclosure, Field, TaskList, Tooltip } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { strings } from './strings.ts';
import { tickTask } from './toasts.ts';
import { useTaskEntries } from './useTaskEntries.ts';

/** Props for a record's Tasks tab. */
export interface TasksTabProps {
  readonly slug: string;
  /** The page's record, linked to every task made here. */
  readonly record: RecordRefDisplay;
  /** Its open tasks, by due date. */
  readonly open: TaskListSource;
  readonly members: readonly MemberSummary[];
  /** The person's member id: a new task is theirs (owner decision 1). */
  readonly meId: string | undefined;
  /** The person may change the record's object: the quick add shows. */
  readonly canAdd: boolean;
  /** A linked record's page, for its chip. */
  readonly recordHref: (record: RecordRefDisplay) => string | undefined;
  /** Opens the task dialog on a task, or on a new one. */
  readonly onOpenTask: (taskId: string) => void;
}

/** The quick add: Enter makes a task with that title, this record linked, assigned to the person. */
function QuickAdd({ slug, record, meId }: Pick<TasksTabProps, 'slug' | 'record' | 'meId'>) {
  const { data } = useRouteContext({ from: '__root__' });
  const [title, setTitle] = useState('');
  return (
    <Field
      label={strings.addTask}
      isLabelHidden
      placeholder={strings.addTaskPlaceholder}
      value={title}
      onChange={setTitle}
      maxLength={TASK_TITLE_MAX}
      // The count shows only near the limit (Field's rule).
      showCounter
      onSubmit={() => {
        const trimmed = title.trim();
        if (trimmed === '') return;
        // The field clears and keeps focus, for the next one; the task shows first in the list at once.
        setTitle('');
        void data.tasks.create(slug, {
          id: data.tasks.newId(),
          title: trimmed,
          records: [record],
          ...(meId === undefined ? {} : { assigneeMemberId: meId, createdBy: meId }),
        });
      }}
    />
  );
}

/** A list with nothing in it yet, for the Completed part before its tasks are asked for. */
const NO_TASKS = { count: 0, getItem: () => undefined, getKey: (task: { readonly id: string }) => task.id };

/**
 * The Completed part (AC-435): one Disclosure, closed by default, that never
 * changes under the person's focus. Its done tasks are read when it opens,
 * newest done first, and held only while it is open (closed, nothing settles
 * unseen); its count stays once read.
 */
function Completed({
  slug,
  record,
  members,
  recordHref,
  onOpenTask,
}: Pick<TasksTabProps, 'slug' | 'record' | 'members' | 'recordHref' | 'onOpenTask'>) {
  const { data } = useRouteContext({ from: '__root__' });
  const [isOpen, setOpen] = useState(false);
  const [done, setDone] = useState<TaskListSource | 'failed' | undefined>(undefined);
  const [count, setCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!isOpen || done !== undefined) return;
    let isLive = true;
    data.tasks.forRecord(slug, record.recordId, 'done', record.objectId).then(
      (list) => {
        if (isLive) setDone(list);
      },
      () => {
        // The store's code didn't load (offline): the part says so, with Try again.
        if (isLive) setDone('failed');
      },
    );
    return () => {
      isLive = false;
    };
  }, [isOpen, done, data, slug, record.recordId, record.objectId]);
  let body: ReactNode;
  if (done === 'failed') {
    body = (
      <TaskList
        label={strings.completed}
        layout="inline"
        tasks={NO_TASKS}
        status="error"
        onRetry={() => {
          setDone(undefined);
        }}
        onToggle={() => undefined}
      />
    );
  } else if (!isOpen || done === undefined) {
    body = (
      <TaskList
        label={strings.completed}
        layout="inline"
        tasks={NO_TASKS}
        status="loading"
        onToggle={() => undefined}
      />
    );
  } else {
    body = (
      <CompletedList
        slug={slug}
        record={record}
        list={done}
        members={members}
        recordHref={recordHref}
        onOpenTask={onOpenTask}
        onCount={setCount}
      />
    );
  }
  return (
    <Disclosure
      title={strings.completed}
      // The quiet fold, as the Home checklist's done steps: a grey bar here read as a stuck selected row.
      variant="quiet"
      isExpanded={isOpen}
      onExpandedChange={setOpen}
      {...(count === undefined ? {} : { count })}
    >
      {body}
    </Disclosure>
  );
}

/** The done tasks, drawn in place, the loaded ones only, with "Show more" for the next page. */
function CompletedList({
  slug,
  record,
  list,
  members,
  recordHref,
  onOpenTask,
  onCount,
}: Pick<TasksTabProps, 'slug' | 'record' | 'members' | 'recordHref' | 'onOpenTask'> & {
  readonly list: TaskListSource;
  readonly onCount: (count: number) => void;
}) {
  const { data } = useRouteContext({ from: '__root__' });
  const state = useTaskList(list);
  const entries = useTaskEntries(state.source, members, record.recordId);
  const total = state.total?.count;
  useEffect(() => {
    if (total !== undefined) onCount(total);
  }, [total, onCount]);
  // Drawn in place, so only the loaded rows (no skeletons to scroll to): "Show more" reads the next page.
  const loaded = useMemo(
    () => ({ count: state.loaded, getItem: entries.getItem, getKey: entries.getKey }),
    [state.loaded, entries],
  );
  return (
    <TaskList
      label={strings.completed}
      layout="inline"
      maxRows={Number.MAX_SAFE_INTEGER}
      tasks={loaded}
      {...(state.hasMore
        ? {
            onShowMore: () => {
              void list.more();
            },
            isLoadingMore: state.loadingMore,
          }
        : {})}
      status={state.status === 'unavailable' ? 'no-access' : state.status}
      onRetry={list.retry}
      emptyTitle={strings.noCompletedTasks}
      recordHref={recordHref}
      onToggle={(task, isDone) => {
        void data.tasks.setDone(slug, task.id, isDone);
      }}
      onAction={(task) => {
        onOpenTask(task.id);
      }}
    />
  );
}

/**
 * A record's Tasks tab (AC-432, AC-433, AC-435): the quick add, with a due date
 * and assignee one press away, over its open tasks by due date, ticked in place (a ticked task stays
 * struck through until the list settles), and Completed under them.
 */
export function TasksTab({ slug, record, open, members, meId, canAdd, recordHref, onOpenTask }: TasksTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const state = useTaskList(open);
  const entries = useTaskEntries(state.source, members, record.recordId);
  return (
    <TaskList
      label={strings.openTasks}
      tasks={entries}
      status={state.status === 'unavailable' ? 'no-access' : state.status}
      onRetry={open.retry}
      newIds={state.newIds}
      // One way to add (owner, 31 Oct: an input, a New task button and an empty state said the same thing three
      // times): the quick add, with its due date and assignee one press away; empty, the list is one quiet line.
      emptyTitle={strings.noOpenTasksShort}
      recordHref={recordHref}
      onToggle={(task, isDone) => {
        tickTask(toasts, (next) => data.tasks.setDone(slug, task.id, next), isDone);
      }}
      onAction={(task) => {
        onOpenTask(task.id);
      }}
      {...(canAdd
        ? {
            toolbar: (
              <>
                <QuickAdd slug={slug} record={record} meId={meId} />
                <Tooltip content={strings.newTaskWithDetails}>
                  <Button
                    // The composer's height: beside the 30px field.
                    size="lg"
                    icon="calendar-plus"
                    label={strings.newTaskWithDetails}
                    onPress={() => {
                      onOpenTask('new');
                    }}
                  />
                </Tooltip>
              </>
            ),
          }
        : {})}
      footer={
        // Keyed by the record, so another record's page never shows this one's done tasks.
        <Completed
          key={record.recordId}
          slug={slug}
          record={record}
          members={members}
          recordHref={recordHref}
          onOpenTask={onOpenTask}
        />
      }
    />
  );
}
