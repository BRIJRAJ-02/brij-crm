// Tasks as the library draws them (spec 0019, value sourcing): plain
// functions with no React, so they test in Node. A task's assignee is named
// from the members ("Former member" for one no longer active), the record
// chips on a record's own page leave that record out (its other records still
// show), and a task the reader may not change says why.
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
 * The records a task's chips show: on a record's own page, its other records only (the page's own chip on every
 * row said nothing, owner 31 October 2026, so a task linked to that record alone shows no chip); elsewhere, every
 * record in link order.
 */
export function chipRecords(records: readonly RecordRefDisplay[], pageRecordId?: string): readonly RecordRefDisplay[] {
  return pageRecordId === undefined ? records : records.filter((record) => record.recordId !== pageRecordId);
}

/** A task as TaskList's entry. */
export function toTaskEntry(task: TaskView, members: readonly MemberSummary[], pageRecordId?: string): TaskEntry {
  return {
    id: task.id,
    title: task.title,
    isDone: task.isDone,
    ...(task.dueOn === undefined ? {} : { dueOn: task.dueOn }),
    ...(task.assigneeMemberId === undefined ? {} : { assignee: memberDisplay(members, task.assigneeMemberId) }),
    records: chipRecords(task.records, pageRecordId),
    // Less the page's own, when the task links it.
    recordCount:
      pageRecordId !== undefined && task.records.some((record) => record.recordId === pageRecordId)
        ? task.recordCount - 1
        : task.recordCount,
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
