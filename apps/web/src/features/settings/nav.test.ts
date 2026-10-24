// The settings navigation (spec 0026, AC-682, AC-686, AC-687): its groups in
// order, groups left out when the member may open none of their pages, and
// which page an address marks current.
import { describe, expect, it } from 'vitest';
import type { Permission } from '@crm/data';
import {
  calendarSettingsHref,
  historyHref,
  preferencesHref,
  settingsGroupOf,
  settingsNav,
  settingsPageOf,
  visibleSettingsNav,
  type SettingsNavGroup,
} from './nav.ts';

describe('settingsNav', () => {
  it('lists Account, Scheduling, Workspace and Super admin, in order, with their pages', () => {
    const groups = settingsNav('acme');
    expect(groups.map((group) => group.label)).toEqual(['Account', 'Scheduling', 'Workspace', 'Super admin']);
    expect(groups.map((group) => group.entries.map((entry) => entry.label))).toEqual([
      ['Profile', 'Preferences', 'Sign in and devices', 'Notifications'],
      ['Calendars', 'Round robin'],
      ['General', 'Members', 'Security', 'Objects', 'Background jobs', 'History', 'Trash'],
      ['Overview', 'Users', 'Booking pages', 'Website'],
    ]);
  });

  it('puts Calendars under Scheduling, and every entry opens a page in Settings', () => {
    const entries = settingsNav('acme').flatMap((group) => group.entries);
    expect(Object.fromEntries(entries.map((entry) => [entry.id, entry.href]))).toEqual({
      profile: '/w/acme/settings/account/profile',
      preferences: '/w/acme/settings/account/preferences',
      calendars: '/w/acme/settings/scheduling/calendars',
      notifications: '/w/acme/settings/account/notifications',
      general: '/w/acme/settings/general',
      security: '/w/acme/settings/account/sign-in',
      members: '/w/acme/settings/members',
      'workspace-security': '/w/acme/settings/security',
      objects: '/w/acme/settings/objects',
      jobs: '/w/acme/settings/jobs',
      history: '/w/acme/settings/history',
      rotations: '/w/acme/settings/scheduling/round-robin',
      // The trash opens inside Settings, its sidebar and trail kept (A120, 23 October 2026).
      trash: '/w/acme/settings/trash',
      // The operator console (spec 0047).
      'admin-overview': '/w/acme/settings/admin',
      'admin-users': '/w/acme/settings/admin/users',
      'admin-pages': '/w/acme/settings/admin/booking-pages',
      'admin-website': '/w/acme/settings/admin/website',
    });
    expect(entries.every((entry) => entry.href.startsWith('/w/acme/settings/'))).toBe(true);
    expect(entries.filter((entry) => entry.meta !== undefined)).toEqual([]);
    expect(preferencesHref('acme')).toBe('/w/acme/settings/account/preferences');
    expect(calendarSettingsHref('acme')).toBe('/w/acme/settings/scheduling/calendars');
  });
});

describe('visibleSettingsNav', () => {
  const groups: readonly SettingsNavGroup[] = [
    {
      id: 'account',
      label: 'Account',
      entries: [{ id: 'preferences', label: 'Preferences', href: '/p', icon: 'sliders-horizontal' }],
    },
    {
      id: 'workspace',
      label: 'Workspace',
      entries: [
        { id: 'objects', label: 'Objects', href: '/o', icon: 'box', requires: 'schema.manage' },
        { id: 'jobs', label: 'Background jobs', href: '/j', icon: 'list-checks', requires: 'jobs.manage' },
      ],
    },
  ];

  it('shows Round robin only to someone who makes booking pages, and Workspace › Security only to owners', () => {
    const workspaceGroups = settingsNav('acme').filter((group) => group.id !== 'admin');
    expect(visibleSettingsNav(settingsNav('acme'), ['booking.manage'])).toEqual(
      workspaceGroups.map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => entry.id !== 'workspace-security'),
      })),
    );
    // Workspace › Security only for those who change sign in rules (spec 0033).
    expect(visibleSettingsNav(settingsNav('acme'), ['booking.manage', 'security.manage'])).toEqual(workspaceGroups);
    // Without it, Scheduling keeps Calendars and loses only Round robin.
    expect(visibleSettingsNav(settingsNav('acme'), []).map((group) => group.entries.map((entry) => entry.id))).toEqual([
      ['profile', 'link-page', 'preferences', 'security', 'notifications'],
      ['calendars'],
      ['general', 'members', 'objects', 'jobs', 'history', 'trash'],
    ]);
  });

  it('shows Super admin only to a super admin, whatever their workspace role (spec 0047)', () => {
    const ids = (isOperator: boolean) =>
      visibleSettingsNav(settingsNav('acme'), ['booking.manage', 'security.manage'], isOperator).map(
        (group) => group.id,
      );
    expect(ids(false)).toEqual(['account', 'scheduling', 'workspace']);
    expect(ids(true)).toEqual(['account', 'scheduling', 'workspace', 'admin']);
  });

  // History (spec 0046, AC-4600): one entry for every member, its Workspace changes tab checked on the page itself.
  it('puts History between Background jobs and Trash for every role, with the clock icon', () => {
    const owner: Permission[] = ['booking.manage', 'security.manage', 'audit.read', 'jobs.manage'];
    for (const permissions of [owner, ['booking.manage', 'audit.read'], ['booking.manage'], []] as Permission[][]) {
      const workspace = visibleSettingsNav(settingsNav('acme'), permissions).find((group) => group.id === 'workspace');
      const ids = workspace?.entries.map((entry) => entry.id) ?? [];
      expect(ids.slice(ids.indexOf('jobs'), ids.indexOf('jobs') + 3)).toEqual(['jobs', 'history', 'trash']);
    }
    const entry = settingsNav('acme')
      .flatMap((group) => group.entries)
      .find((each) => each.id === 'history');
    expect(entry).toEqual({ id: 'history', label: 'History', href: '/w/acme/settings/history', icon: 'clock' });
    expect(historyHref('acme', 'changes')).toBe('/w/acme/settings/history/changes');
    expect(historyHref('acme', 'sign-ins')).toBe('/w/acme/settings/history/sign-ins');
  });

  it('leaves out a page the member may not open, keeping the rest of its group', () => {
    const shown = visibleSettingsNav(groups, ['jobs.manage']);
    expect(shown.map((group) => group.entries.map((entry) => entry.id))).toEqual([['preferences'], ['jobs']]);
  });

  it('leaves out a group with no page the member may open, never showing it locked', () => {
    expect(visibleSettingsNav(groups, []).map((group) => group.id)).toEqual(['account']);
  });

  it('keeps only pages that need nothing while the permissions load', () => {
    expect(visibleSettingsNav(groups, undefined).map((group) => group.id)).toEqual(['account']);
  });
});

describe('settingsPageOf', () => {
  it('marks the page each address shows', () => {
    expect(settingsPageOf('/w/acme/settings/account/preferences')).toBe('preferences');
    expect(settingsPageOf('/w/acme/settings/account/profile')).toBe('profile');
    expect(settingsPageOf('/w/acme/settings/account/link-page')).toBe('link-page');
    expect(settingsPageOf('/w/acme/settings/general')).toBe('general');
    expect(settingsPageOf('/w/acme/settings/scheduling/calendars')).toBe('calendars');
    expect(settingsPageOf('/w/acme/settings/account/calendars')).toBe('calendars');
    expect(settingsPageOf('/w/acme/settings/account/sign-in')).toBe('security');
    // The old address still marks the page while it redirects.
    expect(settingsPageOf('/w/acme/settings/account/security')).toBe('security');
    expect(settingsPageOf('/w/acme/settings/objects')).toBe('objects');
    expect(settingsPageOf('/w/acme/settings/objects/people/attributes')).toBe('objects');
    expect(settingsPageOf('/w/acme/settings/jobs/')).toBe('jobs');
    expect(settingsPageOf('/w/acme/settings/history')).toBe('history');
    expect(settingsPageOf('/w/acme/settings/history/changes')).toBe('history');
    expect(settingsPageOf('/w/acme/settings/history/sign-ins')).toBe('history');
    expect(settingsPageOf('/w/acme/settings/members')).toBe('members');
    expect(settingsPageOf('/w/acme/settings/scheduling/round-robin')).toBe('rotations');
    expect(settingsPageOf('/w/acme/settings/admin')).toBe('admin-overview');
    expect(settingsPageOf('/w/acme/settings/admin/users/0199a6f2-0000-7000-8000-000000000001')).toBe('admin-users');
    expect(settingsPageOf('/w/acme/settings/admin/booking-pages')).toBe('admin-pages');
    expect(settingsPageOf('/w/acme/settings/admin/website')).toBe('admin-website');
    expect(settingsPageOf('/w/acme/settings/scheduling/rotations')).toBe('rotations');
    expect(settingsPageOf('/w/acme/settings/trash')).toBe('trash');
  });

  it('keeps the old Calendar address current on Calendars while it redirects', () => {
    expect(settingsPageOf('/w/acme/settings/calendar')).toBe('calendars');
  });

  it('marks nothing on an address that names no page, or outside settings', () => {
    expect(settingsPageOf('/w/acme/settings/nope')).toBeUndefined();
    expect(settingsPageOf('/w/acme/settings')).toBeUndefined();
    expect(settingsPageOf('/w/acme/captures/links')).toBeUndefined();
    expect(settingsPageOf('/w/acme/objects/settings/jobs')).toBeUndefined();
    // The trash's old address redirects into Settings; it marks nothing itself.
    expect(settingsPageOf('/w/acme/trash')).toBeUndefined();
  });

  it('finds the group a page sits in, for its trail', () => {
    const groups = settingsNav('acme');
    expect(settingsGroupOf(groups, 'preferences')?.label).toBe('Account');
    expect(settingsGroupOf(groups, 'calendars')?.label).toBe('Scheduling');
    expect(settingsGroupOf(groups, 'jobs')?.label).toBe('Workspace');
    expect(settingsGroupOf(groups, 'rotations')?.label).toBe('Scheduling');
    // Settings › Workspace › Trash.
    expect(settingsGroupOf(groups, 'trash')?.label).toBe('Workspace');
    expect(settingsGroupOf(groups, undefined)).toBeUndefined();
  });
});
