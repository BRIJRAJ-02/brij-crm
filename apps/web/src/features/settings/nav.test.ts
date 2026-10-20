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
  it('lists Account, Workspace and Scheduling, in order, with their pages', () => {
    const groups = settingsNav('acme');
    expect(groups.map((group) => group.label)).toEqual(['Account', 'Workspace', 'Scheduling']);
    expect(groups.map((group) => group.entries.map((entry) => entry.label))).toEqual([
      ['Preferences', 'Calendars'],
      ['Objects', 'Background jobs'],
      ['Booking pages', 'Forms'],
    ]);
  });

  it('puts Calendars under Account, and sends Scheduling into Captures, saying so', () => {
    const entries = settingsNav('acme').flatMap((group) => group.entries);
    expect(Object.fromEntries(entries.map((entry) => [entry.id, entry.href]))).toEqual({
      preferences: '/w/acme/settings/account/preferences',
      calendars: '/w/acme/settings/account/calendars',
      objects: '/w/acme/settings/objects',
      jobs: '/w/acme/settings/jobs',
      'booking-pages': '/w/acme/captures/links',
      forms: '/w/acme/captures/forms',
    });
    expect(entries.filter((entry) => entry.meta !== undefined).map((entry) => [entry.id, entry.meta])).toEqual([
      ['booking-pages', 'In Captures'],
      ['forms', 'In Captures'],
    ]);
    expect(preferencesHref('acme')).toBe('/w/acme/settings/account/preferences');
    expect(calendarSettingsHref('acme')).toBe('/w/acme/settings/account/calendars');
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

  it('shows every page today: none needs a permission', () => {
    expect(visibleSettingsNav(settingsNav('acme'), [])).toEqual(settingsNav('acme'));
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
    expect(settingsPageOf('/w/acme/settings/account/calendars')).toBe('calendars');
    expect(settingsPageOf('/w/acme/settings/objects')).toBe('objects');
    expect(settingsPageOf('/w/acme/settings/objects/people/attributes')).toBe('objects');
    expect(settingsPageOf('/w/acme/settings/jobs/')).toBe('jobs');
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
    expect(settingsGroupOf(groups, 'jobs')?.label).toBe('Workspace');
    expect(settingsGroupOf(groups, undefined)).toBeUndefined();
  });
});
