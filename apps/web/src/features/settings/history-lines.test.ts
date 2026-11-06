// Workspace changes in words (spec 0046, AC-4604 to AC-4607): every listed
// action has a sentence and a kind, so a new audited action can't land without
// its words; and every sentence and variant, written out, as a reader sees it.
import { AUDIT_KIND_NAMES, AUDIT_KINDS, AUDIT_NOT_LISTED, type AuditEntryView, type AuditPerson } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  byDay,
  collapseRuns,
  entrySentence,
  kindOf,
  RUN_GAP_MS,
  SENTENCE_ACTIONS,
  whoOf,
  type HistoryFormat,
} from './history-lines.ts';

const format: HistoryFormat = {
  day: (at) => `day(${at.slice(0, 10)})`,
  dayTime: (at) => `dayTime(${at.slice(0, 16)})`,
  // The tests read days in UTC.
  dayKey: (at) => at.slice(0, 10),
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
const managedPage = { type: 'booking_page', id: ID, name: 'Intro call', isGone: false } as const;

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
    { ...base, action: 'workspace.updated', target: workspace, params: { fields: ['keepSubmissions'] } },
    'Ada Lovelace changed the workspace’s form submission retention',
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
    { ...base, action: 'webhook.created', target: workspace, params: { host: 'hooks.example.com' } },
    'Ada Lovelace added the webhook endpoint hooks.example.com',
  ],
  [
    { ...base, action: 'webhook.updated', target: workspace, params: { host: 'hooks.example.com' } },
    'Ada Lovelace changed the webhook endpoint hooks.example.com',
  ],
  [
    { ...base, action: 'webhook.secret_rotated', target: workspace, params: { host: 'hooks.example.com' } },
    'Ada Lovelace rotated the signing secret of hooks.example.com',
  ],
  [
    { ...base, action: 'webhook.deleted', target: workspace, params: { host: 'hooks.example.com' } },
    'Ada Lovelace deleted the webhook endpoint hooks.example.com',
  ],
  [
    { ...base, action: 'webhook.turned_off', target: workspace, params: { host: 'hooks.example.com' } },
    'Ada Lovelace turned off hooks.example.com after 3 days of failed deliveries',
  ],
  [
    { ...base, action: 'insights.share_created', target: workspace, params: { label: 'For the client' } },
    'Ada Lovelace shared Insights in the link For the client',
  ],
  [
    {
      ...base,
      action: 'insights.share_revoked',
      target: workspace,
      params: { label: 'For the client', withMaker: true },
    },
    'Ada Lovelace revoked the Insights link For the client when its maker left',
  ],
  [
    { ...base, action: 'api_key.created', target: workspace, params: { name: 'Zapier' } },
    'Ada Lovelace made the API key Zapier',
  ],
  [
    { ...base, action: 'api_key.revoked', target: workspace, params: { name: 'Zapier' } },
    'Ada Lovelace revoked the API key Zapier',
  ],
  [
    { ...base, action: 'api_key.restored', target: workspace, params: { name: 'Zapier' } },
    'Ada Lovelace brought back the API key Zapier',
  ],
  // Spec 0070: a connected app.
  [
    { ...base, action: 'partner.connected', target: workspace, params: { name: 'Hub', modules: ['link_pages'] } },
    'Ada Lovelace connected Hub for Link pages',
  ],
  [
    {
      ...base,
      action: 'partner.modules_changed',
      target: workspace,
      params: { name: 'Hub', modules: ['link_pages'] },
    },
    'Ada Lovelace changed what Hub can use to Link pages',
  ],
  [
    { ...base, action: 'partner.disconnected', target: workspace, params: { name: 'Hub', modules: ['link_pages'] } },
    'Ada Lovelace disconnected Hub',
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
    'Ada Lovelace undid a −1 adjustment to Bea Rao’s count in a round robin (since deleted)',
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
    { ...base, action: 'routing.settings_changed', target: workspace, params: {} },
    'Ada Lovelace changed the routing settings',
  ],
  [{ ...base, action: 'routing.skills_changed', target: workspace, params: {} }, 'Ada Lovelace changed routing skills'],
  [{ ...base, action: 'routing.tested', target: workspace, params: {} }, 'Ada Lovelace tested routing'],
  [{ ...base, action: 'form.created', target: form, params: {} }, 'Ada Lovelace made the form Contact us'],
  // Never "made the form a deleted form" (critic A, 5 November 2026).
  [
    { ...base, action: 'form.created', target: { type: 'form', id: ID, isGone: true }, params: {} },
    'Ada Lovelace made a form (since deleted)',
  ],
  [
    { ...base, action: 'form.exported', target: { type: 'form', id: ID, name: 'Old', isGone: true }, params: {} },
    'Ada Lovelace exported the submissions of a form (since deleted)',
  ],
  [
    { ...base, action: 'form.exported', target: form, params: {} },
    'Ada Lovelace exported the submissions of Contact us',
  ],
  [
    { ...base, action: 'form.submissions_deleted', target: form, params: { submissions: 3 } },
    'Ada Lovelace deleted 3 submissions of Contact us',
  ],
  [
    { ...base, action: 'form.submissions_deleted', target: form, params: { submissions: 1 } },
    'Ada Lovelace deleted a submission of Contact us',
  ],
  [
    { ...base, action: 'form.submissions_restored', target: form, params: { submissions: 3 } },
    'Ada Lovelace restored 3 submissions of Contact us',
  ],
  [
    { ...base, action: 'form.submissions_restored', target: form, params: { submissions: 1 } },
    'Ada Lovelace restored a submission of Contact us',
  ],
  [
    { ...base, action: 'form.owner_changed', target: form, params: {} },
    'Ada Lovelace changed who gets Contact us’s leads',
  ],
  [
    { ...base, action: 'form.notify_changed', target: form, params: {} },
    'Ada Lovelace changed who is emailed Contact us’s new submissions',
  ],
  [
    { ...base, action: 'list.created', target: { type: 'list', id: ID, name: 'Sales', isGone: false }, params: {} },
    'Ada Lovelace made the list Sales',
  ],
  [
    { ...base, action: 'list.updated', target: { type: 'list', id: ID, name: 'Sales', isGone: false }, params: {} },
    'Ada Lovelace changed the list Sales',
  ],
  [
    { ...base, action: 'list.archived', target: { type: 'list', id: ID, name: 'Sales', isGone: false }, params: {} },
    'Ada Lovelace archived the list Sales',
  ],
  [
    { ...base, action: 'list.restored', target: { type: 'list', id: ID, isGone: true }, params: {} },
    'Ada Lovelace restored a list (since deleted)',
  ],
  [
    { ...base, action: 'list.archived', target: { type: 'list', id: ID, isGone: false }, params: {} },
    'Ada Lovelace archived a list',
  ],
  [
    { ...base, action: 'booking.no_show', target: booking, params: {} },
    'Ada Lovelace marked Intro call on dayTime(2026-10-24T09:30) as a no show',
  ],
  [
    { ...base, action: 'booking.no_show_undone', target: { type: 'booking', id: ID, isGone: true }, params: {} },
    'Ada Lovelace took back the no show on a booking (since deleted)',
  ],
  [
    { ...base, action: 'booking.record_linked', target: booking, params: {} },
    'Ada Lovelace linked Intro call on dayTime(2026-10-24T09:30) to a record',
  ],
  [
    { ...base, actor: { kind: 'unknown' }, action: 'booking.record_unlinked', target: booking, params: {} },
    'Unknown person unlinked a record from Intro call on dayTime(2026-10-24T09:30)',
  ],
  [
    { ...base, actor: { kind: 'unknown' }, action: 'booking.meeting_link_set', target: booking, params: {} },
    'Unknown person added a meeting link to Intro call on dayTime(2026-10-24T09:30)',
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
    'Ada Lovelace now lets Bea Rao manage a deleted user’s scheduling',
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
    { ...base, action: 'limits.changed', target: member(bea), params: {} },
    'Ada Lovelace changed Bea Rao’s meeting limits',
  ],
  [
    { ...base, action: 'calendar.reconnect_asked', target: member(bea), params: {} },
    'Ada Lovelace asked Bea Rao to reconnect their calendar',
  ],
  [
    { ...base, action: 'booking.changed_for', target: booking, params: { host: bea, change: 'moved' } },
    'Ada Lovelace moved Intro call on dayTime(2026-10-24T09:30) for Bea Rao',
  ],
  [
    { ...base, action: 'booking.changed_for', target: booking, params: { host: bea, change: 'made' } },
    'Ada Lovelace booked Intro call on dayTime(2026-10-24T09:30) for Bea Rao',
  ],
  [
    { ...base, action: 'automation.changed', target: workspace, params: { change: 'created', object: 'Deals' } },
    'Ada Lovelace made an automation for Deals',
  ],
  [
    { ...base, action: 'automation.changed', target: workspace, params: { change: 'disabled', object: 'tasks' } },
    'Ada Lovelace switched off an automation for tasks',
  ],
  [
    {
      ...base,
      action: 'team.changed',
      target: workspace,
      params: { change: 'created', team: 'Sales', joined: 2, left: 0 },
    },
    'Ada Lovelace made the Sales team',
  ],
  // Custom roles (spec 0037).
  [
    { ...base, action: 'role.created', target: workspace, params: { role: 'Sales lead' } },
    'Ada Lovelace made the Sales lead role',
  ],
  [
    { ...base, action: 'role.updated', target: workspace, params: { role: 'Sales lead', added: 1, removed: 0 } },
    'Ada Lovelace changed the Sales lead role',
  ],
  [
    { ...base, action: 'role.deleted', target: workspace, params: { role: 'Doctor', moved: 3 } },
    'Ada Lovelace deleted the Doctor role and moved 3 people',
  ],
  [
    { ...base, action: 'role.default_changed', target: workspace, params: { role: 'Sales lead' } },
    'Ada Lovelace made Sales lead the role new people get',
  ],
  [
    {
      ...base,
      action: 'team.changed',
      target: workspace,
      params: { change: 'renamed', team: 'Sales', joined: 0, left: 0 },
      changes: [{ field: 'name', after: { kind: 'text', text: 'Revenue' } }],
    },
    'Ada Lovelace renamed the Sales team to Revenue',
  ],
  [
    {
      ...base,
      action: 'team.changed',
      target: workspace,
      params: { change: 'deleted', team: 'Sales', joined: 0, left: 3 },
    },
    'Ada Lovelace deleted the Sales team',
  ],
  [
    {
      ...base,
      action: 'team.changed',
      target: workspace,
      params: { change: 'members', team: 'Sales', joined: 1, left: 2 },
    },
    'Ada Lovelace changed who is in the Sales team',
  ],
  [
    {
      ...base,
      action: 'access.rule_set',
      target: workspace,
      params: { object: 'Deals', who: 'Sales', level: 'write', records: 'own', fields: 2, isDefault: false },
    },
    'Ada Lovelace changed access to Deals: Sales can edit, their own only, 2 fields limited',
  ],
  [
    {
      ...base,
      action: 'access.rule_set',
      target: workspace,
      params: { object: 'Deals', who: 'Members', level: 'none', records: 'all', fields: 0, isDefault: false },
    },
    'Ada Lovelace changed access to Deals: Members can’t see',
  ],
  [
    {
      ...base,
      action: 'access.rule_set',
      target: workspace,
      params: { object: 'Deals', who: 'Members', level: 'write', records: 'all', fields: 0, isDefault: true },
    },
    'Ada Lovelace set Members back to the default access to Deals',
  ],
  [
    {
      ...base,
      action: 'booking_page.changed_for',
      target: member(bea),
      params: { page: 'Intro call', deleted: false },
    },
    'Ada Lovelace changed Bea Rao’s “Intro call” page',
  ],
  [
    { ...base, action: 'booking_page.changed_for', target: member(bea), params: { page: 'Intro call', deleted: true } },
    'Ada Lovelace deleted Bea Rao’s “Intro call” page',
  ],
  [
    { ...base, action: 'rotation.changed', target: rotation, params: { added: 1, removed: 0 } },
    'Ada Lovelace changed who is in Sales',
  ],
  [
    { ...base, action: 'editors.changed', target: rotation, params: { added: 1, removed: 0 } },
    'Ada Lovelace changed who can edit Sales',
  ],
  [
    { ...base, action: 'managed_page.changed', target: managedPage, params: { added: 0, removed: 0 } },
    'Ada Lovelace changed the Intro call managed page',
  ],
  [
    {
      ...base,
      action: 'managed_page.changed',
      target: { type: 'booking_page', id: ID, isGone: true },
      params: { added: 0, removed: 0 },
    },
    'Ada Lovelace changed a managed page (since deleted)',
  ],
  [
    { ...base, action: 'managed_page.changed', target: managedPage, params: { added: 2, removed: 1 } },
    'Ada Lovelace changed who has the Intro call managed page (2 added, 1 taken off)',
  ],
  [
    { ...base, action: 'booking_page.published', target: managedPage, params: { version: 3 } },
    'Ada Lovelace published Intro call (version 3)',
  ],
  [
    { ...base, action: 'booking_page.draft_discarded', target: managedPage, params: {} },
    'Ada Lovelace discarded the draft of Intro call',
  ],
  [
    { ...base, action: 'booking_page.version_restored', target: managedPage, params: { version: 2 } },
    'Ada Lovelace restored version 2 of Intro call as its draft',
  ],
  [
    { ...base, action: 'link_page.published', target: member(bea), params: { version: 4 } },
    'Ada Lovelace published Bea Rao’s link page (version 4)',
  ],
  [
    { ...base, action: 'link_page.draft_discarded', target: member(bea), params: {} },
    'Ada Lovelace discarded the draft of Bea Rao’s link page',
  ],
  [
    { ...base, action: 'link_page.version_restored', target: member(bea), params: { version: 1 } },
    'Ada Lovelace restored version 1 of Bea Rao’s link page as its draft',
  ],
  // Spec 0070, AC-7004: someone else's link page, changed by a team page manager.
  [
    { ...base, action: 'link_page.changed_for', target: member(bea), params: { change: 'blocks' } },
    'Ada Lovelace edited Bea Rao’s link page',
  ],
  [
    { ...base, action: 'link_page.changed_for', target: member(bea), params: { change: 'live' } },
    'Ada Lovelace turned Bea Rao’s link page Live',
  ],
  [
    { ...base, action: 'link_page.changed_for', target: member(bea), params: { change: 'handle', handle: 'bea' } },
    'Ada Lovelace claimed /bea for Bea Rao',
  ],
  [
    { ...base, action: 'managed_page.propagated', target: managedPage, params: {} },
    'Ada Lovelace updated Intro call from its managed page',
  ],
  [
    { ...base, action: 'booking_page.link_created', target: managedPage, params: {} },
    'Ada Lovelace made a one-time link for Intro call',
  ],
  [
    { ...base, action: 'booking_page.link_revoked', target: managedPage, params: {} },
    'Ada Lovelace revoked a one-time link for Intro call',
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

describe('no sentence names a deleted thing twice (critic A, 5 November 2026)', () => {
  it('never reads "the form a deleted form" or "a deleted" anywhere', () => {
    for (const [entry] of SENTENCES) {
      const gone =
        'isGone' in entry.target
          ? ({ ...entry, target: { type: entry.target.type, id: ID, isGone: true } } as AuditEntryView)
          : entry;
      const { full } = entrySentence(gone, format);
      expect(full).not.toMatch(/the (form|list|round robin|booking page|managed page) a /);
      expect(full).not.toMatch(/a deleted (form|list|round robin|booking page|booking)\b/);
    }
  });
});

describe('collapseRuns', () => {
  const at = (minutes: number) => new Date(Date.parse('2026-11-05T12:00:00Z') - minutes * 60_000).toISOString();
  const sales = { type: 'list', id: ID, name: 'Sales', isGone: false } as const;
  const saved = (id: string, minutes: number, actor: AuditPerson = ada): AuditEntryView => ({
    ...base,
    id,
    at: at(minutes),
    actor,
    action: 'list.updated',
    target: sales,
    params: {},
  });

  it('collapses the same change by the same person, close together, into one row with a count', () => {
    const rows = collapseRuns([saved('a', 0), saved('b', 5), saved('c', 9)], format);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('a');
    expect(rows[0]?.count).toBe(3);
    expect(rows[0]?.sentence).toEqual({
      full: 'Ada Lovelace changed the list Sales 3 times',
      change: 'Changed the list Sales 3 times',
    });
  });

  it('keeps apart another person’s change, a different sentence, and a repeat more than the gap later', () => {
    const roleChange = (id: string, to: 'admin' | 'member'): AuditEntryView => ({
      ...base,
      id,
      at: at(1),
      action: 'member.role_changed',
      target: member(bea),
      params: { from: 'guest', to },
    });
    expect(collapseRuns([saved('a', 0), saved('b', 1, bea)], format).map((row) => row.count)).toEqual([1, 1]);
    expect(collapseRuns([roleChange('a', 'admin'), roleChange('b', 'member')], format)).toHaveLength(2);
    const late = RUN_GAP_MS / 60_000 + 1;
    expect(collapseRuns([saved('a', 0), saved('b', late)], format)).toHaveLength(2);
  });

  it('never folds a run across midnight, so each day holds its own', () => {
    const atMidnight = (id: string, iso: string): AuditEntryView => ({ ...saved(id, 0), at: iso });
    const rows = collapseRuns(
      [atMidnight('a', '2026-11-05T00:05:00Z'), atMidnight('b', '2026-11-04T23:55:00Z')],
      format,
    );
    expect(rows.map((row) => row.count)).toEqual([1, 1]);
  });

  it('counts a run only while it is unbroken', () => {
    const other = { ...saved('x', 2), action: 'list.archived' } as AuditEntryView;
    expect(collapseRuns([saved('a', 0), other, saved('b', 3)], format).map((row) => row.count)).toEqual([1, 1, 1]);
  });
});

describe('byDay', () => {
  const entry = (id: string, when: string): AuditEntryView => ({
    ...base,
    id,
    at: when,
    action: 'routing.tested',
    target: workspace,
    params: {},
  });
  const rows = (...entries: AuditEntryView[]) => collapseRuns(entries, format, 0);

  it('heads today’s rows Today, yesterday’s Yesterday, and older ones with their day', () => {
    const days = byDay(
      rows(
        entry('a', '2026-11-05T09:00:00Z'),
        entry('b', '2026-11-05T08:00:00Z'),
        entry('c', '2026-11-04T23:00:00Z'),
        entry('d', '2026-10-30T10:00:00Z'),
      ),
      format,
      '2026-11-05T12:00:00Z',
    );
    expect(days.map((day) => [day.label, day.rows.map((row) => row.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['day(2026-10-30)', ['d']],
    ]);
  });

  it('turns over a month', () => {
    const days = byDay(rows(entry('a', '2026-11-30T10:00:00Z')), format, '2026-12-01T09:00:00Z');
    expect(days[0]?.label).toBe('Yesterday');
  });

  it('has no days for no rows', () => {
    expect(byDay([], format, '2026-11-05T12:00:00Z')).toEqual([]);
  });
});
