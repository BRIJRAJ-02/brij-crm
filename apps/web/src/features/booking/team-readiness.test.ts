import type { RotationView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { followsEveryone, hasNoHostsOn, teamOnPage } from './team-readiness.ts';

const member = (memberId: string, isOn: boolean) => ({ memberId, isOn }) as RotationView['members'][number];
const group = (id: string, members: RotationView['members']) => ({ id, members });

describe('teamOnPage', () => {
  it('counts each person once, across fixed hosts and whoever is on in the groups', () => {
    const page = { hosts: { fixed: ['ada'], rotations: ['sales', 'support'] } };
    const seen = teamOnPage(page, [
      group('sales', [member('ada', true), member('bea', true), member('cy', false)]),
      group('support', [member('bea', true)]),
    ]);
    expect(seen.onCount).toBe(2);
    expect(seen.isPartial).toBe(false);
  });

  it('says when it can’t see a group on the page', () => {
    expect(teamOnPage({ hosts: { fixed: [], rotations: ['hidden'] } }, []).isPartial).toBe(true);
  });
});

describe('hasNoHostsOn', () => {
  const page = { kind: 'round_robin' as const, hosts: { fixed: [], rotations: ['sales'] } };

  it('is true when everyone in the group is switched off', () => {
    expect(hasNoHostsOn(page, [group('sales', [member('ada', false)])])).toBe(true);
  });

  it('is false with anyone on, or a fixed host', () => {
    expect(hasNoHostsOn(page, [group('sales', [member('ada', true)])])).toBe(false);
    expect(hasNoHostsOn({ ...page, hosts: { fixed: ['ada'], rotations: ['sales'] } }, [group('sales', [])])).toBe(
      false,
    );
  });

  it('never calls an unknown a fault: groups not read yet, or a group the reader can’t see', () => {
    expect(hasNoHostsOn(page, undefined)).toBe(false);
    expect(hasNoHostsOn(page, [])).toBe(false);
  });

  it('never says it to someone who can’t read the hosts', () => {
    expect(hasNoHostsOn({ kind: 'round_robin', hosts: undefined }, [])).toBe(false);
  });

  it('is false on a personal page', () => {
    expect(hasNoHostsOn({ kind: 'personal', hosts: undefined }, [])).toBe(false);
  });
});

describe('followsEveryone', () => {
  const roster = { id: 'all', follows: 'everyone' as const };
  const sales = { id: 'sales' };

  it('is the workspace link only while it books the roster and nothing else', () => {
    const page = { scope: 'workspace' as const, hosts: { fixed: [], rotations: ['all'] } };
    expect(followsEveryone(page, [roster, sales] as RotationView[])).toBe(true);
    expect(
      followsEveryone({ ...page, hosts: { fixed: ['ada'], rotations: ['all'] } }, [roster] as RotationView[]),
    ).toBe(false);
    expect(
      followsEveryone({ ...page, hosts: { fixed: [], rotations: ['sales'] } }, [roster, sales] as RotationView[]),
    ).toBe(false);
  });

  it('treats a workspace page as the link for a member, who reads no hosts', () => {
    expect(followsEveryone({ scope: 'workspace', hosts: undefined }, [])).toBe(true);
  });

  it('is false for a member’s own page', () => {
    expect(
      followsEveryone({ scope: 'member', hosts: { fixed: [], rotations: ['all'] } }, [roster] as RotationView[]),
    ).toBe(false);
  });
});
