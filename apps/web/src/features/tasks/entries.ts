// Tasks as the library draws them (spec 0019, value sourcing): plain
// functions with no React, so they test in Node. A task's assignee is named
// from the members ("Former member" for one no longer active), the record
// chip on a record's own Tasks tab shows the first linked record that isn't
// that record (that record when it is the only one), and a task the reader
// may not change says why.
import type { ActorDisplay, MemberSummary, RecordRefDisplay, TaskView } from '@crm/data';
import type { TaskEntry } from '@crm/ui';
import { strings } from './strings.ts';

/** A member's display by id, or "Former member" for one no longer in the workspace. */
export function memberDisplay(members: readonly MemberSummary[], memberId: string): ActorDisplay {
  const member = members.find((each) => each.id === memberId);
  return member === undefined
    ? { type: 'member', id: memberId, name: strings.formerMember }
    : { type: 'member', id: member.id, name: member.name, email: member.email };
}

/**
 * The records in the order the chip shows them: on a record's own page, the
 * others first (the page's record would say nothing), the page's record last;
 * elsewhere, in link order.
 */
export function chipOrder(records: readonly RecordRefDisplay[], pageRecordId?: string): readonly RecordRefDisplay[] {
  if (pageRecordId === undefined) return records;
  const others = records.filter((record) => record.recordId !== pageRecordId);
  const own = records.filter((record) => record.recordId === pageRecordId);
  return [...others, ...own];
}

/** A task as TaskList's entry. */
export function toTaskEntry(task: TaskView, members: readonly MemberSummary[], pageRecordId?: string): TaskEntry {
  return {
    id: task.id,
    title: task.title,
    isDone: task.isDone,
    ...(task.dueOn === undefined ? {} : { dueOn: task.dueOn }),
    ...(task.assigneeMemberId === undefined ? {} : { assignee: memberDisplay(members, task.assigneeMemberId) }),
    records: chipOrder(task.records, pageRecordId),
    recordCount: task.recordCount,
    ...(task.canChange ? {} : { readOnlyReason: strings.readOnly }),
  };
}

/**
 * A tab's count as its label carries it: the open tasks, and whether it is a
 * floor ("10,000+"). None at all shows no count: a "0" beside Tasks read as
 * though the record had no tasks, done ones included.
 */
export function tabCount(total: { readonly count: number; readonly atLeast: boolean } | undefined) {
  if (total === undefined || (total.count === 0 && !total.atLeast)) return {};
  return { count: total.count, countMax: 10_000, isCountAtLeast: total.atLeast };
}

/** Whether a `task` search param names a task (a uuid) or a new one. */
export function isTaskParam(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === 'new' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
  );
}
