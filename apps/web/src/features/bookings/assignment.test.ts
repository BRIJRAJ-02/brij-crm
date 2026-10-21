// The detail's assignment line (spec 0029, AC-742).
import type { BookingAssignment } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { assignedItems, assignmentLine } from './assignment.ts';

const ROW: BookingAssignment = {
  id: '00000000-0000-4000-8000-000000000001',
  rotationId: '00000000-0000-4000-8000-000000000002',
  rotationName: 'Sales',
  memberId: '00000000-0000-4000-8000-000000000003',
  memberName: 'Sam Lee',
  reason: 'fair',
  count: 4,
  weight: 100,
  windowDays: 30,
  assignedAt: '2026-10-21T09:00:00.000Z',
};

describe('assignmentLine', () => {
  it('names the counts and weight a fair pick compared', () => {
    expect(assignmentLine(ROW, 'en-GB')).toBe('Sam Lee had the fewest meetings in the last 30 days: 4, at weight 100');
  });

  it('falls back to plain words when the counts are missing', () => {
    const { count: _count, ...row } = ROW;
    expect(assignmentLine(row, 'en-GB')).toBe('Sam Lee had the fewest meetings lately');
  });

  it('says other reasons plainly, and that a voided row no longer counts', () => {
    expect(assignmentLine({ ...ROW, reason: 'last_host' }, 'en-GB')).toBe('Sam Lee hosted this person last time');
    expect(assignmentLine({ ...ROW, reason: 'only_free', voidedAt: '2026-10-21T10:00:00.000Z' }, 'en-GB')).toBe(
      'Sam Lee was the only one free then (no longer counts)',
    );
  });

  it('gives each rotation its newest row, one line each', () => {
    const older = { ...ROW, id: '00000000-0000-4000-8000-000000000009', reason: 'manual' as const };
    const other = { ...ROW, rotationId: '00000000-0000-4000-8000-000000000008', rotationName: 'Support' };
    expect(assignedItems([ROW, older, other], 'en-GB').map((item) => item.term)).toStrictEqual([
      'Assigned in Sales',
      'Assigned in Support',
    ]);
  });
});
