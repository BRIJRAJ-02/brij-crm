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
 * What a stepping panel reads: the rows a list has drawn so far, by place.
 * Their ids are all it needs, so a list of `TaskEntry` (what the library draws)
 * and one of `TaskView` (what the store holds) both fit.
 */
export interface TaskRows {
  readonly count: number;
  readonly getItem: (index: number) => { readonly id: string } | undefined;
}

/**
 * The tasks either side of `taskId` in the list the panel was opened from, as
 * the record panel steps through its view. Either is undefined at that end of
 * the list, for a task the list doesn't hold (it was deleted, or the panel was
 * opened from the inbox), and where the neighbour's page hasn't been read yet,
 * so the step's button is disabled rather than going nowhere. It walks the
 * drawn rows once and never asks for a page, so stepping loads nothing;
 * callers memoise it, since a windowed list republishes as patches arrive.
 */
export function stepTask(rows: TaskRows, taskId: string): { readonly previous?: string; readonly next?: string } {
  for (let index = 0; index < rows.count; index += 1) {
    if (rows.getItem(index)?.id !== taskId) continue;
    const previous = index > 0 ? rows.getItem(index - 1)?.id : undefined;
    const next = index + 1 < rows.count ? rows.getItem(index + 1)?.id : undefined;
    return {
      ...(previous === undefined ? {} : { previous }),
      ...(next === undefined ? {} : { next }),
    };
  }
  return {};
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
