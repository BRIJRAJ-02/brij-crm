import type { MemberSummary, ShownThread } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { isThreadParam, toThreadItem } from './entries.ts';

const ADA = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const members = [{ id: ADA, name: 'Ada Lovelace', email: 'ada@example.com' }] as unknown as readonly MemberSummary[];

const thread: ShownThread = {
  id: THREAD,
  recordId: THREAD,
  resolvedAt: '2026-10-21T10:00:00.000Z',
  resolvedBy: { type: 'member', id: GONE },
  earlierCount: 0,
  comments: [
    {
      id: THREAD,
      threadId: THREAD,
      isDeleted: false,
      body: 'Hi',
      createdBy: { type: 'member', id: ADA },
      createdAt: '2026-10-21T09:00:00.000Z',
      version: 1,
      reactions: [{ emoji: '👍', count: 2, mine: true, memberIds: [ADA, GONE] }],
      canEdit: true,
      canDelete: true,
      isSending: true,
    },
  ],
};

describe('toThreadItem', () => {
  it('names authors, resolvers and who reacted from the members, a former member by the fallback', () => {
    const item = toThreadItem(thread, members);
    expect(item.resolvedBy?.name).toBe('Former member');
    expect(item.comments[0]?.author?.name).toBe('Ada Lovelace');
    expect(item.comments[0]?.reactions[0]?.names).toEqual(['Ada Lovelace', 'Former member']);
    expect(item.comments[0]?.isSending).toBe(true);
  });
});

describe('isThreadParam', () => {
  it('takes a uuid and drops anything else', () => {
    expect(isThreadParam(THREAD)).toBe(true);
    expect(isThreadParam('new')).toBe(false);
    expect(isThreadParam(undefined)).toBe(false);
  });
});
