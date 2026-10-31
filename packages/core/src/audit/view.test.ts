// One audit row as Workspace changes shows it (spec 0046, AC-4605 to AC-4607,
// AC-4610, AC-4624). First the pure mapping, one fixture per listed action
// shaped exactly as its call site writes it, each answer parsed by the strict
// contract; then rows written through the real `writeAudit` in a real
// workspace and read back through `listAuditEvents`: a former member, a
// deleted account with no profile values, a deleted round robin, the system,
// unknown keys dropped, and a profile change with no known field left.
import { sql } from 'drizzle-orm';
import { AuditEntryView, type ListedAuditAction } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { deletedEmail } from '../account/deletion.ts';
import { newId } from '../engine/ids.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { writeAudit, type AuditEntry } from '../members/audit.ts';
import { removeMember } from '../members/members.ts';
import { testScope } from '../testing.ts';
import { listAuditEvents } from './audit.ts';
import { toEntryView, type AuditNames, type AuditRow } from './view.ts';

const AT = '2026-10-23T06:52:11.123456Z';
const ada = newId();
const bea = newId();
const gone = newId();
const invitation = newId();
const link = newId();
const request = newId();
const rotation = newId();
const deletedRotation = newId();
const form = newId();
const page = newId();
const booking = newId();
const record = newId();
const listId = newId();

const names: AuditNames = {
  members: new Map([
    [ada, { name: 'Ada Lovelace', state: 'active' }],
    [bea, { name: 'Bea Rao', state: 'former' }],
    [gone, { name: 'Deleted user', state: 'deleted' }],
  ]),
  invitations: new Map([
    [invitation, { email: 'grace@example.com', isLink: false }],
    [link, { isLink: true }],
  ]),
  joinRequests: new Map([[request, 'Cy Young']]),
  rotations: new Map([
    [rotation, { name: 'Sales', isGone: false }],
    [deletedRotation, { name: 'Old team', isGone: true }],
  ]),
  forms: new Map([[form, { name: 'Contact us', isGone: false }]]),
  bookingPages: new Map([[page, { name: 'Intro call', isGone: false }]]),
  bookings: new Map([[booking, { pageTitle: 'Intro call', startsAt: '2026-10-24T09:30:00.000000Z' }]]),
  lists: new Map([[listId, { name: 'Deals', isGone: false }]]),
};

/** A stored row as the page statement reads it. */
function row(
  action: string,
  targetType: string,
  targetId: string,
  stored: { before?: unknown; after?: unknown; actor?: 'ada' | 'system' | 'gone' | 'bea' } = {},
): AuditRow {
  const actor = stored.actor ?? 'ada';
  const memberId = actor === 'ada' ? ada : actor === 'gone' ? gone : actor === 'bea' ? bea : null;
  return {
    id: newId(),
    at: AT,
    actorType: actor === 'system' ? 'system' : 'member',
    actorMemberId: memberId,
    action,
    targetType,
    targetId,
    before: stored.before ?? null,
    after: stored.after ?? null,
  };
}

/** One fixture per listed action, and its variants, as each call site writes it. */
const FIXTURES: Record<ListedAuditAction, readonly AuditRow[]> = {
  'invitation.created': [row('invitation.created', 'invitation', invitation, { after: { role: 'admin' } })],
  'invitation.resent': [
    row('invitation.resent', 'invitation', invitation),
    row('invitation.resent', 'invitation', invitation, { before: { role: 'member' }, after: { role: 'admin' } }),
  ],
  'invitation.revoked': [
    row('invitation.revoked', 'invitation', invitation, { before: { status: 'open' }, after: { status: 'revoked' } }),
  ],
  'invitation.accepted': [
    row('invitation.accepted', 'member', bea, { actor: 'bea', after: { role: 'member', invitationId: invitation } }),
    row('invitation.accepted', 'member', bea, {
      actor: 'bea',
      after: { role: 'member', invitationId: link, via: 'link' },
    }),
    row('invitation.accepted', 'invitation', invitation, {
      before: { status: 'open' },
      after: { status: 'used', alreadyMember: true },
    }),
  ],
  'invitation.link_set': [
    row('invitation.link_set', 'invitation', link, { after: { role: 'member', created: true } }),
    row('invitation.link_set', 'invitation', link, { after: { role: 'member', reset: true, replaces: newId() } }),
    row('invitation.link_set', 'invitation', link, { after: { expiresInDays: 7, maxUses: 10 } }),
  ],
  'invitation.link_revoked': [
    row('invitation.link_revoked', 'invitation', link, { before: { status: 'open' }, after: { status: 'revoked' } }),
  ],
  'workspace.domains_set': [
    row('workspace.domains_set', 'workspace', newId(), {
      before: { domains: ['acme.com'] },
      after: { domains: ['acme.io'] },
    }),
  ],
  'join_request.created': [row('join_request.created', 'join_request', request, { actor: 'system' })],
  'join_request.approved': [
    row('join_request.approved', 'member', bea, { after: { role: 'member', requestId: request } }),
    row('join_request.approved', 'member', bea, {
      after: { role: 'member', requestId: request, alreadyMember: true },
    }),
  ],
  'join_request.declined': [
    row('join_request.declined', 'join_request', request),
    row('join_request.declined', 'join_request', request, { actor: 'system', after: { reason: 'account_deleted' } }),
  ],
  'member.role_changed': [
    row('member.role_changed', 'member', bea, { before: { role: 'member' }, after: { role: 'admin' } }),
  ],
  'member.removed': [
    row('member.removed', 'member', bea, { before: { status: 'active' }, after: { status: 'removed' } }),
  ],
  'member.left': [
    row('member.left', 'member', bea, {
      actor: 'bea',
      before: { status: 'active' },
      after: { status: 'removed' },
    }),
  ],
  'workspace.ownership_transferred': [
    row('workspace.ownership_transferred', 'member', bea, {
      before: { toRole: 'admin', fromRole: 'owner', from: ada },
      after: { toRole: 'owner', fromRole: 'admin', from: ada },
    }),
  ],
  'account.deleted': [row('account.deleted', 'member', gone, { actor: 'gone' })],
  'member.profile_updated': [
    row('member.profile_updated', 'member', ada, {
      before: { name: 'Ada', timeZone: null },
      after: { name: 'Ada Lovelace', timeZone: 'Asia/Kolkata' },
    }),
    row('member.profile_updated', 'member', bea, { before: { bio: 'Hi' }, after: { bio: 'Hello' } }),
    // A key this screen doesn't know yet (photo-switch's) is dropped, and the sentence falls back to "profile".
    row('member.profile_updated', 'member', ada, { before: { pictureHidden: false }, after: { pictureHidden: true } }),
    // Social links (booking socials, 25 Oct 2026): the lists of links before and after.
    row('member.profile_updated', 'member', ada, {
      before: { socials: ['https://x.com/ada'] },
      after: { socials: ['https://x.com/ada', 'https://ada.dev'] },
    }),
  ],
  'workspace.updated': [
    row('workspace.updated', 'workspace', newId(), { before: { name: 'Acme' }, after: { name: 'Acme Ltd' } }),
    row('workspace.updated', 'workspace', newId(), {
      before: { timeZone: 'UTC', slug: 'acme' },
      after: { timeZone: 'Asia/Kolkata', slug: 'acme-ltd' },
    }),
  ],
  'workspace.deleted': [
    row('workspace.deleted', 'workspace', newId(), {
      before: { deletedAt: null },
      after: { deletedAt: '2026-10-23T06:52:11.123Z', purgeAfter: '2026-11-22T06:52:11.123Z' },
    }),
  ],
  'workspace.restored': [row('workspace.restored', 'workspace', newId(), { after: { deletedAt: null } })],
  'workspace_security.changed': [
    row('workspace_security.changed', 'workspace', newId(), {
      before: { requireTwoFactor: false },
      after: { requireTwoFactor: true },
    }),
    row('workspace_security.changed', 'workspace', newId(), {
      before: { sessionLengthDays: null },
      after: { sessionLengthDays: 14 },
    }),
    row('workspace_security.changed', 'workspace', newId(), {
      before: { requireTwoFactor: true, sessionLengthDays: 14 },
      after: { requireTwoFactor: false, sessionLengthDays: null },
    }),
  ],
  'workspace_security.signed_out_everyone': [row('workspace_security.signed_out_everyone', 'workspace', newId())],
  'webhook.created': [row('webhook.created', 'workspace', newId(), { after: { host: 'hooks.example.com' } })],
  'webhook.updated': [row('webhook.updated', 'workspace', newId(), { after: { host: 'hooks.example.com' } })],
  'webhook.secret_rotated': [
    row('webhook.secret_rotated', 'workspace', newId(), { after: { host: 'hooks.example.com' } }),
  ],
  'webhook.deleted': [row('webhook.deleted', 'workspace', newId(), { after: { host: 'hooks.example.com' } })],
  'webhook.turned_off': [row('webhook.turned_off', 'workspace', newId(), { after: { host: 'hooks.example.com' } })],
  'rotation.adjusted': [
    row('rotation.adjusted', 'rotation', rotation, { after: { memberId: bea, units: 2, note: 'Holiday' } }),
  ],
  'rotation.adjustment_undone': [
    row('rotation.adjustment_undone', 'rotation', deletedRotation, {
      before: { adjustmentId: newId(), memberId: bea, units: -1 },
    }),
  ],
  'booking.reassigned': [
    row('booking.reassigned', 'booking', booking, {
      before: { seats: [{ rotationId: rotation, memberId: ada }] },
      after: { seats: [{ rotationId: rotation, memberId: bea }], reason: 'reassigned' },
    }),
    row('booking.reassigned', 'booking', booking, {
      before: {
        seats: [
          { rotationId: rotation, memberId: ada },
          { rotationId: deletedRotation, memberId: bea },
        ],
      },
      after: {
        seats: [
          { rotationId: rotation, memberId: bea },
          { rotationId: deletedRotation, memberId: ada },
        ],
        reason: 'manual',
      },
    }),
  ],
  'routing.changed': [
    row('routing.changed', 'form', form, { before: { rules: 1 }, after: { rules: 2, version: 3, changed: [] } }),
    row('routing.changed', 'booking_page', page, { before: { rules: 2 }, after: { rules: 1, changed: [] } }),
  ],
  'form.owner_changed': [
    row('form.owner_changed', 'form', form, {
      before: { ownerMemberId: ada, ownerRotationId: null },
      after: { ownerMemberId: null, ownerRotationId: rotation },
    }),
  ],
  'form.notify_changed': [
    row('form.notify_changed', 'form', form, {
      before: { notifyMemberIds: [ada] },
      after: { notifyMemberIds: [ada, bea] },
    }),
  ],
  'booking.no_show': [row('booking.no_show', 'booking', booking)],
  'list.created': [row('list.created', 'list', listId)],
  'list.updated': [row('list.updated', 'list', listId, { before: { name: 'Sales' }, after: { name: 'Deals' } })],
  'list.archived': [row('list.archived', 'list', listId)],
  'list.restored': [row('list.restored', 'list', listId)],
  'booking.no_show_undone': [row('booking.no_show_undone', 'booking', booking)],
  'booking.record_linked': [
    row('booking.record_linked', 'booking', booking, { before: { recordId: null }, after: { recordId: record } }),
  ],
  'booking.record_unlinked': [
    row('booking.record_unlinked', 'booking', booking, { before: { recordId: record }, after: { recordId: null } }),
  ],
  // Scheduling access (spec 0037, AC-1257): the delegate is the target; over a member, or everyone.
  'delegation.granted': [
    row('delegation.granted', 'member', ada, {
      after: { level: 'manage', targetType: 'member', targetMemberId: bea },
    }),
    row('delegation.granted', 'member', ada, { after: { level: 'view', targetType: 'everyone' } }),
  ],
  'delegation.changed': [
    row('delegation.changed', 'member', ada, {
      before: { level: 'view', targetType: 'member', targetMemberId: bea },
      after: { level: 'manage', targetType: 'member', targetMemberId: bea },
    }),
  ],
  'delegation.revoked': [
    row('delegation.revoked', 'member', ada, { before: { level: 'view', targetType: 'everyone' } }),
  ],
  // Someone's scheduling (spec 0037, AC-1263): the member whose it is is the target.
  'schedule.changed': [
    row('schedule.changed', 'member', bea, {
      before: { memberId: bea, kind: 'update', schedules: [{ id: newId(), name: 'Working hours', weekly: [] }] },
      after: { memberId: bea, kind: 'update', schedules: [{ id: newId(), name: 'Working hours', weekly: [1] }] },
    }),
    row('schedule.changed', 'member', bea, {
      before: { memberId: bea, kind: 'create', schedules: [] },
      after: { memberId: bea, kind: 'create', schedules: [{ id: newId(), name: 'Summer' }] },
    }),
  ],
  'block.created': [
    row('block.created', 'member', bea, { after: { memberId: bea, blockId: newId(), kind: 'busy', repeat: 'once' } }),
  ],
  'time_off.created': [
    row('time_off.created', 'member', bea, { after: { memberId: bea, timeOffId: newId(), reason: 'vacation' } }),
  ],
  'time_off.changed': [
    row('time_off.changed', 'member', bea, { after: { memberId: bea, timeOffId: newId(), reason: 'sick' } }),
  ],
  'time_off.deleted': [
    row('time_off.deleted', 'member', bea, { before: { memberId: bea, timeOffId: newId(), reason: 'travel' } }),
  ],
  'limits.changed': [
    row('limits.changed', 'member', bea, { before: { memberId: bea }, after: { memberId: bea, perDay: 4 } }),
  ],
  'calendar.reconnect_asked': [row('calendar.reconnect_asked', 'member', bea)],
  'block.removed': [
    row('block.removed', 'member', bea, { before: { memberId: bea, blockId: newId(), kind: 'busy', repeat: 'once' } }),
  ],
  'booking.changed_for': [
    row('booking.changed_for', 'booking', booking, { after: { memberId: bea, change: 'moved' } }),
    row('booking.changed_for', 'booking', booking, { after: { memberId: bea, change: 'made' } }),
  ],
  // As the call sites in teams.ts and rules.ts write them (target types `team` and `object`).
  'team.changed': [
    row('team.changed', 'team', newId(), { after: { change: 'created', name: 'Sales' } }),
    row('team.changed', 'team', newId(), { before: { name: 'Sales' }, after: { change: 'renamed', name: 'Revenue' } }),
    row('team.changed', 'team', newId(), { before: { name: 'Revenue' }, after: { change: 'deleted', left: [bea] } }),
    row('team.changed', 'team', newId(), { after: { change: 'members', name: 'Sales', joined: [bea], left: [] } }),
  ],
  'access.rule_set': [
    row('access.rule_set', 'object', newId(), {
      before: { level: 'write', records: 'all', isDefault: true },
      after: {
        object: 'Deals',
        subject: 'team',
        team: 'Sales',
        level: 'write',
        records: 'own',
        fields: { Salary: 'hidden' },
        isDefault: false,
      },
    }),
  ],
};

const view = (each: AuditRow): AuditEntryView => {
  const made = toEntryView(each, names);
  if (made === undefined) throw new Error(`${each.action} made no entry.`);
  return AuditEntryView.parse(made);
};
const only = (action: ListedAuditAction, index = 0): AuditEntryView => {
  const fixture = FIXTURES[action][index];
  if (fixture === undefined) throw new Error(`No fixture ${String(index)} for ${action}.`);
  return view(fixture);
};

describe('toEntryView, per action', () => {
  it.each(Object.entries(FIXTURES))('%s answers a strict entry the contract accepts', (_action, rows) => {
    for (const each of rows) expect(() => view(each)).not.toThrow();
  });

  it('leaves out an action Workspace changes doesn’t list, and one it doesn’t know', () => {
    expect(
      toEntryView(row('member.preferences_changed', 'member', ada, { after: { weekStart: 'monday' } }), names),
    ).toBeUndefined();
    expect(toEntryView(row('booking_page.profile_reordered', 'booking_page', page), names)).toBeUndefined();
  });

  it('names people as they are now: active, former, deleted, the system, and a row it can’t read', () => {
    expect(only('member.role_changed')).toMatchObject({
      actor: { kind: 'member', memberId: ada, name: 'Ada Lovelace', state: 'active' },
      target: { type: 'member', person: { kind: 'member', name: 'Bea Rao', state: 'former' } },
      params: { from: 'member', to: 'admin' },
    });
    expect(only('account.deleted').actor).toEqual({
      kind: 'member',
      memberId: gone,
      name: 'Deleted user',
      state: 'deleted',
    });
    expect(only('join_request.declined', 1)).toMatchObject({
      actor: { kind: 'system' },
      target: { type: 'join_request', name: 'Cy Young' },
      params: { reason: 'account_deleted' },
    });
    // The asker isn't a member: the Who column names them from their request.
    expect(only('join_request.created').actor).toEqual({ kind: 'asker', name: 'Cy Young' });
    const unknown = toEntryView({ ...row('member.removed', 'member', newId()), actorMemberId: newId() }, names);
    expect(unknown).toMatchObject({ actor: { kind: 'unknown' }, target: { person: { kind: 'unknown' } } });
  });

  it('names targets as they are now, and a deleted or purged one as gone', () => {
    expect(only('invitation.created')).toMatchObject({
      target: { type: 'invitation', email: 'grace@example.com', isLink: false },
      params: { role: 'admin' },
    });
    expect(only('invitation.link_revoked').target).toMatchObject({ type: 'invitation', isLink: true });
    expect(only('invitation.link_revoked').target).not.toHaveProperty('email');
    expect(only('rotation.adjusted')).toMatchObject({
      target: { type: 'rotation', name: 'Sales', isGone: false },
      params: { person: { kind: 'member', name: 'Bea Rao' }, units: 2 },
    });
    expect(only('rotation.adjustment_undone')).toMatchObject({
      target: { type: 'rotation', name: 'Old team', isGone: true },
      params: { units: -1 },
    });
    expect(only('booking.no_show').target).toEqual({
      type: 'booking',
      id: booking,
      pageTitle: 'Intro call',
      startsAt: '2026-10-24T09:30:00.000000Z',
      isGone: false,
    });
    const purged = view(row('booking.no_show', 'booking', newId()));
    expect(purged.target).toMatchObject({ type: 'booking', isGone: true });
    expect(purged.target).not.toHaveProperty('pageTitle');
    expect(only('routing.changed', 1).target).toMatchObject({ type: 'booking_page', name: 'Intro call' });
  });

  it('reads each variant’s params', () => {
    expect(only('invitation.resent', 0).params).toEqual({});
    expect(only('invitation.resent', 1).params).toEqual({ role: 'admin' });
    expect(only('invitation.accepted', 0).params).toEqual({ via: 'email', role: 'member' });
    expect(only('invitation.accepted', 1).params).toEqual({ via: 'link', role: 'member' });
    expect(only('invitation.accepted', 2)).toMatchObject({
      target: { type: 'invitation' },
      params: { via: 'already_member' },
    });
    expect(only('invitation.link_set', 0).params).toEqual({ change: 'created', role: 'member', fields: [] });
    expect(only('invitation.link_set', 1).params).toEqual({ change: 'reset', role: 'member', fields: [] });
    expect(only('invitation.link_set', 2).params).toEqual({ change: 'changed', fields: ['expires', 'uses'] });
    expect(only('workspace.domains_set').params).toEqual({ added: ['acme.io'], removed: ['acme.com'] });
    expect(only('join_request.approved', 1).params).toEqual({ alreadyMember: true });
    expect(only('workspace.updated', 0).params).toEqual({ fields: ['name'], from: 'Acme', to: 'Acme Ltd' });
    expect(only('workspace.updated', 1).params).toEqual({ fields: ['timeZone', 'address'] });
    expect(only('workspace.deleted').params).toEqual({ purgeAfter: '2026-11-22T06:52:11.123Z' });
    expect(only('workspace_security.changed', 0).params).toEqual({ requireTwoFactor: true });
    expect(only('workspace_security.changed', 1).params).toEqual({ sessionLengthDays: 14 });
    expect(only('workspace_security.changed', 2).params).toEqual({ requireTwoFactor: false, sessionLengthDays: null });
    expect(only('booking.reassigned', 0).params).toMatchObject({
      seats: 1,
      from: { kind: 'member', name: 'Ada Lovelace' },
      to: { kind: 'member', name: 'Bea Rao' },
    });
    expect(only('booking.reassigned', 1).params).toEqual({ seats: 2 });
    expect(only('member.profile_updated', 0).params).toEqual({ isOwn: true, fields: ['name', 'timeZone'] });
    expect(only('member.profile_updated', 1).params).toEqual({ isOwn: false, fields: ['bio'] });
  });

  it('names a social links change, with the links before and after as lists', () => {
    const entry = only('member.profile_updated', 3);
    expect(entry.params).toEqual({ isOwn: true, fields: ['socials'] });
    expect(entry.changes).toEqual([
      {
        field: 'socials',
        before: { kind: 'list', items: ['https://x.com/ada'] },
        after: { kind: 'list', items: ['https://x.com/ada', 'https://ada.dev'] },
      },
    ]);
  });

  it('drops unknown keys: a profile change with no known field left names no field', () => {
    const entry = only('member.profile_updated', 2);
    expect(entry.params).toEqual({ isOwn: true, fields: [] });
    expect(entry.changes).toEqual([]);
    expect(JSON.stringify(entry)).not.toContain('pictureHidden');
    // `version` and `changed` of a routing change, and `replaces` of a link reset, never leave.
    expect(JSON.stringify(only('routing.changed', 0))).not.toMatch(/"version"|"changed":/);
    expect(JSON.stringify(only('invitation.link_set', 1))).not.toContain('replaces');
  });

  it('never names or passes on a linked record', () => {
    for (const action of ['booking.record_linked', 'booking.record_unlinked'] as const) {
      const entry = only(action);
      expect(entry.changes).toEqual([]);
      expect(entry.params).toEqual({});
      expect(JSON.stringify(entry)).not.toContain(record);
    }
  });

  it('says a team change and an access rule in the names stored then, with only the counts of people and fields', () => {
    expect(only('team.changed', 0).params).toEqual({ change: 'created', team: 'Sales', joined: 0, left: 0 });
    expect(only('team.changed', 1).params).toEqual({ change: 'renamed', team: 'Sales', joined: 0, left: 0 });
    expect(only('team.changed', 2).params).toEqual({ change: 'deleted', team: 'Revenue', joined: 0, left: 1 });
    expect(only('team.changed', 3).params).toEqual({ change: 'members', team: 'Sales', joined: 1, left: 0 });
    expect(only('access.rule_set').params).toEqual({
      object: 'Deals',
      who: 'Sales',
      level: 'write',
      records: 'own',
      fields: 1,
      isDefault: false,
    });
    // A level the code doesn't know is no entry rather than a wrong sentence.
    const odd = row('access.rule_set', 'object', newId(), {
      after: { object: 'Deals', level: 'manage', records: 'all' },
    });
    expect(toEntryView(odd, names)).toBeUndefined();
    // The field rules' names are counted, never passed on.
    expect(JSON.stringify(only('access.rule_set'))).not.toContain('Salary');
  });

  it('names a delegation’s delegate, level and whom it is over, and drops a level it doesn’t know', () => {
    expect(only('delegation.granted', 0).params).toEqual({
      level: 'manage',
      over: { kind: 'member', memberId: bea, name: 'Bea Rao', state: 'former' },
    });
    expect(only('delegation.granted', 1).params).toEqual({ level: 'view' });
    expect(only('delegation.changed').params).toMatchObject({ level: 'manage', from: 'view' });
    expect(only('delegation.revoked').params).toEqual({ level: 'view' });
    const unknown = row('delegation.granted', 'member', ada, { after: { level: 'admin', targetType: 'everyone' } });
    expect(toEntryView(unknown, names)).toBeUndefined();
  });

  it('names whose scheduling changed, the write and the schedule, and drops a write it doesn’t know', () => {
    expect(only('schedule.changed')).toMatchObject({
      target: { type: 'member', person: { name: 'Bea Rao' } },
      params: { kind: 'update', schedule: 'Working hours' },
    });
    expect(only('schedule.changed', 1).params).toEqual({ kind: 'create', schedule: 'Summer' });
    expect(only('block.created').params).toEqual({});
    expect(only('booking.changed_for').params).toEqual({
      host: { kind: 'member', memberId: bea, name: 'Bea Rao', state: 'former' },
      change: 'moved',
    });
    const unknown = row('schedule.changed', 'member', bea, { after: { memberId: bea, kind: 'rebuilt' } });
    expect(toEntryView(unknown, names)).toBeUndefined();
  });

  it('types the changes, before and after', () => {
    expect(only('member.role_changed').changes).toEqual([
      { field: 'role', before: { kind: 'role', role: 'member' }, after: { kind: 'role', role: 'admin' } },
    ]);
    expect(only('member.profile_updated', 0).changes).toEqual([
      { field: 'name', before: { kind: 'text', text: 'Ada' }, after: { kind: 'text', text: 'Ada Lovelace' } },
      { field: 'timeZone', after: { kind: 'zone', zone: 'Asia/Kolkata' } },
    ]);
    expect(only('workspace.ownership_transferred').changes).toEqual([
      { field: 'role', before: { kind: 'role', role: 'admin' }, after: { kind: 'role', role: 'owner' } },
      { field: 'actorRole', before: { kind: 'role', role: 'owner' }, after: { kind: 'role', role: 'admin' } },
    ]);
    expect(only('form.owner_changed').changes).toEqual([
      {
        field: 'leadsTo',
        before: { kind: 'person', person: { kind: 'member', memberId: ada, name: 'Ada Lovelace', state: 'active' } },
        after: { kind: 'rotation', name: 'Sales', isGone: false },
      },
    ]);
  });

  it('keeps a deleted account’s profile fields named and their values out (AC-4610)', () => {
    const entry = view(
      row('member.profile_updated', 'member', gone, {
        actor: 'gone',
        before: { name: 'Grace Hopper', bio: 'Admiral' },
        after: { name: 'Grace', bio: 'Rear admiral' },
      }),
    );
    expect(entry.params).toEqual({ isOwn: true, fields: ['name', 'bio'] });
    expect(entry.changes).toEqual([{ field: 'name' }, { field: 'bio' }]);
    expect(JSON.stringify(entry)).not.toMatch(/Grace|Admiral|admiral/);
  });
});

describe('real rows through writeAudit and the names statement', () => {
  const { appUrl } = inject('testDatabase');
  let db: Database;
  beforeAll(() => {
    db = createDatabase({ url: appUrl, applicationName: 'crm-audit-view-tests' });
  });
  afterAll(async () => {
    await db.close();
  });

  it('reads former members, deleted accounts, a deleted round robin and the system as they are now', async () => {
    const created = await createWorkspace(db, {
      name: 'Acme',
      slug: `audit-view-${newId().slice(-12)}`,
      firstMember: { name: 'Ada', email: 'ada@example.com' },
    });
    const { workspaceId, memberId: ownerId } = created;
    const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
    const beaId = newId();
    const graceId = newId();
    const oldTeam = newId();
    await db.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(sql`
        insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values
          (${workspaceId}, ${beaId}, 'Bea', 'bea@example.com', 'member', 'system', 'system'),
          (${workspaceId}, ${graceId}, 'Grace', 'grace@example.com', 'member', 'system', 'system')`);
      await tx.execute(sql`
        insert into rotations (workspace_id, id, name, deleted_at, created_by_type, updated_by_type)
        values (${workspaceId}, ${oldTeam}, 'Old team', now(), 'system', 'system')`);
    });
    // Bea is removed through the service; Grace changes her profile, then deletes her account as the service does.
    await removeMember(owner, { memberId: beaId });
    const write = (actor: Parameters<typeof writeAudit>[2], entry: AuditEntry) =>
      db.withWorkspace(workspaceId, (tx) => writeAudit(tx, workspaceId, actor, entry, { ip: '203.0.113.9' }));
    const grace = { type: 'member', id: graceId } as const;
    await write(grace, {
      action: 'member.profile_updated',
      targetType: 'member',
      targetId: graceId,
      before: { name: 'Grace', secret: 'kept-out' },
      after: { name: 'Grace Hopper', secret: 'kept-out-too' },
    });
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(
        sql`update members set name = 'Deleted user', email = ${deletedEmail(graceId)}, user_id = null where id = ${graceId}`,
      ),
    );
    await write(grace, { action: 'account.deleted', targetType: 'member', targetId: graceId });
    await write(SYSTEM_ACTOR, {
      action: 'join_request.declined',
      targetType: 'join_request',
      targetId: newId(),
      after: { reason: 'account_deleted' },
    });
    await write(
      { type: 'member', id: ownerId },
      { action: 'rotation.adjusted', targetType: 'rotation', targetId: oldTeam, after: { memberId: beaId, units: 1 } },
    );

    const { entries } = await listAuditEvents(owner);
    const by = (action: string) => entries.find((entry) => entry.action === action);
    expect(by('member.removed')).toMatchObject({
      actor: { kind: 'member', memberId: ownerId, name: 'Ada', state: 'active' },
      target: { person: { kind: 'member', memberId: beaId, name: 'Bea', state: 'former' } },
    });
    expect(by('account.deleted')?.actor).toEqual({
      kind: 'member',
      memberId: graceId,
      name: 'Deleted user',
      state: 'deleted',
    });
    const profile = by('member.profile_updated');
    expect(profile).toMatchObject({ params: { isOwn: true, fields: ['name'] }, changes: [{ field: 'name' }] });
    expect(JSON.stringify(profile)).not.toMatch(/Grace|kept-out|secret/);
    expect(by('join_request.declined')).toMatchObject({
      actor: { kind: 'system' },
      params: { reason: 'account_deleted' },
    });
    expect(by('rotation.adjusted')).toMatchObject({
      target: { type: 'rotation', id: oldTeam, name: 'Old team', isGone: true },
      params: { person: { kind: 'member', state: 'former' }, units: 1 },
    });
    for (const entry of entries) expect(() => AuditEntryView.parse(entry)).not.toThrow();
    expect(JSON.stringify(entries)).not.toContain('203.0.113.9');
  });

  it('leaves out a used invitation’s address once the member it made deleted their account', async () => {
    const created = await createWorkspace(db, {
      name: 'Acme',
      slug: `audit-view-${newId().slice(-12)}`,
      firstMember: { name: 'Ada', email: 'ada@example.com' },
    });
    const { workspaceId, memberId: ownerId } = created;
    const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
    const bobId = newId();
    const ceeId = newId();
    const bobInvite = newId();
    const ceeInvite = newId();
    await db.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(sql`
        insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values
          (${workspaceId}, ${bobId}, 'Bob', 'bob@example.com', 'member', 'system', 'system'),
          (${workspaceId}, ${ceeId}, 'Cee', 'cee@example.com', 'member', 'system', 'system')`);
      await tx.execute(sql`
        insert into invitations
          (workspace_id, id, kind, email, role, status, token_hash, max_uses, uses, used_by_member_id,
            created_by_type, updated_by_type)
        values
          (${workspaceId}, ${bobInvite}, 'email', 'bob@personal.example', 'member', 'used', ${'a'.repeat(64)}, 1, 1,
            ${bobId}, 'system', 'system'),
          (${workspaceId}, ${ceeInvite}, 'email', 'cee@personal.example', 'member', 'used', ${'b'.repeat(64)}, 1, 1,
            ${ceeId}, 'system', 'system')`);
      for (const invitation of [bobInvite, ceeInvite]) {
        await writeAudit(
          tx,
          workspaceId,
          { type: 'member', id: ownerId },
          { action: 'invitation.created', targetType: 'invitation', targetId: invitation, after: { role: 'member' } },
        );
      }
      // Bob deletes his account, as account deletion leaves his member row; Cee stays.
      await tx.execute(
        sql`update members set name = 'Deleted user', email = ${deletedEmail(bobId)}, user_id = null where id = ${bobId}`,
      );
    });

    const { entries } = await listAuditEvents(owner);
    const target = (id: string) =>
      entries.find((entry) => entry.target.type === 'invitation' && entry.target.id === id);
    expect(target(bobInvite)?.target).toEqual({ type: 'invitation', id: bobInvite, isLink: false });
    expect(target(ceeInvite)?.target).toEqual({
      type: 'invitation',
      id: ceeInvite,
      email: 'cee@personal.example',
      isLink: false,
    });
    expect(JSON.stringify(entries)).not.toContain('bob@personal.example');
  });
});
