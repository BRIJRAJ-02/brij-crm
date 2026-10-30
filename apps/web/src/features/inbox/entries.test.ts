import type { NotificationView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { targetOf } from './entries.ts';
import { inboxSearch, notificationKind } from './search.ts';

const ID = '11111111-1111-4111-8111-111111111111';
const OBJECT = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const slugs = new Map([[OBJECT, 'companies']]);

const mention: NotificationView = {
  id: ID,
  kind: 'mention',
  actor: { type: 'member', id: ID },
  createdAt: '2026-10-21T09:00:00.000Z',
  record: { objectId: OBJECT, recordId: ID, name: 'Acme', kind: 'company' },
  threadId: THREAD,
  excerpt: 'Hi',
};

describe('inboxSearch', () => {
  it('keeps only what it knows, and never a new task', () => {
    expect(inboxSearch({ status: 'done', kind: 'mentions', unread: '1', task: ID })).toEqual({
      status: 'done',
      kind: 'mentions',
      unread: 1,
      task: ID,
    });
    expect(inboxSearch({ status: 'inbox', kind: 'mention', unread: 'yes', task: 'new' })).toEqual({});
  });

  it('maps the address kind to the data layer kind', () => {
    expect(notificationKind('assignments')).toBe('task_assigned');
    expect(notificationKind('submissions')).toBe('form_submission');
    expect(notificationKind(undefined)).toBeUndefined();
  });
});

describe('targetOf', () => {
  it('opens a comment on its record’s Comments tab at its thread', () => {
    expect(targetOf('acme', mention, slugs)).toEqual({
      kind: 'href',
      href: `/w/acme/objects/companies/${ID}/comments?thread=${THREAD}`,
    });
  });

  it('opens a note mention in its note window on the record’s Notes tab', () => {
    const { threadId: _thread, ...rest } = mention;
    expect(targetOf('acme', { ...rest, noteId: THREAD }, slugs)).toEqual({
      kind: 'href',
      href: `/w/acme/objects/companies/${ID}/notes?note=${THREAD}`,
    });
  });

  it('opens an assignment’s task, and nothing for a record whose object is unknown', () => {
    expect(targetOf('acme', { ...mention, kind: 'task_assigned', taskId: ID }, slugs)).toEqual({
      kind: 'task',
      taskId: ID,
    });
    expect(targetOf('acme', mention, new Map())).toBeUndefined();
  });

  it('opens a new submission on its form’s Submissions tab, even with no record', () => {
    const { record: _record, threadId: _thread, ...rest } = mention;
    expect(
      targetOf('acme', { ...rest, kind: 'form_submission', submissionId: THREAD, formId: OBJECT, excerpt: '' }, slugs),
    ).toEqual({ kind: 'href', href: `/w/acme/captures/forms/${OBJECT}?tab=submissions&submission=${THREAD}` });
  });
});
