// A task list's source as TaskList draws it: each TaskView mapped to its
// entry once and kept while the body stays the same object, so a row draws
// again only when its task changed (while the members and the page stay).
import type { MemberSummary, TaskListState, TaskView } from '@crm/data';
import type { ListSource, TaskEntry } from '@crm/ui';
import { useMemo } from 'react';
import { toTaskEntry } from './entries.ts';

/** The list's tasks as entries, keyed by task, mapped once per body. */
export function useTaskEntries(
  source: TaskListState['source'],
  members: readonly MemberSummary[],
  pageRecordId?: string,
  /** Every task is the member's own (Assigned to me): the same face on every row says nothing, so it goes. */
  withoutAssignee = false,
): ListSource<TaskEntry> {
  // One cache while the members and the page stay: unchanged bodies keep their entries across list changes.
  const cache = useMemo(
    () => ({ entries: new WeakMap<TaskView, TaskEntry>(), members, pageRecordId, withoutAssignee }),
    [members, pageRecordId, withoutAssignee],
  );
  return useMemo(() => {
    return {
      count: source.count,
      getItem: (index: number) => {
        const task = source.getItem(index);
        if (task === undefined) return undefined;
        const held = cache.entries.get(task);
        if (held !== undefined) return held;
        const entry = toTaskEntry(task, cache.members, cache.pageRecordId);
        const { assignee: _assignee, ...own } = entry;
        const made = cache.withoutAssignee ? own : entry;
        cache.entries.set(task, made);
        return made;
      },
      getKey: (entry: TaskEntry) => entry.id,
      onRangeChange: source.onRangeChange,
    };
  }, [source, cache]);
}
