// What a role lets someone do, as the role pickers show it (27 October 2026).
// The point of these is that the screens can never drift from what the server
// enforces, so they check the derivation rather than the words.
import { describe, expect, it } from 'vitest';
import { PERMISSION_NAMES, ROLE_PERMISSIONS } from './access.ts';
import { ROLES } from './roles.ts';
import { PERMISSION_AREAS, PERMISSION_POWERS, rolePowers, roleReach } from './role-powers.ts';

describe('what a role can do', () => {
  it('places every permission in exactly one area, and gives each one plain words', () => {
    // A permission added to the catalogue and nowhere else would silently never be shown.
    const placed = PERMISSION_AREAS.flatMap((area) => area.permissions);
    expect([...placed].sort()).toEqual([...PERMISSION_NAMES].sort());
    expect(placed.length).toBe(new Set(placed).size);
    expect(Object.keys(PERMISSION_POWERS).sort()).toEqual([...PERMISSION_NAMES].sort());
    // A power reads as something you can do, never as a refusal.
    for (const words of Object.values(PERMISSION_POWERS)) {
      expect(words).not.toMatch(/^Only |can’t/);
      expect(words.length).toBeGreaterThan(0);
    }
  });

  it('says what each role holds and what it does not, straight from ROLE_PERMISSIONS', () => {
    for (const role of ROLES) {
      const areas = rolePowers(role);
      const held = areas.flatMap((area) => area.held);
      expect(held.length).toBe(ROLE_PERMISSIONS[role].length);
      for (const area of areas) {
        expect(area.held.length + area.withheld.length).toBe(area.area.permissions.length);
        const standing = area.withheld.length === 0 ? 'all' : area.held.length === 0 ? 'none' : 'some';
        expect(area.standing).toBe(standing);
      }
    }
  });

  it('gives an owner everything, and a member the three powers they really hold', () => {
    expect(rolePowers('owner').every((area) => area.standing === 'all')).toBe(true);
    expect(roleReach('owner')).toEqual({ held: PERMISSION_NAMES.length, total: PERMISSION_NAMES.length });
    const member = rolePowers('member');
    expect(member.flatMap((area) => area.held)).toEqual([
      'Export records',
      'Make lists and pipelines',
      'Make booking pages',
      'Change their own hours',
    ]);
    // An admin stops short of the owner-only powers, so the two roles never read the same.
    expect(rolePowers('admin').flatMap((area) => area.withheld).length).toBeGreaterThan(0);
  });
});
