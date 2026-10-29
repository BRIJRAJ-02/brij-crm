// `members.visible`'s answer, pure (spec 0037, AC-1255, AC-1261): Manage over a colleague, and whether that reaches
// their hours, which a delegation the member granted themself never does while their hours are set by others.
import { describe, expect, it } from 'vitest';
import type { SchedulingReach } from '../access/scheduling.ts';
import { visibleOf } from './visible.ts';

const ME = '0190f0f0-0000-7000-8000-000000000001';
const BEA = '0190f0f0-0000-7000-8000-000000000002';
const CY = '0190f0f0-0000-7000-8000-000000000003';
const OWEN = '0190f0f0-0000-7000-8000-000000000004';

const rows = [
  { id: ME, name: 'Ada' },
  { id: BEA, name: 'Bea' },
  { id: CY, name: 'Cy' },
  { id: OWEN, name: 'Owen' },
];

describe('visibleOf', () => {
  it('names only whom the caller may See, with Manage and hours apart (AC-1255)', () => {
    const reach: SchedulingReach = {
      self: ME,
      all: undefined,
      members: new Map([
        [BEA, 'manage'],
        [CY, 'view'],
      ]),
      // Bea's Manage comes from her own grant while her hours are set by others.
      hoursSeenOnly: new Set([BEA]),
    };
    expect(visibleOf(rows, reach, ME, true)).toEqual([
      { id: ME, name: 'Ada', canManage: true, canChangeHours: true },
      { id: BEA, name: 'Bea', canManage: true, canChangeHours: false },
      { id: CY, name: 'Cy', canManage: false, canChangeHours: false },
    ]);
  });

  it('lets a manager over everyone change hours, and the caller theirs only with availability.own (AC-1260)', () => {
    const reach: SchedulingReach = { self: ME, all: 'manage', members: new Map(), hoursSeenOnly: new Set([BEA]) };
    const answer = visibleOf(rows, reach, ME, false);
    expect(answer.find((each) => each.id === ME)).toMatchObject({ canManage: true, canChangeHours: false });
    expect(answer.find((each) => each.id === BEA)).toMatchObject({ canManage: true, canChangeHours: true });
  });
});
