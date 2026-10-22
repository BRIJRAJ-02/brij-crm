// The settings navigation (spec 0026, AC-682, AC-686, AC-687): its groups in
// order, groups left out when the member may open none of their pages, and
// which page an address marks current.
import { describe, expect, it } from 'vitest';
import {
  calendarSettingsHref,
  preferencesHref,
  settingsGroupOf,
  settingsNav,
  settingsPageOf,
  visibleSettingsNav,
  type SettingsNavGroup,
} from './nav.ts';

describe('settingsNav', () => {
  it('lists Account, Scheduling and Workspace, in order, with their pages', () => {
    const groups = settingsNav('acme');
    expect(groups.map((group) => group.label)).toEqual(['Account', 'Scheduling', 'Workspace']);
    expect(groups.map((group) => group.entries.map((entry) => entry.label))).toEqual([
      ['Profile', 'Preferences', 'Security', 'Notifications'],
      ['Calendars', 'Round robin'],
      ['General', 'Members', 'Security', 'Objects', 'Background jobs'],
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
      security: '/w/acme/settings/account/security',
      members: '/w/acme/settings/members',
      'workspace-security': '/w/acme/settings/security',
      objects: '/w/acme/settings/objects',
      jobs: '/w/acme/settings/jobs',
      rotations: '/w/acme/settings/scheduling/round-robin',
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
    expect(visibleSettingsNav(settingsNav('acme'), ['booking.manage'])).toEqual(
      settingsNav('acme').map((group) => ({
        ...group,
        entries: group.entries.filter((entry) => entry.id !== 'workspace-security'),
      })),
    );
    // Workspace › Security only for those who change sign in rules (spec 0033).
    expect(visibleSettingsNav(settingsNav('acme'), ['booking.manage', 'security.manage'])).toEqual(settingsNav('acme'));
    // Without it, Scheduling keeps Calendars and loses only Round robin.
    expect(visibleSettingsNav(settingsNav('acme'), []).map((group) => group.entries.map((entry) => entry.id))).toEqual([
      ['profile', 'preferences', 'security', 'notifications'],
      ['calendars'],
      ['general', 'members', 'objects', 'jobs'],
    ]);
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
    expect(settingsPageOf('/w/acme/settings/general')).toBe('general');
    expect(settingsPageOf('/w/acme/settings/scheduling/calendars')).toBe('calendars');
    expect(settingsPageOf('/w/acme/settings/account/calendars')).toBe('calendars');
    expect(settingsPageOf('/w/acme/settings/account/security')).toBe('security');
    expect(settingsPageOf('/w/acme/settings/objects')).toBe('objects');
    expect(settingsPageOf('/w/acme/settings/objects/people/attributes')).toBe('objects');
    expect(settingsPageOf('/w/acme/settings/jobs/')).toBe('jobs');
    expect(settingsPageOf('/w/acme/settings/members')).toBe('members');
    expect(settingsPageOf('/w/acme/settings/scheduling/round-robin')).toBe('rotations');
    expect(settingsPageOf('/w/acme/settings/scheduling/rotations')).toBe('rotations');
  });

  it('keeps the old Calendar address current on Calendars while it redirects', () => {
    expect(settingsPageOf('/w/acme/settings/calendar')).toBe('calendars');
  });

  it('marks nothing on an address that names no page, or outside settings', () => {
    expect(settingsPageOf('/w/acme/settings/nope')).toBeUndefined();
    expect(settingsPageOf('/w/acme/settings')).toBeUndefined();
    expect(settingsPageOf('/w/acme/captures/links')).toBeUndefined();
    expect(settingsPageOf('/w/acme/objects/settings/jobs')).toBeUndefined();
  });

  it('finds the group a page sits in, for its trail', () => {
    const groups = settingsNav('acme');
    expect(settingsGroupOf(groups, 'preferences')?.label).toBe('Account');
    expect(settingsGroupOf(groups, 'calendars')?.label).toBe('Scheduling');
    expect(settingsGroupOf(groups, 'jobs')?.label).toBe('Workspace');
    expect(settingsGroupOf(groups, 'rotations')?.label).toBe('Scheduling');
    expect(settingsGroupOf(groups, undefined)).toBeUndefined();
  });
});
