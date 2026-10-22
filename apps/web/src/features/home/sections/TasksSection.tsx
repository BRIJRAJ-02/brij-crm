// Home's My tasks (spec 0041): the open tasks assigned to me that are due
// today or overdue, at most five, from My tasks' own open list (live, and read
// again when shown), so a tick here is the same one My tasks makes.
import type { TaskList as TaskListSource, TaskListState } from '@crm/data';
import { useTaskList } from '@crm/data/react';
import { ButtonLink, Card, TaskList, useFormatSettings, type ListSource, type TaskEntry } from '@crm/ui';
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useToday } from '../../tasks/day.ts';
import { useTaskEntries } from '../../tasks/useTaskEntries.ts';
import { recordLinks } from '../../records/timeline.ts';
import { duePrefix } from '../due.ts';
import type { HomeSectionProps } from '../registry.ts';
import { strings } from '../strings.ts';

/** How many due tasks My tasks draws, as timefix's card does. */
export const TASKS_SHOWN = 5;

/** A task list that never loads: the shape My tasks holds when the list couldn't be opened. */
const NO_TASKS: TaskListState = {
  status: 'error',
  source: { count: 0, getItem: () => undefined, getKey: (task) => task.id, onRangeChange: () => undefined },
  newIds: new Set(),
  hasMore: false,
  loadingMore: false,
  loaded: 0,
};

/** A task list that is never read, failed: what the section holds when My tasks couldn't be opened. */
const FAILED_TASKS: TaskListSource = {
  subscribe: () => () => undefined,
  getSnapshot: () => NO_TASKS,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  retry: () => undefined,
  more: () => Promise.resolve(),
};

/**
 * The task entries without their assignee (every task here is the member's own, so the same face on every row
 * says nothing), cut to the due ones. Each entry is copied once and kept while its task stays the same object.
 */
function useDueEntries(source: ListSource<TaskEntry>, due: number): ListSource<TaskEntry> {
  const cache = useMemo(() => ({ entries: new WeakMap<TaskEntry, TaskEntry>() }), []);
  return useMemo(
    () => ({
      ...source,
      count: Math.min(due, TASKS_SHOWN),
      getItem: (index: number) => {
        const entry = source.getItem(index);
        if (entry === undefined) return undefined;
        const held = cache.entries.get(entry);
        if (held !== undefined) return held;
        const { assignee: _assignee, ...own } = entry;
        cache.entries.set(entry, own);
        return own;
      },
    }),
    [source, due, cache],
  );
}

/** My tasks: what is due today or overdue, earliest first; a tick is the same one My tasks makes. */
export function TasksSection({ context }: HomeSectionProps) {
  const { slug, objects, members, tasks: list } = context;
  const { data } = useRouteContext({ from: '__root__' });
  const router = useRouter();
  const navigate = useNavigate();
  const { timeZone } = useFormatSettings();
  const today = useToday(timeZone);
  const state = useTaskList(list ?? FAILED_TASKS);
  const all = useTaskEntries(state.source, members);
  // Every loaded task is read at most once a render: the open list holds 50 a page.
  const due = duePrefix(all.getItem, all.count, today, all.count);
  const entries = useDueEntries(all, due);
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  const hidden = due - TASKS_SHOWN;
  const runsOn = state.status === 'ready' && due === all.count && state.hasMore;
  const footer =
    state.status !== 'ready'
      ? undefined
      : runsOn
        ? strings.moreInTasks
        : hidden > 0
          ? strings.moreDue(hidden)
          : undefined;
  return (
    <Card
      title={strings.myTasks}
      isBusy={state.status === 'loading'}
      {...(footer === undefined ? {} : { footer })}
      actions={
        <ButtonLink variant="ghost" href={`/w/${slug}/tasks`}>
          {strings.allTasks}
        </ButtonLink>
      }
    >
      <TaskList
        label={strings.myTasks}
        layout="inline"
        maxRows={TASKS_SHOWN}
        tasks={entries}
        status={state.status === 'unavailable' ? 'no-access' : state.status}
        onRetry={() => {
          if (list === undefined) void router.invalidate();
          else list.retry();
        }}
        newIds={state.newIds}
        emptyTitle={strings.noTasksDue}
        emptyBody={strings.noTasksDueText}
        recordHref={(record) => link(record.objectId, record.recordId)}
        onToggle={(task, isDone) => {
          void data.tasks.setDone(slug, task.id, isDone);
        }}
        onAction={(task) => {
          void navigate({ to: '/w/$slug/tasks', params: { slug }, search: { task: task.id } });
        }}
      />
    </Card>
  );
}
