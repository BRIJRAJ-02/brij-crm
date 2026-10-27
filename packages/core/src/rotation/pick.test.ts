// Who gets the next assignment (spec 0029, AC-738, AC-739), and how team
// slots combine (AC-734, AC-735): pure, so every order and edge is checked on
// its own, DST days and members in different zones included.
import { describe, expect, it } from 'vitest';
import { defaultAvailability } from '@crm/contracts';
import type { PageRecord } from '../booking/slots.ts';
import { intersectSlots, unionSlots } from './combine.ts';
import { evenWaiting, fillSeats, hallHolds, loadOf, pickMember, rankCandidates, type Candidate } from './pick.ts';
import { memberSlots, teamSlots, underCaps, type TeamReads } from './team.ts';

const member = (memberId: string, over: Partial<Candidate> = {}): Candidate => ({
  memberId,
  count: 0,
  calibration: 0,
  weight: 100,
  priority: 2,
  ...over,
});

const FAIR = { strategy: 'fair', returning: 'owner' } as const;

describe('pickMember (AC-738, AC-739)', () => {
  it('Fair takes the lowest count for the weight, calibration included', () => {
    const picked = pickMember([member('a', { count: 4 }), member('b', { count: 2 }), member('c', { count: 3 })], FAIR);
    expect(picked).toMatchObject({ memberId: 'b', reason: 'fair' });
    // A member at weight 50 with 2 carries the load of one at 100 with 4.
    expect(loadOf(member('h', { count: 2, weight: 50 }))).toBe(loadOf(member('f', { count: 4 })));
    expect(pickMember([member('a', { count: 1, calibration: 3 }), member('b', { count: 3 })], FAIR)?.memberId).toBe(
      'b',
    );
    expect(pickMember([member('a', { count: 3, weight: 50 }), member('b', { count: 5 })], FAIR)?.memberId).toBe('b');
  });

  it('breaks a tie by priority, then the longest since their last assignment (never first), then id', () => {
    expect(pickMember([member('a'), member('b', { priority: 3 })], FAIR)?.memberId).toBe('b');
    const earlier = new Date('2026-10-01T00:00:00Z');
    const later = new Date('2026-10-02T00:00:00Z');
    expect(
      pickMember([member('a', { lastAssignedAt: later }), member('b', { lastAssignedAt: earlier })], FAIR)?.memberId,
    ).toBe('b');
    expect(pickMember([member('a', { lastAssignedAt: earlier }), member('b')], FAIR)?.memberId).toBe('b');
    expect(pickMember([member('b'), member('a')], FAIR)?.memberId).toBe('a');
  });

  it('Priority takes the highest priority first, then Fair’s order', () => {
    const rules = { strategy: 'priority', returning: 'none' } as const;
    const picked = pickMember([member('a', { count: 0 }), member('b', { count: 9, priority: 4 })], rules);
    expect(picked).toMatchObject({ memberId: 'b', reason: 'priority' });
    expect(
      rankCandidates([member('a', { count: 2 }), member('b', { count: 1 })], 'priority').map((c) => c.memberId),
    ).toEqual(['b', 'a']);
  });

  it('sends a known visitor to their free owner whatever the counts, and only when it is on', () => {
    const pool = [member('a'), member('owner', { count: 12 })];
    expect(pickMember(pool, FAIR, { ownerId: 'owner' })).toMatchObject({ memberId: 'owner', reason: 'owner' });
    expect(pickMember(pool, { ...FAIR, returning: 'none' }, { ownerId: 'owner' })?.memberId).toBe('a');
    // An owner who isn't free (not a candidate) changes nothing.
    expect(pickMember([member('a'), member('b', { count: 1 })], FAIR, { ownerId: 'owner' })?.memberId).toBe('a');
  });

  it('says only_free for one candidate, nothing for none, and records everyone compared', () => {
    expect(pickMember([member('a', { count: 2, calibration: 1 })], FAIR)).toEqual({
      memberId: 'a',
      reason: 'only_free',
      detail: { strategy: 'fair', compared: [{ memberId: 'a', count: 3, weight: 100, priority: 2 }] },
    });
    expect(pickMember([], FAIR)).toBeUndefined();
  });
});

const at = (iso: string) => new Date(iso);
const span = (start: string, end: string) => ({ start: at(start), end: at(end) });

describe('unionSlots and intersectSlots (AC-734, AC-735)', () => {
  const perMember = new Map([
    ['a', [span('2026-11-02T09:00:00Z', '2026-11-02T09:30:00Z'), span('2026-11-02T10:00:00Z', '2026-11-02T10:30:00Z')]],
    ['b', [span('2026-11-02T09:00:00Z', '2026-11-02T09:30:00Z'), span('2026-11-02T11:00:00Z', '2026-11-02T11:30:00Z')]],
  ]);

  it('offers every time someone is free, each with who is free, chronological', () => {
    expect(unionSlots(perMember).map((slot) => [slot.start.toISOString(), slot.memberIds])).toEqual([
      ['2026-11-02T09:00:00.000Z', ['a', 'b']],
      ['2026-11-02T10:00:00.000Z', ['a']],
      ['2026-11-02T11:00:00.000Z', ['b']],
    ]);
  });

  it('offers only what every required member is free for; a required member with nothing closes it', () => {
    expect(intersectSlots(perMember, ['a', 'b']).map((slot) => slot.start.toISOString())).toEqual([
      '2026-11-02T09:00:00.000Z',
    ]);
    expect(intersectSlots(perMember, ['a', 'b', 'c'])).toEqual([]);
    expect(intersectSlots(perMember, [])).toEqual([]);
  });

  it('never merges two lengths that start together', () => {
    const mixed = new Map([
      ['a', [span('2026-11-02T09:00:00Z', '2026-11-02T09:30:00Z')]],
      ['b', [span('2026-11-02T09:00:00Z', '2026-11-02T10:00:00Z')]],
    ]);
    expect(unionSlots(mixed)).toHaveLength(2);
  });
});

/** A team page as the engine reads it: 60 minute slots, no buffers or notice. */
function teamPage(over: Partial<PageRecord> = {}): PageRecord {
  return {
    id: 'page',
    workspaceId: 'workspace',
    publicKey: 'aaaaaaaaaaaaaaaa',
    kind: 'round_robin',
    ownerMemberId: 'a',
    ownerUserId: null,
    title: 'Team',
    description: '',
    slug: 'team',
    durations: [60],
    location: { type: 'video' },
    availability: defaultAvailability('UTC'),
    bufferBefore: 0,
    bufferAfter: 0,
    minNoticeMinutes: 0,
    windowDays: 60,
    dailyLimit: null,
    slotStep: null,
    status: 'live',
    rescheduleHost: 'same',
    defaultView: 'month',
    scheduleId: null,
    scheduleName: 'Working hours',
    fallbackZone: 'UTC',
    isDeleted: false,
    isPrivate: false,
    showSocials: true,
    questions: [],
    fileToCrm: true,
    answersObjectId: null,
    profileSection: null,
    profilePosition: 0,
    createdAt: at('2026-10-01T00:00:00Z'),
    updatedAt: at('2026-10-01T00:00:00Z'),
    ...over,
  };
}

const NOW = at('2026-10-20T00:00:00Z');
const busyNone = { busy: [], blocked: false, noCalendar: true };

describe('team slots by each member’s own hours (AC-734 to AC-736)', () => {
  // Sunday 1 November 2026: New York leaves daylight time at 02:00 local. Monday 2 November is the first EST day.
  const reads = (blocked: readonly string[] = []): TeamReads => ({
    hours: new Map([
      ['a', defaultAvailability('America/New_York')],
      ['b', defaultAvailability('Europe/London')],
    ]),
    busy: new Map([
      ['a', { ...busyNone, blocked: blocked.includes('a') }],
      ['b', { ...busyNone, blocked: blocked.includes('b') }],
    ]),
    zones: new Map([
      ['a', 'America/New_York'],
      ['b', 'Europe/London'],
    ]),
    bookings: new Map(),
    closed: new Map(),
    standing: new Map(),
  });
  const range = { duration: 60, from: at('2026-11-02T00:00:00Z'), to: at('2026-11-03T00:00:00Z'), now: NOW };
  const rules = { id: 'r', name: 'Sales', strategy: 'fair', evenGap: 3, windowDays: 30, returning: 'owner' } as const;
  const team = {
    kind: 'round_robin' as const,
    fixed: [],
    rotations: [
      {
        rules,
        members: ['a', 'b'].map((memberId) => ({
          memberId,
          weight: 100,
          priority: 2,
          dailyCap: null,
          weeklyCap: null,
          calibration: 0,
        })),
      },
    ],
  };

  it('runs the engine in each member’s zone across the DST change, and unions them', () => {
    // New York 09:00 to 17:00 EST is 14:00 to 22:00 UTC (EDT would have been 13:00); London 09:00 to 17:00 GMT.
    expect(memberSlots(teamPage(), 'a', reads(), range).map((slot) => slot.start.toISOString().slice(11, 16))).toEqual([
      '14:00',
      '15:00',
      '16:00',
      '17:00',
      '18:00',
      '19:00',
      '20:00',
      '21:00',
    ]);
    const found = teamSlots(teamPage(), team, reads(), range);
    expect(found.blocked).toBe(false);
    expect(found.slots.map((slot) => [slot.start.toISOString().slice(11, 16), slot.candidates[0]?.join('')])).toEqual([
      ['09:00', 'b'],
      ['10:00', 'b'],
      ['11:00', 'b'],
      ['12:00', 'b'],
      ['13:00', 'b'],
      ['14:00', 'ab'],
      ['15:00', 'ab'],
      ['16:00', 'ab'],
      ['17:00', 'a'],
      ['18:00', 'a'],
      ['19:00', 'a'],
      ['20:00', 'a'],
      ['21:00', 'a'],
    ]);
  });

  it('leaves a blocked member out of the union, and closes only when everyone is blocked (AC-736)', () => {
    const one = teamSlots(teamPage(), team, reads(['a']), range);
    expect(one.blocked).toBe(false);
    expect(one.slots.every((slot) => slot.candidates[0]?.join('') === 'b')).toBe(true);
    expect(teamSlots(teamPage(), team, reads(['a', 'b']), range)).toEqual({ slots: [], blocked: true });
  });

  it('intersects a collective page, closed when any required member is blocked (AC-735, AC-736)', () => {
    const collective = { kind: 'collective' as const, required: ['a', 'b'] };
    const found = teamSlots(teamPage({ kind: 'collective' }), collective, reads(), range);
    expect(found.slots.map((slot) => slot.start.toISOString().slice(11, 16))).toEqual(['14:00', '15:00', '16:00']);
    expect(teamSlots(teamPage({ kind: 'collective' }), collective, reads(['b']), range)).toEqual({
      slots: [],
      blocked: true,
    });
  });
});

describe('Even, returning guests, and seats (spec 0037, AC-1320, AC-1321, AC-1325, AC-1328)', () => {
  it('holds back anyone the gap or more ahead of the lowest, by weight', () => {
    const pool = [member('a', { count: 3 }), member('b', { count: 1 }), member('c', { count: 0 })];
    expect([...evenWaiting(pool, 3)]).toEqual(['a']);
    expect([...evenWaiting(pool, 4)]).toEqual([]);
    // At weight 50, 2 meetings weigh as 4.
    expect([...evenWaiting([member('h', { count: 2, weight: 50 }), member('f')], 3)]).toEqual(['h']);
    expect(pickMember([member('b', { count: 1 }), member('c')], { strategy: 'even', returning: 'none' })).toMatchObject(
      {
        memberId: 'c',
        reason: 'even',
      },
    );
  });

  it('sends a returning guest to the host they met last, when that is the rule and they are free', () => {
    const rules = { strategy: 'fair', returning: 'last_host' } as const;
    const pool = [member('a'), member('met', { count: 9 })];
    expect(pickMember(pool, rules, { ownerId: 'a', lastHostId: 'met' })).toMatchObject({
      memberId: 'met',
      reason: 'last_host',
    });
    expect(pickMember([member('a')], rules, { lastHostId: 'gone' })?.reason).toBe('only_free');
  });

  it('checks Hall’s condition exactly for up to three rotations', () => {
    expect(hallHolds([['a'], ['b'], ['c']])).toBe(true);
    expect(hallHolds([['a'], ['a', 'b']])).toBe(true);
    expect(hallHolds([['a'], ['a']])).toBe(false);
    expect(
      hallHolds([
        ['a', 'b'],
        ['a', 'b'],
        ['a', 'b'],
      ]),
    ).toBe(false);
    expect(hallHolds([[], ['a']])).toBe(false);
    expect(hallHolds([])).toBe(true);
  });

  it('never gives one person two seats, and leaves a later rotation someone', () => {
    const rules = { strategy: 'fair', returning: 'none' } as const;
    // Sam is fairest in both rotations, but Solutions has only Sam: Sales must take Kim.
    const picks = fillSeats([
      { rotationId: 'sales', rules, candidates: [member('sam'), member('kim', { count: 5 })] },
      { rotationId: 'solutions', rules, candidates: [member('sam')] },
    ]);
    expect(picks?.map((pick) => [pick.rotationId, pick.memberId])).toEqual([
      ['sales', 'kim'],
      ['solutions', 'sam'],
    ]);
    expect(
      fillSeats([
        { rotationId: 'x', rules, candidates: [member('a')] },
        { rotationId: 'y', rules, candidates: [member('a')] },
      ]),
    ).toBeUndefined();
  });

  it('counts the daily and weekly caps in the member’s own zone, weeks from Monday', () => {
    const capped = { memberId: 'a', weight: 100, priority: 2, dailyCap: 2, weeklyCap: 3, calibration: 0 };
    const tokyo = 'Asia/Tokyo';
    // Monday 2 November in Tokyo: two meetings already that local day (one is still Sunday in UTC).
    const starts = [at('2026-11-01T23:30:00Z'), at('2026-11-02T03:00:00Z')];
    expect(underCaps(capped, starts, tokyo, at('2026-11-02T05:00:00Z'))).toBe(false);
    expect(underCaps(capped, starts, tokyo, at('2026-11-03T05:00:00Z'))).toBe(true);
    // A third that week reaches the weekly cap of 3 for the rest of the week, until Monday.
    const three = [...starts, at('2026-11-03T03:00:00Z')];
    expect(underCaps(capped, three, tokyo, at('2026-11-05T05:00:00Z'))).toBe(false);
    expect(underCaps(capped, three, tokyo, at('2026-11-09T05:00:00Z'))).toBe(true);
  });
});

describe('a page with a fixed host and two rotations (AC-1319, AC-1320)', () => {
  const people = ['fix', 'ae1', 'both', 'se1'];
  const reads = (busy: readonly string[] = []): TeamReads => ({
    hours: new Map(people.map((id) => [id, defaultAvailability('UTC')])),
    zones: new Map(people.map((id) => [id, 'UTC'])),
    busy: new Map(people.map((id) => [id, { ...busyNone, blocked: busy.includes(id) }])),
    bookings: new Map(),
    closed: new Map(),
    standing: new Map(),
  });
  const rules = (id: string) =>
    ({ id, name: id, strategy: 'fair', evenGap: 3, windowDays: 30, returning: 'owner' }) as const;
  const rotationMember = (memberId: string) => ({
    memberId,
    weight: 100,
    priority: 2,
    dailyCap: null,
    weeklyCap: null,
    calibration: 0,
  });
  const team = {
    kind: 'round_robin' as const,
    fixed: ['fix'],
    rotations: [
      { rules: rules('sales'), members: ['ae1', 'both', 'fix'].map(rotationMember) },
      { rules: rules('solutions'), members: ['both', 'se1'].map(rotationMember) },
    ],
  };
  const range = { duration: 60, from: at('2026-11-02T00:00:00Z'), to: at('2026-11-03T00:00:00Z'), now: NOW };

  it('offers a time with each rotation’s free members, never the fixed host as a rotation’s pick', () => {
    const found = teamSlots(teamPage(), team, reads(), range);
    expect(found.slots).toHaveLength(8);
    expect(found.slots[0]?.candidates).toEqual([
      ['ae1', 'both'],
      ['both', 'se1'],
    ]);
  });

  it('closes when the fixed host’s calendar refuses us, and when a rotation has nobody left', () => {
    expect(teamSlots(teamPage(), team, reads(['fix']), range)).toEqual({ slots: [], blocked: true });
    expect(teamSlots(teamPage(), team, reads(['both', 'se1']), range)).toEqual({ slots: [], blocked: true });
    // Without se1, Solutions has only Both: Sales still has ae1, so every time stays.
    expect(teamSlots(teamPage(), team, reads(['se1']), range).slots).toHaveLength(8);
  });
});
