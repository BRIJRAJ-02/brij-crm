// Workspace changes in words (spec 0046, AC-4604 to AC-4607): every listed
// action has a sentence and a kind, so a new audited action can't land without
// its words; and every sentence and variant, written out, as a reader sees it.
import { AUDIT_KIND_NAMES, AUDIT_KINDS, AUDIT_NOT_LISTED, type AuditEntryView, type AuditPerson } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { entrySentence, kindOf, SENTENCE_ACTIONS, whoOf, type HistoryFormat } from './history-lines.ts';

const format: HistoryFormat = {
  day: (at) => `day(${at.slice(0, 10)})`,
  dayTime: (at) => `dayTime(${at.slice(0, 16)})`,
};

const ada: AuditPerson = {
  kind: 'member',
  memberId: '0199f0a0-0000-7000-8000-000000000001',
  name: 'Ada Lovelace',
  state: 'active',
};
const bea: AuditPerson = {
  kind: 'member',
  memberId: '0199f0a0-0000-7000-8000-000000000002',
  name: 'Bea Rao',
  state: 'former',
};
const gone: AuditPerson = {
  kind: 'member',
  memberId: '0199f0a0-0000-7000-8000-000000000003',
  name: 'Deleted user',
  state: 'deleted',
};
const ID = '0199f0a0-0000-7000-8000-0000000000ff';
const base = { id: ID, at: '2026-10-23T06:52:11.123456Z', actor: ada, changes: [] };
const invite = { type: 'invitation', id: ID, email: 'grace@example.com', isLink: false } as const;
const link = { type: 'invitation', id: ID, isLink: true } as const;
const member = (person: AuditPerson) => ({ type: 'member', person }) as const;
const workspace = { type: 'workspace' } as const;
const booking = {
  type: 'booking',
  id: ID,
  pageTitle: 'Intro call',
  startsAt: '2026-10-24T09:30:00.000000Z',
  isGone: false,
} as const;
const rotation = { type: 'rotation', id: ID, name: 'Sales', isGone: false } as const;
const form = { type: 'form', id: ID, name: 'Contact us', isGone: false } as const;

/** Every sentence and variant, with the words a reader sees (the Who column's name first). */
const SENTENCES: readonly (readonly [AuditEntryView, string])[] = [
  [
    { ...base, action: 'invitation.created', target: invite, params: { role: 'admin' } },
    'Ada Lovelace invited grace@example.com as Admin',
  ],
  [
    { ...base, action: 'invitation.resent', target: invite, params: {} },
    'Ada Lovelace resent the invitation to grace@example.com',
  ],
  [
    { ...base, action: 'invitation.resent', target: invite, params: { role: 'member' } },
    'Ada Lovelace resent the invitation to grace@example.com, now as Member',
  ],
  [
    { ...base, action: 'invitation.revoked', target: invite, params: {} },
    'Ada Lovelace cancelled the invitation to grace@example.com',
  ],
  [
    {
      ...base,
      actor: bea,
      action: 'invitation.accepted',
      target: member(bea),
      params: { via: 'email', role: 'member' },
    },
    'Bea Rao accepted the invitation and joined as Member',
  ],
  [
    {
      ...base,
      actor: bea,
      action: 'invitation.accepted',
      target: member(bea),
      params: { via: 'link', role: 'member' },
    },
    'Bea Rao joined through the invite link as Member',
  ],
  [
    { ...base, action: 'invitation.accepted', target: invite, params: { via: 'already_member' } },
    'Ada Lovelace used the invitation to grace@example.com and was already a member',
  ],
  [
    { ...base, action: 'invitation.link_set', target: link, params: { change: 'created', role: 'member', fields: [] } },
    'Ada Lovelace turned on the invite link, joining as Member',
  ],
  [
    { ...base, action: 'invitation.link_set', target: link, params: { change: 'reset', fields: [] } },
    'Ada Lovelace made a new invite link, and the old one stopped working',
  ],
  [
    {
      ...base,
      action: 'invitation.link_set',
      target: link,
      params: { change: 'changed', fields: ['expires', 'uses'] },
    },
    'Ada Lovelace changed the invite link’s expiry and number of uses',
  ],
  [{ ...base, action: 'invitation.link_revoked', target: link, params: {} }, 'Ada Lovelace turned off the invite link'],
  [
    {
      ...base,
      action: 'workspace.domains_set',
      target: workspace,
      params: { added: ['acme.io'], removed: ['acme.com'] },
    },
    'Ada Lovelace changed the email domains that can ask to join: added acme.io, removed acme.com',
  ],
  [
    { ...base, action: 'workspace.domains_set', target: workspace, params: { added: ['a.io', 'b.io'], removed: [] } },
    'Ada Lovelace changed the email domains that can ask to join: added a.io and b.io',
  ],
  [
    {
      ...base,
      actor: { kind: 'asker', name: 'Cy Young' },
      action: 'join_request.created',
      target: { type: 'join_request', id: ID, name: 'Cy Young' },
      params: {},
    },
    'Cy Young asked to join the workspace',
  ],
  [
    { ...base, action: 'join_request.approved', target: member(bea), params: { alreadyMember: false } },
    'Ada Lovelace let Bea Rao join as Member',
  ],
  [
    { ...base, action: 'join_request.approved', target: member(bea), params: { alreadyMember: true } },
    'Ada Lovelace approved Bea Rao’s request, and they were already a member',
  ],
  [
    {
      ...base,
      action: 'join_request.declined',
      target: { type: 'join_request', id: ID, name: 'Cy Young' },
      params: {},
    },
    'Ada Lovelace declined Cy Young’s request to join',
  ],
  [
    {
      ...base,
      actor: { kind: 'system' },
      action: 'join_request.declined',
      target: { type: 'join_request', id: ID, name: 'Deleted user' },
      params: { reason: 'account_deleted' },
    },
    'Deleted user’s request to join closed when they deleted their account',
  ],
  [
    { ...base, action: 'member.role_changed', target: member(bea), params: { from: 'member', to: 'admin' } },
    'Ada Lovelace changed Bea Rao’s role from Member to Admin',
  ],
  [
    { ...base, action: 'member.role_changed', target: member(gone), params: { from: 'admin', to: 'member' } },
    'Ada Lovelace changed a deleted user’s role from Admin to Member',
  ],
  [
    { ...base, action: 'member.removed', target: member(bea), params: {} },
    'Ada Lovelace removed Bea Rao from the workspace',
  ],
  [
    { ...base, action: 'member.removed', target: member({ kind: 'unknown' }), params: {} },
    'Ada Lovelace removed a former member from the workspace',
  ],
  [
    { ...base, action: 'member.removed', target: member(gone), params: {} },
    'Ada Lovelace removed a deleted user from the workspace',
  ],
  [{ ...base, actor: bea, action: 'member.left', target: member(bea), params: {} }, 'Bea Rao left the workspace'],
  [
    { ...base, action: 'workspace.ownership_transferred', target: member(bea), params: {} },
    'Ada Lovelace made Bea Rao an owner, and became an admin',
  ],
  [
    { ...base, actor: gone, action: 'account.deleted', target: member(gone), params: {} },
    'Deleted user deleted their account and left the workspace',
  ],
  [
    {
      ...base,
      action: 'member.profile_updated',
      target: member(ada),
      params: { isOwn: true, fields: ['name', 'timeZone'] },
    },
    'Ada Lovelace changed their name and time zone',
  ],
  [
    {
      ...base,
      action: 'member.profile_updated',
      target: member(bea),
      params: { isOwn: false, fields: ['handle', 'bio', 'name'] },
    },
    'Ada Lovelace changed Bea Rao’s public handle, bio and name',
  ],
  [
    { ...base, action: 'member.profile_updated', target: member(ada), params: { isOwn: true, fields: [] } },
    'Ada Lovelace changed their profile',
  ],
  [
    { ...base, action: 'member.profile_updated', target: member(bea), params: { isOwn: false, fields: [] } },
    'Ada Lovelace changed Bea Rao’s profile',
  ],
  [
    {
      ...base,
      action: 'workspace.updated',
      target: workspace,
      params: { fields: ['name'], from: 'Acme', to: 'Acme Ltd' },
    },
    'Ada Lovelace renamed the workspace from Acme to Acme Ltd',
  ],
  [
    { ...base, action: 'workspace.updated', target: workspace, params: { fields: ['timeZone', 'address'] } },
    'Ada Lovelace changed the workspace’s time zone and address',
  ],
  [
    { ...base, action: 'workspace.deleted', target: workspace, params: { purgeAfter: '2026-11-22T06:52:11.123Z' } },
    'Ada Lovelace deleted the workspace, to be gone for good on day(2026-11-22)',
  ],
  [{ ...base, action: 'workspace.restored', target: workspace, params: {} }, 'Ada Lovelace restored the workspace'],
  [
    { ...base, action: 'workspace_security.changed', target: workspace, params: { requireTwoFactor: true } },
    'Ada Lovelace turned on required two factor sign in',
  ],
  [
    { ...base, action: 'workspace_security.changed', target: workspace, params: { requireTwoFactor: false } },
    'Ada Lovelace turned off required two factor sign in',
  ],
  [
    { ...base, action: 'workspace_security.changed', target: workspace, params: { sessionLengthDays: 14 } },
    'Ada Lovelace set sessions to end after 14 days',
  ],
  [
    { ...base, action: 'workspace_security.changed', target: workspace, params: { sessionLengthDays: null } },
    'Ada Lovelace removed the session limit',
  ],
  [
    {
      ...base,
      action: 'workspace_security.changed',
      target: workspace,
      params: { requireTwoFactor: true, sessionLengthDays: 7 },
    },
    'Ada Lovelace changed the sign in rules',
  ],
  [
    { ...base, action: 'workspace_security.signed_out_everyone', target: workspace, params: {} },
    'Ada Lovelace signed everyone out of the workspace',
  ],
  [
    { ...base, action: 'rotation.adjusted', target: rotation, params: { person: bea, units: 2 } },
    'Ada Lovelace adjusted Bea Rao’s count in Sales by +2',
  ],
  [
    {
      ...base,
      action: 'rotation.adjustment_undone',
      target: { ...rotation, isGone: true },
      params: { person: bea, units: -1 },
    },
    'Ada Lovelace undid a −1 adjustment to Bea Rao’s count in a deleted round robin',
  ],
  [
    { ...base, action: 'booking.reassigned', target: booking, params: { seats: 1, from: ada, to: bea } },
    'Ada Lovelace reassigned Intro call on dayTime(2026-10-24T09:30) from Ada Lovelace to Bea Rao',
  ],
  [
    { ...base, action: 'booking.reassigned', target: booking, params: { seats: 2 } },
    'Ada Lovelace reassigned 2 seats of Intro call on dayTime(2026-10-24T09:30)',
  ],
  [
    { ...base, action: 'routing.changed', target: form, params: {} },
    'Ada Lovelace published Contact us with changed routing rules',
  ],
  [
    {
      ...base,
      action: 'routing.changed',
      target: { type: 'booking_page', id: ID, name: 'Intro call', isGone: false },
      params: {},
    },
    'Ada Lovelace changed the routing rules of Intro call',
  ],
  [
    { ...base, action: 'form.owner_changed', target: form, params: {} },
    'Ada Lovelace changed who gets Contact us’s leads',
  ],
  [
    { ...base, action: 'booking.no_show', target: booking, params: {} },
    'Ada Lovelace marked Intro call on dayTime(2026-10-24T09:30) as a no show',
  ],
  [
    { ...base, action: 'booking.no_show_undone', target: { type: 'booking', id: ID, isGone: true }, params: {} },
    'Ada Lovelace took back the no show on a deleted booking',
  ],
  [
    { ...base, action: 'booking.record_linked', target: booking, params: {} },
    'Ada Lovelace linked Intro call on dayTime(2026-10-24T09:30) to a record',
  ],
  [
    { ...base, actor: { kind: 'unknown' }, action: 'booking.record_unlinked', target: booking, params: {} },
    'Unknown person unlinked a record from Intro call on dayTime(2026-10-24T09:30)',
  ],
  // Scheduling access (spec 0037, AC-1257): over one person, or everyone's.
  [
    { ...base, action: 'delegation.granted', target: member(bea), params: { level: 'manage', over: ada } },
    'Ada Lovelace let Bea Rao manage Ada Lovelace’s scheduling',
  ],
  [
    { ...base, action: 'delegation.granted', target: member(bea), params: { level: 'view' } },
    'Ada Lovelace let Bea Rao see everyone’s scheduling',
  ],
  [
    {
      ...base,
      action: 'delegation.changed',
      target: member(bea),
      params: { level: 'manage', from: 'view', over: gone },
    },
    'Ada Lovelace changed what Bea Rao can do with a deleted user’s scheduling to manage it',
  ],
  [
    { ...base, action: 'delegation.revoked', target: member(bea), params: { level: 'view' } },
    'Ada Lovelace stopped Bea Rao being able to see everyone’s scheduling',
  ],
  // Someone's scheduling changed (spec 0037, AC-1263).
  [
    {
      ...base,
      action: 'schedule.changed',
      target: member(bea),
      params: { kind: 'update', schedule: 'Working hours' },
    },
    'Ada Lovelace changed Bea Rao’s “Working hours” schedule',
  ],
  [
    { ...base, action: 'schedule.changed', target: member(bea), params: { kind: 'create', schedule: 'Summer' } },
    'Ada Lovelace made Bea Rao’s “Summer” schedule',
  ],
  [
    { ...base, action: 'schedule.changed', target: member(bea), params: { kind: 'set_default', schedule: 'Summer' } },
    'Ada Lovelace made “Summer” Bea Rao’s default schedule',
  ],
  [
    { ...base, action: 'schedule.changed', target: member(bea), params: { kind: 'delete', schedule: 'Summer' } },
    'Ada Lovelace deleted Bea Rao’s “Summer” schedule',
  ],
  [
    { ...base, action: 'schedule.changed', target: member(bea), params: { kind: 'duplicate', schedule: 'Copy' } },
    'Ada Lovelace copied one of Bea Rao’s schedules as “Copy”',
  ],
  [
    { ...base, action: 'schedule.changed', target: member(bea), params: { kind: 'default_hours' } },
    'Ada Lovelace changed Bea Rao’s hours',
  ],
  [
    { ...base, action: 'block.created', target: member(bea), params: {} },
    'Ada Lovelace blocked time on Bea Rao’s calendar',
  ],
  [
    { ...base, action: 'block.removed', target: member(bea), params: {} },
    'Ada Lovelace removed a block from Bea Rao’s calendar',
  ],
  [{ ...base, action: 'time_off.created', target: member(bea), params: {} }, 'Ada Lovelace added time off for Bea Rao'],
  [{ ...base, action: 'time_off.changed', target: member(bea), params: {} }, 'Ada Lovelace changed Bea Rao’s time off'],
  [{ ...base, action: 'time_off.deleted', target: member(bea), params: {} }, 'Ada Lovelace removed Bea Rao’s time off'],
  [
    { ...base, action: 'booking.changed_for', target: booking, params: { host: bea, change: 'moved' } },
    'Ada Lovelace moved Intro call on dayTime(2026-10-24T09:30) for Bea Rao',
  ],
  [
    { ...base, action: 'booking.changed_for', target: booking, params: { host: bea, change: 'made' } },
    'Ada Lovelace booked Intro call on dayTime(2026-10-24T09:30) for Bea Rao',
  ],
];

describe('every listed action', () => {
  const listed = AUDIT_KIND_NAMES.flatMap((kind) => [...AUDIT_KINDS[kind]]);

  it('has a sentence and a kind, and nothing else has a sentence', () => {
    expect([...SENTENCE_ACTIONS].sort()).toEqual([...listed].sort());
    for (const action of listed) expect(kindOf(action)).toBeDefined();
    for (const action of AUDIT_NOT_LISTED) {
      expect(SENTENCE_ACTIONS).not.toContain(action);
      expect(kindOf(action)).toBeUndefined();
    }
  });

  it('is written out below at least once', () => {
    expect(new Set(SENTENCES.map(([entry]) => entry.action))).toEqual(new Set(listed));
  });
});

describe('entrySentence', () => {
  it.each(SENTENCES.map(([entry, words]) => [entry.action, words, entry] as const))(
    '%s: %s',
    (_action, words, entry) => {
      expect(entrySentence(entry, format).full).toBe(words);
    },
  );

  it('shows the Change column from the word after the actor, capitalised, and the whole sentence when no actor leads', () => {
    const [renamed] = SENTENCES.find(([entry]) => entry.action === 'workspace.updated') ?? [];
    if (renamed === undefined) throw new Error('No rename.');
    expect(entrySentence(renamed, format)).toEqual({
      full: 'Ada Lovelace renamed the workspace from Acme to Acme Ltd',
      change: 'Renamed the workspace from Acme to Acme Ltd',
    });
    const closed = SENTENCES.find(
      ([entry]) => entry.action === 'join_request.declined' && entry.actor.kind === 'system',
    )?.[0];
    if (closed === undefined) throw new Error('No closed request.');
    const sentence = entrySentence(closed, format);
    expect(sentence.change).toBe(sentence.full);
  });
});

describe('a row this page doesn’t know yet', () => {
  it('reads as a plain change rather than failing, and names an unknown actor as an unknown person', () => {
    const newer = {
      ...base,
      action: 'booking_page.profile_reordered',
      target: workspace,
      params: {},
    } as unknown as AuditEntryView;
    expect(entrySentence(newer, format)).toEqual({ full: 'Ada Lovelace made a change', change: 'Made a change' });
    expect(whoOf({ kind: 'robot' } as unknown as AuditPerson)).toEqual({ name: 'Unknown person' });
  });
});

describe('whoOf', () => {
  it('names the actor with what happened to them (AC-4606)', () => {
    expect(whoOf(ada)).toEqual({ name: 'Ada Lovelace' });
    expect(whoOf(bea)).toEqual({ name: 'Bea Rao', badge: 'Former member' });
    expect(whoOf(gone)).toEqual({ name: 'Deleted user' });
    expect(whoOf({ kind: 'system' })).toEqual({ name: 'System' });
    expect(whoOf({ kind: 'api_key' })).toEqual({ name: 'API key' });
    expect(whoOf({ kind: 'unknown' })).toEqual({ name: 'Unknown person' });
    expect(whoOf({ kind: 'asker', name: 'Cy Young' })).toEqual({ name: 'Cy Young', badge: 'Asked to join' });
  });
});
