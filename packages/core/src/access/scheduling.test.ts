// Whose scheduling a caller reaches (spec 0037, AC-1258, AC-1270): `canActFor` over the grid of levels, as pure
// checks, and the reach spec 0035 gives today (everyone for booking.admin, else only oneself).
import { describe, expect, it } from 'vitest';
import { canActFor, type SchedulingReach } from './scheduling.ts';

const ME = '0190f0f0-0000-7000-8000-000000000001';
const BEA = '0190f0f0-0000-7000-8000-000000000002';
const CY = '0190f0f0-0000-7000-8000-000000000003';

const reach = (all: SchedulingReach['all'], members: Record<string, 'view' | 'manage'> = {}): SchedulingReach => ({
  self: ME,
  all,
  members: new Map(Object.entries(members)),
});

describe('canActFor', () => {
  it('always reaches yourself, at both levels, whatever else the reach says', () => {
    expect(canActFor(reach(undefined), ME, 'view')).toBe(true);
    expect(canActFor(reach(undefined), ME, 'manage')).toBe(true);
  });

  it('reaches everyone at the level everyone is reached, Manage covering See', () => {
    expect(canActFor(reach('manage'), BEA, 'manage')).toBe(true);
    expect(canActFor(reach('view'), BEA, 'view')).toBe(true);
    expect(canActFor(reach('view'), BEA, 'manage')).toBe(false);
  });

  it('reaches a named member at their own level, and nobody unnamed', () => {
    const named = reach(undefined, { [BEA]: 'view', [CY]: 'manage' });
    expect(canActFor(named, BEA, 'view')).toBe(true);
    expect(canActFor(named, BEA, 'manage')).toBe(false);
    expect(canActFor(named, CY, 'manage')).toBe(true);
    expect(canActFor(named, '0190f0f0-0000-7000-8000-000000000009', 'view')).toBe(false);
  });

  it('keeps the higher of everyone and a member’s own level', () => {
    expect(canActFor(reach('view', { [BEA]: 'manage' }), BEA, 'manage')).toBe(true);
    expect(canActFor(reach('manage', { [BEA]: 'view' }), BEA, 'manage')).toBe(true);
  });

  it('reaches nobody but yourself without any reach, and nobody at all with no self', () => {
    expect(canActFor(reach(undefined), BEA, 'view')).toBe(false);
    expect(canActFor({ self: undefined, all: undefined, members: new Map() }, ME, 'view')).toBe(false);
  });
});
