// Brief
// Purpose: each person's to do list across the workspace, on `/w/$slug/tasks`.
// Main task: see what's due today and get it done (tick it, or open it to change it).
// Leaves out: search and saved filters (#33, #20), other people's lists except through "All tasks", deleting (milestone 4).
import type { MemberSummary, ObjectSummary, TaskList as TaskListSource, TaskMine } from '@crm/data';
import { useTaskList } from '@crm/data/react';
import { Button, SectionBar, SegmentedControl, TaskList, TopBar } from '@crm/ui';
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router';
import { useCallback, useMemo, useRef } from 'react';
import { recordLinks } from '../records/timeline.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { daySections, useToday } from './day.ts';
import { strings } from './strings.ts';
import { TaskDialog } from './TaskDialog.tsx';
import { useTaskEntries } from './useTaskEntries.ts';

/** Open tasks, or done ones. */
export type MyTasksStatus = 'open' | 'done';

/** Props for My tasks: what its route loaded through the data layer, and its address. */
export interface MyTasksScreenProps {
  readonly slug: string;
  readonly filter: TaskMine;
  readonly status: MyTasksStatus;
  /** `?task=`: the task dialog over the list. */
  readonly task?: string;
  /** The list the filter and status name. */
  readonly list: TaskListSource;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  readonly meId: string | undefined;
}

const FILTERS: readonly { readonly value: TaskMine; readonly label: string }[] = [
  { value: 'assigned', label: strings.assignedToMe },
  { value: 'created', label: strings.createdByMe },
  { value: 'all', label: strings.allTasks },
];

const STATUSES: readonly { readonly value: MyTasksStatus; readonly label: string }[] = [
  { value: 'open', label: strings.open },
  { value: 'done', label: strings.completed },
];

/** What an empty list says, by filter and status. */
function emptyOf(filter: TaskMine, status: MyTasksStatus): { readonly title: string; readonly body?: string } {
  if (status === 'done') return { title: strings.noCompletedTasks };
  if (filter === 'assigned') return { title: strings.emptyAssigned, body: strings.emptyAssignedBody };
  return { title: filter === 'created' ? strings.emptyCreated : strings.emptyAll };
}

/**
 * My tasks (AC-436, AC-437): the filter and the status in the address, the
 * open list grouped Overdue, Today, Upcoming and No date by the browser's
 * local day (moving at midnight with no server call), the done list newest
 * done first, 50 at a time as it scrolls, live. "New task" opens the dialog
 * with no record linked.
 */
export function MyTasksScreen({ slug, filter, status, task, list, objects, members, meId }: MyTasksScreenProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const router = useRouter();
  const state = useTaskList(list);
  const entries = useTaskEntries(state.source, members);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const today = useToday(timeZone);
  const sectionOf = useMemo(() => (status === 'open' ? daySections(today) : undefined), [status, today]);
  const link = useMemo(() => recordLinks(slug, objects), [slug, objects]);
  const recordHref = useCallback(
    (display: { readonly objectId: string; readonly recordId: string }) => link(display.objectId, display.recordId),
    [link],
  );
  // Whether this page opened the dialog, so closing it steps Back rather than adding a step.
  const openedHere = useRef(false);
  const go = (search: { readonly filter?: TaskMine; readonly status?: MyTasksStatus; readonly task?: string }) => {
    const next = { filter: search.filter ?? filter, status: search.status ?? status, task: search.task };
    void navigate({
      to: '/w/$slug/tasks',
      params: { slug },
      search: {
        // The defaults stay out of the address.
        ...(next.filter === 'assigned' ? {} : { filter: next.filter }),
        ...(next.status === 'open' ? {} : { status: next.status }),
        ...(next.task === undefined ? {} : { task: next.task }),
      },
      ...(search.task === undefined ? { replace: true } : {}),
    });
  };
  const openTask = (taskId: string) => {
    openedHere.current = true;
    go({ task: taskId });
  };
  const closeTask = () => {
    if (openedHere.current) {
      openedHere.current = false;
      router.history.back();
      return;
    }
    go({});
  };
  const empty = emptyOf(filter, status);
  const filterLabel = FILTERS.find((each) => each.value === filter)?.label ?? strings.myTasks;
  const statusLabel = STATUSES.find((each) => each.value === status)?.label ?? strings.open;
  return (
    <WorkspacePage
      currentPage="tasks"
      page={{
        topBar: (
          <TopBar title={strings.myTasks} icon="square-check">
            <Button
              variant="primary"
              onPress={() => {
                openTask('new');
              }}
            >
              {strings.newTask}
            </Button>
          </TopBar>
        ),
        toolbar: (
          <SectionBar
            start={
              <SegmentedControl
                label={strings.whoseTasks}
                segments={FILTERS}
                value={filter}
                onChange={(value) => {
                  const picked = FILTERS.find((each) => each.value === value);
                  if (picked !== undefined) go({ filter: picked.value });
                }}
              />
            }
            end={
              <SegmentedControl
                label={strings.taskStatus}
                segments={STATUSES}
                value={status}
                onChange={(value) => {
                  const picked = STATUSES.find((each) => each.value === value);
                  if (picked !== undefined) go({ status: picked.value });
                }}
              />
            }
          />
        ),
        body: (
          <>
            <TaskList
              label={strings.listLabel(filterLabel, statusLabel)}
              tasks={entries}
              status={state.status === 'unavailable' ? 'no-access' : state.status}
              onRetry={list.retry}
              newIds={state.newIds}
              {...(sectionOf === undefined ? {} : { sectionOf })}
              emptyTitle={empty.title}
              {...(empty.body === undefined ? {} : { emptyBody: empty.body })}
              recordHref={recordHref}
              onToggle={(entry, isDone) => {
                void data.tasks.setDone(slug, entry.id, isDone);
              }}
              onAction={(entry) => {
                openTask(entry.id);
              }}
            />
            {task !== undefined && (
              <TaskDialog slug={slug} task={task} objects={objects} members={members} meId={meId} onClose={closeTask} />
            )}
          </>
        ),
      }}
    />
  );
}
