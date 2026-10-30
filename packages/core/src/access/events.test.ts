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
  it('names the nine kinds of spec 0007, spec 0024’s meetings, spec 0034’s nav, spec 0035’s schedules and spec 0038’s comments and notifications, and asks for facts only for views, tasks and meetings', () => {
    expect([...EVENT_KINDS].sort()).toEqual(
      [
        'access',
        'calendars',
        'comments',
        'definitions',
        'entries',
        'jobs',
        'meetings',
        'members',
        'nav',
        'notes',
        'notifications',
        'records',
        'schedules',
        'tasks',
        'time_off',
        'views',
      ].sort(),
    );
    expect(eventFacts({ seq: 1, at, kind: 'schedules', scheduleIds: [] })).toEqual([]);
    expect(eventFacts({ seq: 1, at, kind: 'time_off' })).toEqual([]);
    expect(eventFacts({ seq: 1, at, kind: 'comments', recordIds: [], threadIds: [] })).toEqual([]);
    expect(eventFacts({ seq: 1, at, kind: 'meetings', recordIds: [], meetingIds: [] })).toEqual(['meetings']);
    expect(eventFacts({ seq: 1, at, kind: 'views', viewIds: [], coarse: false })).toEqual(['views']);
    expect(eventFacts({ seq: 1, at, kind: 'tasks', recordIds: [], taskIds: [] })).toEqual(['tasks']);
    expect(eventFacts(records)).toEqual([]);
    expect(eventFacts({ seq: 1, at, kind: 'nav', memberIds: [] })).toEqual([]);
  });

  it('passes a nav event, which names one member and nothing else, only to that member’s audience (spec 0034)', () => {
    const nav = {
      seq: 4,
      at,
      kind: 'nav' as const,
      memberIds: [ADA],
      mutationId: '00000000-0000-7000-8000-0000000000aa',
    };
    expect(filterEvent(open, nav)).toEqual(nav);
    expect(filterEvent(hiddenObject, nav)).toEqual(nav);
    // Another member's audience gets the stub: no feed of when Ada folds her sidebar.
    expect(filterEvent(audience([{ id: BEA, role: 'member' }]), nav)).toBeUndefined();
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

  it('names made, deleted and restored ids only among the records it keeps (spec 0007, owner decision pending)', () => {
    const lifecycle: EventRow = {
      ...records,
      replaced: undefined,
      createdIds: ['r1'],
      deletedIds: ['r2'],
    };
    expect(filterEvent(open, lifecycle)).toEqual(lifecycle);
    // Under a record rule: no ids at all, coarse, and no mutation id.
    const ruled = filterEvent(ownRecords, lifecycle);
    expect(ruled).toMatchObject({ recordIds: [], coarse: true });
    expect(ruled).not.toHaveProperty('createdIds');
    expect(ruled).not.toHaveProperty('deletedIds');
    expect(ruled).not.toHaveProperty('mutationId');
  });

  it('keeps a record made with only hidden fields, so counts still move, and names no hidden field', () => {
    const made: EventRow = { ...records, replaced: undefined, attributeIds: [HIDDEN], createdIds: ['r1'] };
    expect(filterEvent(hiddenField, made)).toEqual({
      seq: 41,
      at,
      kind: 'records',
      objectId: OBJECT,
      recordIds: ['r1'],
      attributeIds: [],
      createdIds: ['r1'],
      coarse: false,
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

  it('entries: drops the mutation id when a record rule empties entry ids, even with no record ids (AC-87)', () => {
    const onlyEntries: EventRow = { ...entries, recordIds: [] };
    const cut = filterEvent(ownRecords, onlyEntries);
    expect(cut).toMatchObject({ entryIds: [], coarse: true });
    expect(cut).not.toHaveProperty('mutationId');
  });

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

describe('comments and notifications (spec 0038, AC-1183)', () => {
  it('comments: follow their records, coarse with no ids under a record rule, never past a hidden object', () => {
    const comments: EventRow = {
      seq: 46,
      at,
      kind: 'comments',
      objectId: OBJECT,
      recordIds: ['r1'],
      threadIds: ['t1'],
      mutationId: 'm1',
    };
    expect(filterEvent(open, comments)).toEqual(comments);
    expect(filterEvent(hiddenObject, comments)).toBeUndefined();
    const { mutationId: _dropped, ...rest } = comments;
    expect(filterEvent(ownRecords, comments)).toEqual({ ...rest, recordIds: [], threadIds: [], coarse: true });
  });

  it('notifications: member ids only, so every audience gets them as they are', () => {
    const notifications: EventRow = { seq: 47, at, kind: 'notifications', memberIds: [ADA, BEA] };
    expect(filterEvent(open, notifications)).toEqual(notifications);
    expect(filterEvent(hiddenObject, notifications)).toEqual(notifications);
    expect(filterEvent(ownRecords, notifications)).toEqual(notifications);
  });
});

describe('meetings (spec 0024)', () => {
  const meetings: EventRow = {
    seq: 47,
    at,
    kind: 'meetings',
    recordIds: ['r1', 'x1'],
    meetingIds: ['m1', 'm2'],
    mutationId: 'm',
  };
  const facts = {
    meetings: {
      m1: { isPrivate: false, holderMemberIds: [BEA], records: [{ objectId: OBJECT, recordId: 'r1' }] },
      m2: { isPrivate: true, holderMemberIds: [BEA], records: [{ objectId: OTHER, recordId: 'x1' }] },
    },
  };

  it('keeps a private meeting’s id only for an audience of its holders, and every record id under the open policy', () => {
    // Ada doesn't hold the private one: its id goes, its record stays (it shows there as "Private meeting").
    expect(filterEvent(open, meetings, facts)).toEqual({
      seq: 47,
      at,
      kind: 'meetings',
      recordIds: ['r1', 'x1'],
      meetingIds: ['m1'],
    });
    const holder = audience([{ id: BEA, role: 'member' }]);
    expect(filterEvent(holder, meetings, facts)).toEqual(meetings);
  });

  it('keeps only readable records for a restricted audience, coarse, and a removed meeting’s records for the open one', () => {
    expect(filterEvent(hiddenObject, meetings, facts)).toEqual({
      seq: 47,
      at,
      kind: 'meetings',
      recordIds: ['x1'],
      meetingIds: ['m1'],
      coarse: true,
    });
    // A meeting removed (no fact): its records still hear of it under the open policy, and nobody gets its id.
    const removed: EventRow = { ...meetings, meetingIds: ['gone'] };
    expect(filterEvent(open, removed, {})).toMatchObject({ recordIds: ['r1', 'x1'], meetingIds: [] });
    // A restricted audience can't judge it: nothing named, coarse.
    expect(filterEvent(hiddenObject, removed, {})).toMatchObject({ recordIds: [], meetingIds: [], coarse: true });
    // A record in the trash shows its meetings to nobody restricted.
    const trashed = {
      meetings: {
        m1: { isPrivate: false, holderMemberIds: [], records: [{ objectId: OTHER, recordId: 'x1', trashed: true }] },
      },
    };
    expect(filterEvent(hiddenObject, { ...meetings, meetingIds: ['m1'], recordIds: ['x1'] }, trashed)).toMatchObject({
      recordIds: [],
      coarse: true,
    });
  });

  it('keeps a booking’s meeting id only for an audience who may see the booking: its seers or booking.admin', () => {
    // The owner's ask of 29 October 2026: m3 a booking made, which Bea hosts; Ada is a colleague.
    const booked = {
      meetings: {
        m3: {
          isPrivate: false,
          holderMemberIds: [BEA],
          bookingSeerMemberIds: [BEA],
          records: [{ objectId: OBJECT, recordId: 'r1' }],
        },
      },
    };
    const row: EventRow = { ...meetings, meetingIds: ['m3'], recordIds: ['r1'] };
    // Ada, a plain member: the record hears of it (it reads "Private meeting" there), the id never.
    expect(filterEvent(open, row, booked)).toMatchObject({ recordIds: ['r1'], meetingIds: [] });
    // Bea, the host: in full.
    expect(filterEvent(audience([{ id: BEA, role: 'member' }]), row, booked)).toMatchObject({ meetingIds: ['m3'] });
    // An admin (booking.admin) who isn't on it: in full too.
    expect(filterEvent(audience([{ id: ADA, role: 'admin' }]), row, booked)).toMatchObject({ meetingIds: ['m3'] });
    // An audience of the host and a colleague together: not every one may see it, so the id goes.
    const mixed = audience([
      { id: BEA, role: 'member' },
      { id: ADA, role: 'member' },
    ]);
    expect(filterEvent(mixed, row, booked)).toMatchObject({ meetingIds: [] });
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

  it('keeps an unlinked record for the open audience, so its screens hear of the unlink (spec 0019)', () => {
    const unlinked: EventRow = { ...tasks, recordIds: ['r1', 'gone'], taskIds: ['t1'] };
    expect(filterEvent(open, unlinked, facts)).toEqual(unlinked);
    // A restricted audience can't judge a record in no fact: left out, coarse.
    expect(filterEvent(hiddenObject, unlinked, facts)).toMatchObject({ recordIds: [], taskIds: [], coarse: true });
  });

  it('shows a task whose every link is in the trash to its assignee and creator only (spec 0019, AC-447)', () => {
    const trashed = {
      tasks: {
        t1: {
          creatorMemberId: BEA,
          assigneeMemberIds: [],
          records: [{ objectId: OBJECT, recordId: 'r1', trashed: true }],
        },
      },
    };
    const row: EventRow = { ...tasks, recordIds: ['r1'], taskIds: ['t1'] };
    // Ada neither made it nor has it: nothing of it, and not its record either.
    expect(filterEvent(open, row, trashed)).toMatchObject({ taskIds: [], recordIds: [], coarse: true });
    expect(filterEvent(audience([{ id: BEA, role: 'member' }]), row, trashed)).toEqual(row);
  });

  it('shows a task whose links went with their records, removed for good, to its assignee and creator only', () => {
    // No links left, but they were purged, not never made (late trap #79): not everyone's task.
    const purged = { tasks: { t1: { creatorMemberId: BEA, assigneeMemberIds: [], records: [], linksPurged: true } } };
    const row: EventRow = { ...tasks, recordIds: [], taskIds: ['t1'] };
    expect(filterEvent(open, row, purged)).toMatchObject({ taskIds: [] });
    expect(filterEvent(audience([{ id: BEA, role: 'member' }]), row, purged)).toEqual(row);
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

describe('schedules (spec 0035, AC-971, AC-977)', () => {
  const schedules: EventRow = {
    seq: 50,
    at,
    kind: 'schedules',
    scheduleIds: ['s1', 's2'],
    actorMemberId: ADA,
    mutationId: 'm',
  };

  it('names schedules only to an audience whose every member wrote them or holds booking.admin, never the writer', () => {
    expect(filterEvent(open, schedules)).toEqual({
      seq: 50,
      at,
      kind: 'schedules',
      scheduleIds: ['s1', 's2'],
      mutationId: 'm',
    });
    const admins = audience([
      { id: BEA, role: 'admin' },
      { id: OTHER, role: 'owner' },
    ]);
    expect(filterEvent(admins, schedules)).toEqual({
      seq: 50,
      at,
      kind: 'schedules',
      scheduleIds: ['s1', 's2'],
      mutationId: 'm',
    });
  });

  it('tells anyone else only that schedules changed: no ids, no mutation id', () => {
    const colleague = audience([{ id: BEA, role: 'member' }]);
    expect(filterEvent(colleague, schedules)).toEqual({
      seq: 50,
      at,
      kind: 'schedules',
      scheduleIds: [],
      coarse: true,
    });
    const mixed = audience([
      { id: ADA, role: 'member' },
      { id: BEA, role: 'member' },
    ]);
    expect(filterEvent(mixed, schedules)).toEqual({ seq: 50, at, kind: 'schedules', scheduleIds: [], coarse: true });
    expect(filterEvent(audience([]), schedules)).toEqual({
      seq: 50,
      at,
      kind: 'schedules',
      scheduleIds: [],
      coarse: true,
    });
  });
});
