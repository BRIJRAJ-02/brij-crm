// Where settings pages are, which ones exist and how the settings navigation
// groups them (specs 0012 and 0026). Plain functions with no React or library
// imports, so the routes' loaders (in the first load) can use them without
// pulling a screen in.
import type { ObjectSummary, Permission } from '@crm/data';
import { jobsHref, settingsHomeHref } from '../workspace/objects.ts';
import { strings as calendar } from './calendar-strings.ts';
import { strings as jobs } from './jobs-strings.ts';
import { strings as members } from './members-strings.ts';
import { strings as notifications } from './notifications-strings.ts';
import { strings } from './strings.ts';

/** An object's settings tabs, in order. */
export const OBJECT_TABS = ['attributes', 'configuration'] as const;
/** One of an object's settings tabs. */
export type ObjectTab = (typeof OBJECT_TABS)[number];

/** True when `tab` names one of an object's settings tabs. */
export const isObjectTab = (tab: string): tab is ObjectTab => (OBJECT_TABS as readonly string[]).includes(tab);

/** Settings, Objects. */
export const objectsSettingsHref = (slug: string) => `/w/${slug}/settings/objects`;

/** One object's settings tab (its Attributes tab by default), by the object's API name, so links survive renames. */
export const objectSettingsHref = (
  slug: string,
  object: Pick<ObjectSummary, 'apiSlug'>,
  tab: ObjectTab = 'attributes',
) => `/w/${slug}/settings/objects/${object.apiSlug}/${tab}`;

/** Settings › Account › Preferences (spec 0026): the interface theme. Where Settings opens. */
export const preferencesHref = settingsHomeHref;

/** Settings › Account › Calendars (specs 0024 and 0026): the member's own calendar connections. */
export const calendarSettingsHref = (slug: string) => `/w/${slug}/settings/account/calendars`;

/** Settings › Workspace › Members (spec 0031): who is in the workspace, roles and invitations. */
export const membersSettingsHref = (slug: string) => `/w/${slug}/settings/members`;

/** Settings › Account › Notifications (spec 0038): the member's email for this workspace. */
export const notificationSettingsHref = (slug: string) => `/w/${slug}/settings/account/notifications`;

/** The settings navigation's pages: Account's, then Workspace's. */
export type SettingsPageId = 'preferences' | 'calendars' | 'notifications' | 'members' | 'objects' | 'jobs';

/**
 * The settings navigation's groups, in order (spec 0026, AC-682). Scheduling
 * holds workspace wide scheduling settings (spam protection, defaults) once
 * there are some; one booking page's or one form's settings stay in its editor.
 */
export type SettingsGroupId = 'account' | 'workspace' | 'scheduling';

/** One entry in the settings navigation. */
export interface SettingsNavEntry {
  readonly id: SettingsPageId;
  readonly label: string;
  readonly href: string;
  readonly icon: 'sliders-horizontal' | 'calendar' | 'bell' | 'users' | 'box' | 'list-checks';
  /** A quiet word after the name. Every entry opens a page in Settings, so none leaves it (20 Oct 2026). */
  readonly meta?: string;
  /** A permission the page needs before the member may open it at all; absent, every member may. */
  readonly requires?: Permission;
}

/** One group of the settings navigation, under its label. */
export interface SettingsNavGroup {
  readonly id: SettingsGroupId;
  readonly label: string;
  readonly entries: readonly SettingsNavEntry[];
}

/**
 * The settings navigation (spec 0026, AC-682): Account (Preferences,
 * Calendars, Notifications) and Workspace (Members, spec 0031; Objects, Background jobs).
 * Every entry is a page in Settings: the Booking pages and Forms links into
 * Captures went on 20 Oct 2026, as neither has workspace wide settings yet
 * (each page's and each form's own settings live in its editor). Every
 * member may open each page today: everyone reads Members and Objects and
 * sees their own jobs.
 */
export function settingsNav(slug: string): readonly SettingsNavGroup[] {
  return [
    {
      id: 'account',
      label: strings.account,
      entries: [
        { id: 'preferences', label: strings.preferences, href: preferencesHref(slug), icon: 'sliders-horizontal' },
        { id: 'calendars', label: calendar.title, href: calendarSettingsHref(slug), icon: 'calendar' },
        { id: 'notifications', label: notifications.title, href: notificationSettingsHref(slug), icon: 'bell' },
      ],
    },
    {
      id: 'workspace',
      label: strings.workspace,
      entries: [
        // Members first (spec 0031, AC-832): every member may open it; what they may change is the server's call.
        { id: 'members', label: members.title, href: membersSettingsHref(slug), icon: 'users' },
        { id: 'objects', label: strings.objects, href: objectsSettingsHref(slug), icon: 'box' },
        { id: 'jobs', label: jobs.title, href: jobsHref(slug), icon: 'list-checks' },
      ],
    },
  ];
}

/**
 * The groups as this member sees them: entries they may not open are left
 * out, and so is a group left with none, never shown locked (AC-682).
 * `permissions` undefined (still loading) keeps only entries that need none.
 */
export function visibleSettingsNav(
  groups: readonly SettingsNavGroup[],
  permissions: readonly Permission[] | undefined,
): readonly SettingsNavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        (entry) => entry.requires === undefined || (permissions?.includes(entry.requires) ?? false),
      ),
    }))
    .filter((group) => group.entries.length > 0);
}

/** The settings page an address shows, as the navigation marks it current; undefined for none (an unknown address). */
export function settingsPageOf(pathname: string): SettingsPageId | undefined {
  const match = /^\/w\/[^/]+\/settings\/(.+?)\/*$/.exec(pathname);
  const rest = match?.[1] ?? '';
  if (rest === 'account/preferences') return 'preferences';
  if (rest === 'account/calendars' || rest === 'calendar') return 'calendars';
  if (rest === 'account/notifications') return 'notifications';
  if (rest === 'objects' || rest.startsWith('objects/')) return 'objects';
  if (rest === 'jobs') return 'jobs';
  if (rest === 'members') return 'members';
  return undefined;
}

/** The group a settings page sits in, for its trail ("Account › Preferences"). */
export function settingsGroupOf(
  groups: readonly SettingsNavGroup[],
  page: SettingsPageId | undefined,
): SettingsNavGroup | undefined {
  return page === undefined ? undefined : groups.find((group) => group.entries.some((entry) => entry.id === page));
}

/** The workspace's objects in its order, live ones and archived ones apart (settings lists them in two sections). */
export function byPosition(objects: readonly ObjectSummary[]): {
  readonly live: readonly ObjectSummary[];
  readonly archived: readonly ObjectSummary[];
  readonly all: readonly ObjectSummary[];
} {
  const all = [...objects].sort((a, b) => a.position - b.position);
  return { all, live: all.filter((object) => !object.isArchived), archived: all.filter((object) => object.isArchived) };
}
