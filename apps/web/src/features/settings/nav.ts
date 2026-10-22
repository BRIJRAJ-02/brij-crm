// Where settings pages are, which ones exist and how the settings navigation
// groups them (specs 0012 and 0026). Plain functions with no React or library
// imports, so the routes' loaders (in the first load) can use them without
// pulling a screen in.
import type { ObjectSummary, Permission } from '@crm/data';
import { jobsHref, settingsHomeHref, trashHref } from '../workspace/objects.ts';
import { strings as calendar } from './calendar-strings.ts';
import { strings as jobs } from './jobs-strings.ts';
import { strings as rotations } from '../booking/rotation-strings.ts';
import { strings as members } from './members-strings.ts';
import { strings as notifications } from './notifications-strings.ts';
import { strings as security } from './security-strings.ts';
import { strings as workspaceSecurity } from './workspace-security-strings.ts';
import { strings } from './strings.ts';
import { strings as workspace } from './workspace-strings.ts';

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

/**
 * Settings › Scheduling › Calendars (specs 0024 and 0026): the member's own calendar connections. Its older
 * addresses (`account/calendars`, `calendar`) send here.
 */
export const calendarSettingsHref = (slug: string) => `/w/${slug}/settings/scheduling/calendars`;

/** Settings › Account › Profile (spec 0031, AC-821): the member's own name, picture and time zone here. */
export const profileHref = (slug: string) => `/w/${slug}/settings/account/profile`;

/** Settings › Workspace › General (spec 0031, AC-822): the workspace's name, time zone and address, and its delete. */
export const generalSettingsHref = (slug: string) => `/w/${slug}/settings/general`;

/** Settings › Workspace › Members (spec 0031): who is in the workspace, roles and invitations. */
export const membersSettingsHref = (slug: string) => `/w/${slug}/settings/members`;

/** Settings › Scheduling › Round robin (spec 0029; spec 0037, AC-1433): the groups round robin pages book from. */
export const rotationsSettingsHref = (slug: string) => `/w/${slug}/settings/scheduling/round-robin`;

/** Settings › Account › Notifications (spec 0038): the member's email for this workspace. */
export const notificationSettingsHref = (slug: string) => `/w/${slug}/settings/account/notifications`;

/** Settings › Account › Sign in and devices (spec 0033): two factor, passkeys, the devices signed in and recent activity. */
export const securitySettingsHref = (slug: string) => `/w/${slug}/settings/account/sign-in`;

/** The settings navigation's pages: Account's, then Scheduling's and Workspace's. */
export type SettingsPageId =
  | 'profile'
  | 'preferences'
  | 'security'
  | 'calendars'
  | 'notifications'
  | 'general'
  | 'members'
  | 'workspace-security'
  | 'objects'
  | 'jobs'
  | 'trash'
  | 'rotations';

/** Settings › Workspace › Security (spec 0033, milestone 4): the workspace's sign in rules, owners only. */
export const workspaceSecurityHref = (slug: string) => `/w/${slug}/settings/security`;

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
  readonly icon:
    | 'user-round'
    | 'sliders-horizontal'
    | 'shield-check'
    | 'calendar'
    | 'bell'
    | 'building'
    | 'users'
    | 'lock'
    | 'box'
    | 'list-checks'
    | 'users-round'
    | 'trash';
  /** A quiet word after the name. Every entry but Trash opens a page in Settings (20 and 22 Oct 2026). */
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
 * The settings navigation (spec 0026, AC-682): Account (Profile, spec 0031;
 * Preferences, Notifications, spec 0038), Scheduling (Calendars, 21 Oct 2026)
 * and Workspace (General and Members, spec 0031; Objects, Background jobs).
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
        // Profile first (spec 0031, AC-832): every member has one.
        { id: 'profile', label: workspace.profileTitle, href: profileHref(slug), icon: 'user-round' },
        { id: 'preferences', label: strings.preferences, href: preferencesHref(slug), icon: 'sliders-horizontal' },
        { id: 'security', label: security.title, href: securitySettingsHref(slug), icon: 'shield-check' },
        { id: 'notifications', label: notifications.title, href: notificationSettingsHref(slug), icon: 'bell' },
      ],
    },
    {
      id: 'scheduling',
      label: strings.scheduling,
      entries: [
        { id: 'calendars', label: calendar.title, href: calendarSettingsHref(slug), icon: 'calendar' },
        // Anyone who makes booking pages sees the rotations they're in; admins make and change them.
        {
          id: 'rotations',
          label: rotations.title,
          href: rotationsSettingsHref(slug),
          icon: 'users-round',
          requires: 'booking.manage',
        },
      ],
    },
    {
      id: 'workspace',
      label: strings.workspace,
      entries: [
        // General, then Members (spec 0031, AC-832): every member may open both; what they may change is the server's
        // call.
        { id: 'general', label: workspace.generalTitle, href: generalSettingsHref(slug), icon: 'building' },
        { id: 'members', label: members.title, href: membersSettingsHref(slug), icon: 'users' },
        // The workspace's sign in rules (spec 0033): owners only, so nobody else sees the entry at all.
        {
          id: 'workspace-security',
          label: workspaceSecurity.navLabel,
          href: workspaceSecurityHref(slug),
          icon: 'lock',
          requires: 'security.manage',
        },
        { id: 'objects', label: strings.objects, href: objectsSettingsHref(slug), icon: 'box' },
        { id: 'jobs', label: jobs.title, href: jobsHref(slug), icon: 'list-checks' },
        // The trash left the sidebar for here (the owner, 22 October 2026). The one entry outside Settings: it opens
        // the trash's own page, at its own address, which deletes' Undo toasts and ⌘K's Open trash also reach.
        { id: 'trash', label: strings.trash, href: trashHref(slug), icon: 'trash' },
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
  if (rest === 'account/profile') return 'profile';
  if (rest === 'account/preferences') return 'preferences';
  if (rest === 'general') return 'general';
  if (rest === 'scheduling/calendars' || rest === 'account/calendars' || rest === 'calendar') return 'calendars';
  if (rest === 'account/notifications') return 'notifications';
  if (rest === 'account/sign-in' || rest === 'account/security') return 'security';
  if (rest === 'objects' || rest.startsWith('objects/')) return 'objects';
  if (rest === 'jobs') return 'jobs';
  if (rest === 'members') return 'members';
  if (rest === 'scheduling/round-robin' || rest === 'scheduling/rotations') return 'rotations';
  if (rest === 'security') return 'workspace-security';
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
