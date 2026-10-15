// A task list's source as TaskList draws it: each TaskView mapped to its
// entry once and kept while the body stays the same object, so a row draws
// again only when its task changed (for as long as the list's source lasts).
import type { MemberSummary, TaskListState, TaskView } from '@crm/data';
import type { ListSource, TaskEntry } from '@crm/ui';
import { useMemo } from 'react';
import { toTaskEntry } from './entries.ts';

/** The list's tasks as entries, keyed by task, mapped once per body. */
export function useTaskEntries(
  source: TaskListState['source'],
  members: readonly MemberSummary[],
  pageRecordId?: string,
): ListSource<TaskEntry> {
  return useMemo(() => {
    // Each body mapped once while this source lasts.
    const cache = new WeakMap<TaskView, TaskEntry>();
    return {
      count: source.count,
      getItem: (index: number) => {
        const task = source.getItem(index);
        if (task === undefined) return undefined;
        const held = cache.get(task);
        if (held !== undefined) return held;
        const made = toTaskEntry(task, members, pageRecordId);
        cache.set(task, made);
        return made;
      },
      getKey: (entry: TaskEntry) => entry.id,
      onRangeChange: source.onRangeChange,
    };
  }, [source, members, pageRecordId]);
}
