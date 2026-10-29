import type { DelegationView } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { heldBy, overMe, reachWords, sourceOf, whoseOf } from './scheduling-access.ts';

const ME = 'me';
const NAMES: Record<string, string> = { me: 'Ada', bea: 'Bea', sam: 'Sam', kim: 'Kim', priya: 'Priya' };
const nameOf = (id: string) => NAMES[id];

const grant = (
  delegate: string,
  target: string,
  level: 'view' | 'manage',
  extra: Partial<DelegationView> = {},
): DelegationView => ({
  id: `${delegate}-${target}`,
  delegateMemberId: delegate,
  target: target === 'everyone' ? { type: 'everyone' } : { type: 'member', memberId: target },
  level,
  grantedBySelf: false,
  createdAt: '2026-10-29T10:00:00.000Z',
  ...extra,
});

describe('which rows belong where', () => {
  it('splits the delegations over me from the ones I hold', () => {
    const all = [grant('priya', ME, 'manage'), grant(ME, 'bea', 'view'), grant('sam', 'bea', 'view')];
    expect(overMe(all, ME).map((each) => each.id)).toEqual(['priya-me']);
    expect(heldBy(all, ME).map((each) => each.id)).toEqual(['me-bea']);
  });
});

describe('a row’s source', () => {
  it('says who added it', () => {
    expect(sourceOf(grant('priya', ME, 'view', { grantedBySelf: true, grantedBy: ME }), ME, nameOf)).toBe('You added');
    expect(sourceOf(grant(ME, 'bea', 'view', { grantedBySelf: true }), ME, nameOf)).toBe('Bea added');
    expect(sourceOf(grant(ME, 'everyone', 'view', { grantedBy: 'kim' }), ME, nameOf)).toBe('Kim added');
    expect(sourceOf(grant(ME, 'everyone', 'view', { grantedBy: 'gone' }), ME, nameOf)).toBe('Added by an admin');
  });

  it('names whose scheduling', () => {
    expect(whoseOf({ type: 'member', memberId: 'bea' }, nameOf)).toBe('Bea’s');
    expect(whoseOf({ type: 'everyone' }, nameOf)).toBe('everyone’s');
  });
});

describe('a member’s reach in words (AC-1267)', () => {
  it('reads Everyone for owners and admins, and Only their own with nothing held', () => {
    expect(reachWords('admin', [], nameOf)).toBe('Everyone');
    expect(reachWords('member', [], nameOf)).toBe('Only their own');
  });

  it('names up to two people, then counts the rest', () => {
    expect(reachWords('member', [grant('x', 'sam', 'manage'), grant('x', 'bea', 'manage')], nameOf)).toBe(
      'Sam and Bea',
    );
    expect(
      reachWords(
        'member',
        [grant('x', 'sam', 'manage'), grant('x', 'bea', 'manage'), grant('x', 'kim', 'manage')],
        nameOf,
      ),
    ).toBe('Sam, Bea and 1 more');
  });

  it('puts what See reaches further in brackets, and See alone on its own', () => {
    expect(reachWords('member', [grant('x', 'sam', 'manage'), grant('x', 'everyone', 'view')], nameOf)).toBe(
      'Sam (sees everyone)',
    );
    expect(reachWords('member', [grant('x', 'bea', 'view')], nameOf)).toBe('Sees Bea');
    expect(reachWords('member', [grant('x', 'everyone', 'manage'), grant('x', 'bea', 'view')], nameOf)).toBe(
      'Everyone',
    );
  });
});
