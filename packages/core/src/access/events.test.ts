// Who may read a live event (spec 0009, AC-145, AC-150): `filterEvent` over
// every kind, for the open audience and for restricted ones.
import { CHANGE_EVENT_KINDS, ROLE_PERMISSIONS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { EVENT_KINDS, eventFacts, filterEvent, type Audience, type EventRow } from './events.ts';
import { roleAccess, type AccessRules, type MemberPrincipal } from './policy.ts';

const OBJECT = '00000000-0000-7000-8000-00000000000a';
const OTHER = '00000000-0000-7000-8000-00000000000b';
const LIST = '00000000-0000-7000-8000-00000000001a';
const SHOWN = '00000000-0000-7000-8000-0000000000f1';
const HIDDEN = '00000000-0000-7000-8000-0000000000f2';
const OWNER_ATTRIBUTE = '00000000-0000-7000-8000-0000000000f3';
const ADA = '00000000-0000-7000-8000-000000000001';
const BEA = '00000000-0000-7000-8000-000000000002';
const BY_ADA = { type: 'member', id: ADA } as const;

const principal = (memberId: string, role: 'owner' | 'admin' | 'member'): MemberPrincipal => ({
  kind: 'member',
  memberId,
  role,
  teamIds: [],
});

/** One audience of the given members, all under the policy `rules` gives a member. */
function audience(
  members: readonly { id: string; role: 'owner' | 'admin' | 'member' }[],
  rules?: AccessRules,
): Audience {
  const policy = roleAccess(principal(ADA, 'member'), rules).data;
  return {
    key: policy.key,
    policy,
    members: members.map(({ id, role }) => ({ memberId: id, permissions: ROLE_PERMISSIONS[role] })),
  };
}

const memberRule = (target: AccessRules['levels'][number]['target'], level: string) => ({
  subject: { type: 'role', role: 'member' } as const,
  target,
  level,
});
const open = audience([{ id: ADA, role: 'member' }]);
const hiddenObject = audience([{ id: ADA, role: 'member' }], {
  levels: [memberRule({ type: 'object', objectId: OBJECT }, 'none')],
  records: [],
});
const hiddenField = audience([{ id: ADA, role: 'member' }], {
  levels: [memberRule({ type: 'attribute', objectId: OBJECT, attributeId: HIDDEN }, 'hidden')],
  records: [],
});
const ownRecords = audience([{ id: ADA, role: 'member' }], {
  levels: [],
  records: [{ subject: { type: 'role', role: 'member' }, objectId: OBJECT, kind: 'own', attributeId: OWNER_ATTRIBUTE }],
});

const at = '2026-10-08T09:00:00.000Z';
const records: EventRow = {
  seq: 41,
  at,
  kind: 'records',
  objectId: OBJECT,
  recordIds: ['r1', 'r2'],
  attributeIds: [SHOWN, HIDDEN],
  coarse: false,
  mutationId: 'm1',
  replaced: {
    by: BY_ADA,
    cells: [
      { recordId: 'r1', attributeId: SHOWN, versionId: 'v1' },
      { recordId: 'r1', attributeId: HIDDEN, versionId: 'v2' },
    ],
  },
};

describe('every kind has a rule', () => {
  it('names the nine kinds of spec 0007, and asks for facts only for views and tasks', () => {
    expect([...EVENT_KINDS].sort()).toEqual(
      ['access', 'definitions', 'entries', 'jobs', 'members', 'notes', 'records', 'tasks', 'views'].sort(),
    );
    expect(eventFacts({ seq: 1, at, kind: 'views', viewIds: [], coarse: false })).toEqual(['views']);
    expect(eventFacts({ seq: 1, at, kind: 'tasks', recordIds: [], taskIds: [] })).toEqual(['tasks']);
    expect(eventFacts(records)).toEqual([]);
  });

  it("has a rule for every kind of spec 0007's ChangeEvent but the stub (AC-79)", () => {
    expect([...EVENT_KINDS].sort()).toEqual(CHANGE_EVENT_KINDS.filter((kind) => kind !== 'restricted').sort());
  });
});

describe('records', () => {
  it('passes in full to the open audience', () => {
    expect(filterEvent(open, records)).toEqual(records);
  });

  it('leaves nothing (the stub) for an object at none', () => {
    expect(filterEvent(hiddenObject, records)).toBeUndefined();
  });

  it('removes hidden attribute ids and their replaced entries, and the mutation id with them', () => {
    expect(filterEvent(hiddenField, records)).toEqual({
      seq: 41,
      at,
      kind: 'records',
      objectId: OBJECT,
      recordIds: ['r1', 'r2'],
      attributeIds: [SHOWN],
      coarse: false,
      replaced: { by: BY_ADA, cells: [{ recordId: 'r1', attributeId: SHOWN, versionId: 'v1' }] },
    });
  });

  it('drops the replaced list whole when every cell in it is hidden', () => {
    const onlyHidden: EventRow = {
      ...records,
      replaced: { by: BY_ADA, cells: [{ recordId: 'r1', attributeId: HIDDEN, versionId: 'v2' }] },
    };
    expect(filterEvent(hiddenField, onlyHidden)).not.toHaveProperty('replaced');
  });

  it('drops records whose only changed attributes are hidden, which leaves nothing', () => {
    expect(filterEvent(hiddenField, { ...records, attributeIds: [HIDDEN], replaced: undefined })).toBeUndefined();
  });

  it('under a record rule, removes record ids and replaced, and makes the event coarse', () => {
    expect(filterEvent(ownRecords, records)).toEqual({
      seq: 41,
      at,
      kind: 'records',
      objectId: OBJECT,
      recordIds: [],
      attributeIds: [SHOWN, HIDDEN],
      coarse: true,
    });
  });

  it('keeps a coarse event coarse for anyone who sees the object', () => {
    const coarse: EventRow = { ...records, recordIds: [], attributeIds: [], coarse: true, replaced: undefined };
    expect(filterEvent(hiddenField, coarse)).toEqual(coarse);
  });
});

describe('entries, definitions, views and notes', () => {
  const entries: EventRow = {
    seq: 42,
    at,
    kind: 'entries',
    listId: LIST,
    objectId: OBJECT,
    entryIds: ['e1'],
    recordIds: ['r1'],
    attributeIds: [],
    coarse: false,
    mutationId: 'm2',
  };

  it('entries: nothing when the parent object is hidden; coarse with no ids under its record rule', () => {
    expect(filterEvent(open, entries)).toEqual(entries);
    expect(filterEvent(hiddenObject, entries)).toBeUndefined();
    expect(filterEvent(ownRecords, entries)).toEqual({
      seq: 42,
      at,
      kind: 'entries',
      listId: LIST,
      objectId: OBJECT,
      entryIds: [],
      recordIds: [],
      attributeIds: [],
      coarse: true,
    });
  });

  it('definitions: nothing when the object is hidden, hidden attribute ids removed', () => {
    const definitions: EventRow = { seq: 43, at, kind: 'definitions', objectId: OBJECT, attributeIds: [SHOWN, HIDDEN] };
    expect(filterEvent(open, definitions)).toEqual(definitions);
    expect(filterEvent(hiddenObject, definitions)).toBeUndefined();
    expect(filterEvent(hiddenField, definitions)).toEqual({ ...definitions, attributeIds: [SHOWN] });
    // A row naming neither an object nor a list: in full when open, nothing for a restricted audience.
    expect(filterEvent(open, { seq: 43, at, kind: 'definitions' })).toEqual({ seq: 43, at, kind: 'definitions' });
    expect(filterEvent(hiddenField, { seq: 43, at, kind: 'definitions' })).toBeUndefined();
    expect(filterEvent(hiddenField, { seq: 44, at, kind: 'views', viewIds: [], coarse: false })).toBeUndefined();
    expect(filterEvent(hiddenField, { seq: 43, at, kind: 'definitions', objectId: OTHER })).toEqual({
      seq: 43,
      at,
      kind: 'definitions',
      objectId: OTHER,
    });
  });

  it('views: a workspace view for everyone, a private one only for an audience of its owner, else coarse', () => {
    const views: EventRow = {
      seq: 44,
      at,
      kind: 'views',
      objectId: OBJECT,
      viewIds: ['shared', 'mine'],
      coarse: false,
    };
    const facts = {
      views: {
        shared: { visibility: 'workspace' as const },
        mine: { visibility: 'private' as const, ownerMemberId: ADA },
      },
    };
    expect(filterEvent(open, views, facts)).toEqual(views);
    const pair = audience([
      { id: ADA, role: 'member' },
      { id: BEA, role: 'member' },
    ]);
    expect(filterEvent(pair, views, facts)).toEqual({ ...views, viewIds: ['shared'], coarse: true });
    // A view with no fact loaded counts as not visible.
    expect(filterEvent(open, views)).toEqual({ ...views, viewIds: [], coarse: true });
    expect(filterEvent(hiddenObject, views, facts)).toBeUndefined();
  });

  it('notes: follow their records, coarse with no ids under a record rule', () => {
    const notes: EventRow = { seq: 45, at, kind: 'notes', objectId: OBJECT, recordIds: ['r1'], noteIds: ['n1'] };
    expect(filterEvent(open, notes)).toEqual(notes);
    expect(filterEvent(hiddenObject, notes)).toBeUndefined();
    expect(filterEvent(ownRecords, notes)).toEqual({ ...notes, recordIds: [], noteIds: [], coarse: true });
  });
});

describe('tasks', () => {
  const tasks: EventRow = {
    seq: 46,
    at,
    kind: 'tasks',
    recordIds: ['r1', 'x1'],
    taskIds: ['t1', 't2'],
    mutationId: 'm',
  };
  const facts = {
    tasks: {
      t1: { assigneeMemberIds: [], records: [{ objectId: OBJECT, recordId: 'r1' }] },
      t2: { creatorMemberId: BEA, assigneeMemberIds: [], records: [{ objectId: OTHER, recordId: 'x1' }] },
    },
  };

  it('keeps every task with a visible record for the open audience', () => {
    expect(filterEvent(open, tasks, facts)).toEqual(tasks);
  });

  it('keeps a task only when every member may see it, with only readable records, else coarse', () => {
    expect(filterEvent(hiddenObject, tasks, facts)).toEqual({
      seq: 46,
      at,
      kind: 'tasks',
      recordIds: ['x1'],
      taskIds: ['t2'],
      coarse: true,
    });
    // Its creator sees a task whose only record is hidden.
    const creator = audience([{ id: BEA, role: 'member' }], {
      levels: [memberRule({ type: 'object', objectId: OTHER }, 'none')],
      records: [],
    });
    expect(filterEvent(creator, tasks, facts)).toMatchObject({
      taskIds: ['t1', 't2'],
      recordIds: ['r1'],
      coarse: true,
    });
  });
});

describe('members, access and jobs', () => {
  it('sends members and access in full to everyone', () => {
    const members: EventRow = { seq: 47, at, kind: 'members', memberIds: [ADA] };
    const access: EventRow = { seq: 48, at, kind: 'access', memberIds: [BEA] };
    expect(filterEvent(hiddenObject, members)).toEqual(members);
    expect(filterEvent(ownRecords, access)).toEqual(access);
  });

  const job: EventRow = {
    seq: 49,
    at,
    kind: 'jobs',
    jobIds: ['j1'],
    coarse: false,
    actorMemberId: ADA,
    mutationId: 'm',
  };

  it('names a job only to an audience whose every member started it or holds jobs.manage, never its starter id', () => {
    expect(filterEvent(open, job)).toEqual({
      seq: 49,
      at,
      kind: 'jobs',
      jobIds: ['j1'],
      coarse: false,
      mutationId: 'm',
    });
    const withAdmin = audience([
      { id: ADA, role: 'member' },
      { id: BEA, role: 'admin' },
    ]);
    expect(filterEvent(withAdmin, job)).toEqual({
      seq: 49,
      at,
      kind: 'jobs',
      jobIds: ['j1'],
      coarse: false,
      mutationId: 'm',
    });
  });

  it('makes the event coarse with no ids, and no mutation id, for an audience with anyone else', () => {
    const withMember = audience([
      { id: ADA, role: 'member' },
      { id: BEA, role: 'member' },
    ]);
    expect(filterEvent(withMember, job)).toEqual({ seq: 49, at, kind: 'jobs', jobIds: [], coarse: true });
    expect(filterEvent(audience([]), job)).toEqual({ seq: 49, at, kind: 'jobs', jobIds: [], coarse: true });
  });
});
