import { describe, expect, it } from 'vitest';
import { summarizeAccess, type SummaryInput } from './access-summary.ts';

const DEFAULT: SummaryInput['role'] = { level: 'write', records: 'all', isDefault: true };

describe('the access summary', () => {
  it('says everyone edits while the Member role is at its default, whatever teams hold', () => {
    expect(summarizeAccess({ object: 'Deals', role: DEFAULT, teams: [] })).toBe('Everyone can edit Deals.');
    expect(
      summarizeAccess({ object: 'Deals', role: DEFAULT, teams: [{ name: 'Sales', level: 'read', records: 'own' }] }),
    ).toBe('Everyone can edit Deals.');
  });

  it('says what the Member role can do, with its record scope', () => {
    const role = (level: 'none' | 'read' | 'write', records: 'all' | 'own' | 'team') => ({
      level,
      records,
      isDefault: false,
    });
    expect(summarizeAccess({ object: 'Deals', role: role('read', 'all'), teams: [] })).toBe('Members can view Deals.');
    expect(summarizeAccess({ object: 'Deals', role: role('write', 'own'), teams: [] })).toBe(
      'Members can edit their own deals.',
    );
    expect(summarizeAccess({ object: 'Deals', role: role('write', 'team'), teams: [] })).toBe(
      'Members can edit their team’s deals.',
    );
    expect(summarizeAccess({ object: 'Deals', role: role('none', 'all'), teams: [] })).toBe('Members can’t see Deals.');
  });

  it('names the teams that grant what members lack, and the members who still can’t see', () => {
    const none = { level: 'none', records: 'all', isDefault: false } as const;
    expect(
      summarizeAccess({ object: 'Deals', role: none, teams: [{ name: 'Sales', level: 'write', records: 'all' }] }),
    ).toBe('Sales can edit Deals. Other members can’t see them.');
    expect(
      summarizeAccess({
        object: 'Deals',
        role: none,
        teams: [
          { name: 'Sales', level: 'write', records: 'all' },
          { name: 'Support', level: 'write', records: 'all' },
          { name: 'Finance', level: 'read', records: 'all' },
        ],
      }),
    ).toBe('Sales and Support can edit Deals. Finance can view Deals. Other members can’t see them.');
  });

  it('leaves out a team that adds nothing to the role', () => {
    const view = { level: 'read', records: 'all', isDefault: false } as const;
    expect(
      summarizeAccess({
        object: 'Deals',
        role: view,
        teams: [
          { name: 'Support', level: 'read', records: 'all' },
          { name: 'Ops', level: 'none', records: 'all' },
          { name: 'Sales', level: 'write', records: 'own' },
        ],
      }),
    ).toBe('Members can view Deals. Sales can edit their own deals.');
    // A team that sees more records than the role's own scope adds that.
    expect(
      summarizeAccess({
        object: 'Deals',
        role: { level: 'write', records: 'own', isDefault: false },
        teams: [{ name: 'Leads', level: 'write', records: 'all' }],
      }),
    ).toBe('Members can edit their own deals. Leads can edit Deals.');
  });
});
