// The settings navigation (spec 0026, AC-682, AC-686, AC-687; regrouped on 5 November 2026): its groups in order,
// each entry's icon its own, entries and groups left out when the member may open none of their pages, "Find a
// setting", and which page an address marks current.
import { describe, expect, it } from 'vitest';
import type { Permission } from '@crm/data';
import {
  historyHref,
  preferencesHref,
  profileHref,
  searchSettings,
  settingsEntryAt,
  settingsEntryOf,
  settingsGroupOf,
  settingsNameAt,
  settingsNav,
  settingsPageOf,
  visibleSettingsNav,
  type SettingsNavGroup,
} from './nav.ts';

/** Every permission a workspace owner holds that the navigation asks about. */
const OWNER: readonly Permission[] = [
  'booking.manage',
  'routing.manage',
  'security.manage',
  'audit.read',
  'webhooks.manage',
  'automations.manage',
  'api_keys.manage',
];

const ids = (groups: readonly SettingsNavGroup[]) => groups.map((group) => group.entries.map((entry) => entry.id));

describe('settingsNav', () => {
  it('lists Account, Workspace, People, Scheduling, Data and Super admin, in order, with their pages', () => {
    const groups = settingsNav('acme');
    expect(groups.map((group) => group.label)).toEqual([
      'Account',
      'Workspace',
      'People',
      'Scheduling',
      'Data',
      'Super admin',
    ]);
    expect(groups.map((group) => group.entries.map((entry) => entry.label))).toEqual([
      ['Profile', 'Preferences', 'Notifications', 'Sign in and security', 'Calendars'],
      ['General', 'Brand', 'History', 'Apps'],
      ['Members', 'Roles and access'],
      ['Availability', 'Round robin', 'Routing', 'Scheduling access'],
      ['Objects', 'Lists', 'Trash'],
      ['Overview', 'Users', 'Booking pages', 'Website'],
    ]);
  });

  it('adds the Business group after Scheduling only while Appointments or Table seating is installed', () => {
    expect(settingsNav('acme').some((group) => group.id === 'business')).toBe(false);
    const groups = settingsNav('acme', { hasBusiness: true });
    expect(groups.map((group) => group.id)).toEqual([
      'account',
      'workspace',
      'people',
      'scheduling',
      'business',
      'data',
      'admin',
    ]);
    const business = groups.find((group) => group.id === 'business');
    expect(business?.entries.map((entry) => [entry.label, entry.href])).toEqual([
      ['Places', '/w/acme/settings/business'],
      ['Services', '/w/acme/settings/services'],
      ['Staff', '/w/acme/settings/staff'],
      ['Shifts', '/w/acme/settings/shifts'],
    ]);
    // Each for its own permission: the front desk (`services.calendar`) sees Shifts alone.
    expect(ids(visibleSettingsNav(groups, ['services.calendar'])).find((each) => each.includes('shifts'))).toEqual([
      'shifts',
    ]);
    const icons = groups.flatMap((group) => group.entries.map((entry) => entry.icon));
    expect(new Set(icons).size).toBe(icons.length);
    expect(settingsPageOf('/w/acme/settings/business/places/p1')).toBe('business');
    expect(settingsPageOf('/w/acme/settings/staff/s1')).toBe('staff');
    expect(settingsPageOf('/w/acme/settings/apps')).toBe('apps');
  });

  it('keeps the parked pages out: Webhooks, Automations, Developer and Background jobs', () => {
    const entries = settingsNav('acme').flatMap((group) => group.entries);
    const every = entries.flatMap((entry) => [entry.id, ...(entry.tabs ?? []).map((tab) => tab.id)]);
    for (const parked of ['webhooks', 'automations', 'developer', 'jobs']) expect(every).not.toContain(parked);
  });

  it('gives every entry an icon of its own, so the phone’s list never repeats one', () => {
    const icons = settingsNav('acme').flatMap((group) => group.entries.map((entry) => entry.icon));
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('opens every entry inside Settings, Profile first', () => {
    const entries = settingsNav('acme').flatMap((group) => group.entries);
    expect(Object.fromEntries(entries.map((entry) => [entry.id, entry.href]))).toEqual({
      profile: '/w/acme/settings/account/profile',
      preferences: '/w/acme/settings/account/preferences',
      notifications: '/w/acme/settings/account/notifications',
      security: '/w/acme/settings/account/sign-in',
      calendars: '/w/acme/settings/account/calendars',
      general: '/w/acme/settings/general',
      brand: '/w/acme/settings/brand',
      history: '/w/acme/settings/history',
      // The Hospitality apps (spec 0065).
      apps: '/w/acme/settings/apps',
      members: '/w/acme/settings/members',
      roles: '/w/acme/settings/roles',
      availability: '/w/acme/settings/scheduling/availability',
      'round-robin': '/w/acme/settings/scheduling/round-robin',
      routing: '/w/acme/settings/scheduling/routing',
      'scheduling-access': '/w/acme/settings/scheduling/access',
      objects: '/w/acme/settings/objects',
      lists: '/w/acme/settings/lists',
      trash: '/w/acme/settings/trash',
      'admin-overview': '/w/acme/settings/admin',
      'admin-users': '/w/acme/settings/admin/users',
      'admin-pages': '/w/acme/settings/admin/booking-pages',
      'admin-website': '/w/acme/settings/admin/website',
    });
    expect(profileHref('acme')).toBe('/w/acme/settings/account/profile');
    expect(preferencesHref('acme')).toBe('/w/acme/settings/account/preferences');
  });

  it('holds Teams as a tab of Members, and Sign in rules as a tab of Roles and access', () => {
    const entries = settingsNav('acme').flatMap((group) => group.entries);
    const tabs = (id: string) => entries.find((entry) => entry.id === id)?.tabs?.map((tab) => [tab.label, tab.href]);
    expect(tabs('members')).toEqual([
      ['Members', '/w/acme/settings/members'],
      ['Teams', '/w/acme/settings/teams'],
    ]);
    expect(tabs('roles')).toEqual([
      ['Roles', '/w/acme/settings/roles'],
      ['Sign in rules', '/w/acme/settings/security'],
    ]);
  });
});

describe('visibleSettingsNav', () => {
  it('shows an owner every group but Super admin', () => {
    expect(ids(visibleSettingsNav(settingsNav('acme'), OWNER))).toEqual([
      ['profile', 'preferences', 'notifications', 'security', 'calendars'],
      ['general', 'brand', 'history'],
      ['members', 'roles'],
      ['availability', 'round-robin', 'routing', 'scheduling-access'],
      ['objects', 'lists', 'trash'],
    ]);
  });

  it('leaves out for a member what needs a permission: History, Round robin, Routing, Sign in rules', () => {
    const shown = visibleSettingsNav(settingsNav('acme'), []);
    expect(ids(shown)).toEqual([
      ['profile', 'preferences', 'notifications', 'security', 'calendars'],
      ['general', 'brand'],
      ['members', 'roles'],
      ['availability', 'scheduling-access'],
      ['objects', 'lists', 'trash'],
    ]);
    // Roles and access, with Sign in rules gone, is Roles alone, by its tab's name.
    const roles = shown.flatMap((group) => group.entries).find((entry) => entry.id === 'roles');
    expect(roles?.label).toBe('Roles');
    expect(roles?.tabs?.map((tab) => tab.id)).toEqual(['roles']);
  });

  it('leaves out for a guest what they can’t use: Calendars, Brand, scheduling, data, Teams and Roles (spec 0031)', () => {
    const shown = visibleSettingsNav(settingsNav('acme'), [], false, true);
    expect(ids(shown)).toEqual([
      ['profile', 'preferences', 'notifications', 'security'],
      ['general'],
      ['members'],
      ['trash'],
    ]);
    const members = shown.flatMap((group) => group.entries).find((entry) => entry.id === 'members');
    expect(members?.tabs?.map((tab) => tab.id)).toEqual(['members']);
  });

  it('shows Super admin only to a super admin, whatever their workspace role (spec 0047)', () => {
    const groupIds = (isOperator: boolean) =>
      visibleSettingsNav(settingsNav('acme'), OWNER, isOperator).map((group) => group.id);
    expect(groupIds(false)).toEqual(['account', 'workspace', 'people', 'scheduling', 'data']);
    expect(groupIds(true)).toEqual(['account', 'workspace', 'people', 'scheduling', 'data', 'admin']);
  });

  it('keeps only pages that need nothing while the permissions load', () => {
    const shown = visibleSettingsNav(settingsNav('acme'), undefined);
    expect(shown.flatMap((group) => group.entries).some((entry) => entry.requires !== undefined)).toBe(false);
  });

  it('keeps History’s address and its changes tab', () => {
    expect(historyHref('acme')).toBe('/w/acme/settings/history');
    expect(historyHref('acme', 'changes')).toBe('/w/acme/settings/history/changes');
  });
});

describe('searchSettings', () => {
  const owner = visibleSettingsNav(settingsNav('acme'), OWNER);

  it('finds nothing for an empty or blank query', () => {
    expect(searchSettings(owner, '')).toEqual([]);
    expect(searchSettings(owner, '   ')).toEqual([]);
  });

  it('puts a name that starts with the query first, then names holding it, then keywords', () => {
    expect(searchSettings(owner, 'pro').map((hit) => hit.label)).toEqual(['Profile']);
    expect(searchSettings(owner, 'cal').map((hit) => hit.label)).toEqual(['Calendars', 'Scheduling access']);
    expect(searchSettings(owner, 'logo').map((hit) => hit.label)).toEqual(['Brand']);
  });

  it('matches keywords, accents and punctuation aside, every word typed', () => {
    expect(searchSettings(owner, '2FA').map((hit) => hit.id)).toEqual(['security']);
    expect(searchSettings(owner, 'Two-factor').map((hit) => hit.id)).toEqual(['security', 'workspace-security']);
    // A tab's own words open that tab, not its entry's first.
    expect(searchSettings(owner, 'session length').map((hit) => hit.href)).toEqual(['/w/acme/settings/security']);
    expect(searchSettings(owner, 'google calendar').map((hit) => hit.id)).toEqual(['calendars']);
  });

  it('finds a tab by its name, saying which entry it sits in', () => {
    expect(searchSettings(owner, 'teams')).toEqual([
      {
        id: 'teams',
        label: 'Teams',
        href: '/w/acme/settings/teams',
        icon: 'users',
        where: 'People › Members',
      },
    ]);
    expect(searchSettings(owner, 'sign in rules').map((hit) => hit.href)).toEqual(['/w/acme/settings/security']);
  });

  it('never finds a page the member may not open', () => {
    const member = visibleSettingsNav(settingsNav('acme'), []);
    expect(searchSettings(member, 'routing')).toEqual([]);
    expect(searchSettings(member, 'history')).toEqual([]);
    expect(searchSettings(member, 'sign in rules')).toEqual([]);
  });

  it('finds nothing for words no setting has', () => {
    expect(searchSettings(owner, 'zebra')).toEqual([]);
  });
});

describe('settingsPageOf', () => {
  it('marks the page each address shows', () => {
    const cases: Readonly<Record<string, string>> = {
      'account/profile': 'profile',
      'account/preferences': 'preferences',
      'account/notifications': 'notifications',
      'account/sign-in': 'security',
      // An old address still marks its page while it redirects.
      'account/security': 'security',
      'account/calendars': 'calendars',
      'account/scheduling': 'scheduling-access',
      general: 'general',
      brand: 'brand',
      history: 'history',
      'history/changes': 'history',
      members: 'members',
      teams: 'teams',
      roles: 'roles',
      'roles/admin': 'roles',
      security: 'workspace-security',
      'scheduling/availability': 'availability',
      'scheduling/round-robin': 'round-robin',
      'scheduling/routing': 'routing',
      'scheduling/access': 'scheduling-access',
      objects: 'objects',
      'objects/people/attributes': 'objects',
      lists: 'lists',
      'lists/sales/fields': 'lists',
      trash: 'trash',
      'jobs/': 'jobs',
      admin: 'admin-overview',
      'admin/users/0199a6f2-0000-7000-8000-000000000001': 'admin-users',
      'admin/booking-pages': 'admin-pages',
      'admin/website': 'admin-website',
    };
    for (const [rest, page] of Object.entries(cases)) expect(settingsPageOf(`/w/acme/settings/${rest}`)).toBe(page);
  });

  it('marks nothing on an address that names no page, or outside settings', () => {
    expect(settingsPageOf('/w/acme/settings/nope')).toBeUndefined();
    expect(settingsPageOf('/w/acme/settings')).toBeUndefined();
    expect(settingsPageOf('/w/acme/settings/calendar')).toBeUndefined();
    expect(settingsPageOf('/w/acme/captures/links')).toBeUndefined();
    expect(settingsPageOf('/w/acme/trash')).toBeUndefined();
  });

  it('finds the entry and group a page sits in, a tab’s too, for its trail', () => {
    const groups = settingsNav('acme');
    expect(settingsGroupOf(groups, 'preferences')?.label).toBe('Account');
    expect(settingsGroupOf(groups, 'teams')?.label).toBe('People');
    expect(settingsEntryOf(groups, 'teams')?.id).toBe('members');
    expect(settingsEntryOf(groups, 'workspace-security')?.id).toBe('roles');
    expect(settingsGroupOf(groups, 'availability')?.label).toBe('Scheduling');
    expect(settingsGroupOf(groups, 'trash')?.label).toBe('Data');
    // Background jobs is parked: its page has no place in the navigation.
    expect(settingsGroupOf(groups, 'jobs')).toBeUndefined();
    expect(settingsGroupOf(groups, undefined)).toBeUndefined();
  });
});

// 5 November 2026: Settings › Business › Places read "Business › Business": its page titled itself after the group,
// and a place's way back said "Business" again. The navigation now names both.
describe('a settings page’s name and its trail’s places', () => {
  /**
   * A group shaped like Business on the hospitality branch: its first entry, Places, at /settings/business. Its ids
   * and icon are that branch's, which this one's types don't list yet, hence the cast.
   */
  const business = {
    id: 'business',
    label: 'Business',
    entries: [{ id: 'business', label: 'Places', href: '/w/acme/settings/business', icon: 'store' }],
  } as unknown as SettingsNavGroup;
  const groups = [...settingsNav('acme'), business];

  it('calls an entry’s own address what the sidebar calls it, query and trailing slash aside', () => {
    expect(settingsEntryAt(groups, '/w/acme/settings/business')?.label).toBe('Places');
    expect(settingsEntryAt(groups, '/w/acme/settings/business/')?.label).toBe('Places');
    expect(settingsEntryAt(groups, '/w/acme/settings/account/profile')?.label).toBe('Profile');
    // A page under an entry (a place, a role, an object) keeps its own title.
    expect(settingsEntryAt(groups, '/w/acme/settings/business/places/p1')).toBeUndefined();
    expect(settingsEntryAt(groups, '/w/acme/settings/roles/admin')).toBeUndefined();
    // A tab's own address isn't an entry's (the tab bar names the page there).
    expect(settingsEntryAt(groups, '/w/acme/settings/teams')).toBeUndefined();
  });

  it('names a trail’s place as the navigation does: a tab by its own name, else its entry’s', () => {
    expect(settingsNameAt(groups, '/w/acme/settings/business')).toBe('Places');
    expect(settingsNameAt(groups, '/w/acme/settings/roles')).toBe('Roles');
    expect(settingsNameAt(groups, '/w/acme/settings/objects')).toBe('Objects');
    expect(settingsNameAt(groups, '/w/acme/settings/teams?x=1')).toBe('Teams');
    expect(settingsNameAt(groups, '/w/acme/settings/nowhere')).toBeUndefined();
  });
});
