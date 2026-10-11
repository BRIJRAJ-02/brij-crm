// Delivery planning (spec 0007, milestone 2, AC-85 and AC-87): each audience's
// copy of a row through spec 0009's `filterEvent`, the stub when nothing is
// left, and one channel per workspace until milestone 4.
import { ChangeEvent, ROLE_PERMISSIONS } from '@crm/contracts';
import type { OutboxRow } from '@crm/db';
import { describe, expect, it } from 'vitest';
import type { Audience } from '../access/events.ts';
import { roleAccess, type AccessRules } from '../access/policy.ts';
import { isAudiencesNeedChannels, planDelivery, workspaceEvent } from './plan.ts';

const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const OBJECT = id(0xa);
const SHOWN = id(0xf1);
const HIDDEN = id(0xf2);
const ADA = id(1);
const BEA = id(2);
const at = '2026-10-12T09:00:00.000Z';

const row = (overrides: Partial<OutboxRow>): OutboxRow => ({
  seq: 7,
  kind: 'records',
  objectId: OBJECT,
  listId: undefined,
  recordIds: [],
  attributeIds: [],
  itemIds: [],
  createdIds: [],
  deletedIds: [],
  restoredIds: [],
  coarse: false,
  mutationId: undefined,
  actorMemberId: undefined,
  at,
  replaced: undefined,
  ...overrides,
});

/** Members who share one policy, as `audiences` groups them. */
function audience(
  members: readonly { id: string; role: 'owner' | 'admin' | 'member' }[],
  rules?: AccessRules,
): Audience {
  const policy = roleAccess({ kind: 'member', memberId: ADA, role: 'member', teamIds: [] }, rules).data;
  return {
    key: policy.key,
    policy,
    members: members.map((member) => ({ memberId: member.id, permissions: ROLE_PERMISSIONS[member.role] })),
  };
}

const everyone = audience([
  { id: ADA, role: 'member' },
  { id: BEA, role: 'admin' },
]);
const hiddenField = audience([{ id: ADA, role: 'member' }], {
  levels: [
    {
      subject: { type: 'role', role: 'member' },
      target: { type: 'attribute', objectId: OBJECT, attributeId: HIDDEN },
      level: 'hidden',
    },
  ],
  records: [],
});

describe('planDelivery', () => {
  it('gives each audience its own copy, every one a ChangeEvent, and the stub where nothing is left', () => {
    const edit = row({ recordIds: [id(3)], attributeIds: [HIDDEN], mutationId: id(9) });
    const plan = planDelivery(edit, [everyone, hiddenField]);
    expect(plan.map((delivery) => delivery.audience)).toEqual([everyone.key, hiddenField.key]);
    expect(plan[0]?.event).toEqual({
      seq: 7,
      at,
      kind: 'records',
      objectId: OBJECT,
      recordIds: [id(3)],
      attributeIds: [HIDDEN],
      mutationId: id(9),
    });
    expect(plan[1]?.event).toEqual({ seq: 7, at, kind: 'restricted' });
    for (const delivery of plan) expect(ChangeEvent.safeParse(delivery.event).success).toBe(true);
  });

  it('puts the mutation id only on a copy filterEvent left unchanged (AC-87)', () => {
    const edit = row({ recordIds: [id(3)], attributeIds: [SHOWN, HIDDEN], mutationId: id(9) });
    const [whole, cut] = planDelivery(edit, [everyone, hiddenField]);
    expect(whole?.event).toHaveProperty('mutationId', id(9));
    expect(cut?.event).toMatchObject({ attributeIds: [SHOWN] });
    expect(cut?.event).not.toHaveProperty('mutationId');
  });

  it('names a job only to an audience whose every member may read it, never its starter', () => {
    const job = row({ kind: 'jobs', objectId: undefined, itemIds: [id(4)], actorMemberId: ADA, mutationId: id(9) });
    // Ada started it: an audience of Ada alone receives it; one with Bea, a member without jobs.manage, does not.
    const starterOnly = audience([{ id: ADA, role: 'member' }]);
    expect(planDelivery(job, [starterOnly])[0]?.event).toEqual({
      seq: 7,
      at,
      kind: 'jobs',
      jobIds: [id(4)],
      mutationId: id(9),
    });
    const mixed = audience([
      { id: ADA, role: 'member' },
      { id: BEA, role: 'member' },
    ]);
    expect(planDelivery(job, [mixed])[0]?.event).toEqual({ seq: 7, at, kind: 'jobs', jobIds: [], coarse: true });
    expect(JSON.stringify(planDelivery(job, [mixed]))).not.toContain(ADA);
  });

  it('sends a workspace nobody is in its most closed copy, and the stub for a malformed row', () => {
    const job = row({ kind: 'jobs', objectId: undefined, itemIds: [id(4)], actorMemberId: ADA });
    expect(planDelivery(job, [])).toEqual([
      { audience: 'open', event: { seq: 7, at, kind: 'jobs', jobIds: [], coarse: true } },
    ]);
    expect(planDelivery(row({ objectId: undefined }), [everyone])[0]?.event).toEqual({
      seq: 7,
      at,
      kind: 'restricted',
    });
  });
});

describe('workspaceEvent, the one channel until milestone 4', () => {
  it('is the one audience’s copy', () => {
    const edit = row({ recordIds: [id(3)], attributeIds: [SHOWN] });
    expect(workspaceEvent(edit, [everyone])).toEqual(planDelivery(edit, [everyone])[0]?.event);
  });

  it('refuses a workspace with more than one audience rather than send one copy to all', () => {
    let thrown: unknown;
    try {
      workspaceEvent(row({}), [everyone, hiddenField]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    // Its own code, so the relay reports it as what it is, not as a database failure.
    expect(isAudiencesNeedChannels(thrown)).toBe(true);
    expect(isAudiencesNeedChannels(new Error('The pool is down.'))).toBe(false);
  });
});
