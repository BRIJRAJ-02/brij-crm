import { describe, expect, it } from 'vitest';
import { CreateTaskInput, ListTasksInput, TaskCursor, TASK_RECORDS_MAX, UpdateTaskInput } from './tasks.ts';

const workspace = 'acme';
const id = '0199d6a4-0000-7000-8000-000000000001';
const mutationId = '0199d6a4-0000-7000-8000-000000000002';
const recordId = (n: number) => `0199d6a4-0000-7000-8000-${String(n).padStart(12, '0')}`;

describe('tasks contract (spec 0019)', () => {
  it('trims a title and refuses one empty after trimming or over 2,000 characters', () => {
    expect(CreateTaskInput.parse({ workspace, id, title: '  Call back  ', mutationId }).title).toBe('Call back');
    expect(CreateTaskInput.safeParse({ workspace, id, title: '   ', mutationId }).success).toBe(false);
    expect(CreateTaskInput.safeParse({ workspace, id, title: 'x'.repeat(2_000), mutationId }).success).toBe(true);
    expect(CreateTaskInput.safeParse({ workspace, id, title: 'x'.repeat(2_001), mutationId }).success).toBe(false);
  });

  it('takes a UUID v7 id only, and at most 20 linked records, each once', () => {
    const v4 = '0199d6a4-0000-4000-8000-000000000001';
    expect(CreateTaskInput.safeParse({ workspace, id: v4, title: 'A', mutationId }).success).toBe(false);
    const many = Array.from({ length: TASK_RECORDS_MAX + 1 }, (_, n) => recordId(n + 10));
    expect(CreateTaskInput.safeParse({ workspace, id, title: 'A', recordIds: many, mutationId }).success).toBe(false);
    expect(
      CreateTaskInput.safeParse({ workspace, id, title: 'A', recordIds: many.slice(0, TASK_RECORDS_MAX), mutationId })
        .success,
    ).toBe(true);
    const twice = [recordId(1), recordId(1)];
    expect(CreateTaskInput.safeParse({ workspace, id, title: 'A', recordIds: twice, mutationId }).success).toBe(false);
  });

  it('clears a due date or an assignee with null, and leaves out what it was not given', () => {
    const parsed = UpdateTaskInput.parse({ workspace, taskId: id, dueOn: null, assigneeMemberId: null, mutationId });
    expect(parsed).toEqual({ workspace, taskId: id, dueOn: null, assigneeMemberId: null, mutationId });
    expect(UpdateTaskInput.safeParse({ workspace, taskId: id, dueOn: '2026-02-30', mutationId }).success).toBe(false);
  });

  it('lists by record only, with strict cursors', () => {
    expect(ListTasksInput.safeParse({ workspace, scope: { recordId: id }, status: 'open' }).success).toBe(true);
    expect(ListTasksInput.safeParse({ workspace, scope: { recordId: id, extra: 1 }, status: 'open' }).success).toBe(
      false,
    );
    expect(TaskCursor.safeParse({ status: 'open', dueOn: null, createdAt: 'x', id }).success).toBe(true);
    expect(TaskCursor.safeParse({ status: 'done', doneAt: 'x', id, more: 1 }).success).toBe(false);
  });
});
