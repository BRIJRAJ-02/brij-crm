// Where settings pages are, which ones exist and how the settings navigation
// groups them (specs 0012 and 0026). Plain functions with no React or library
// imports, so any screen can use them without pulling another screen in. It
// carries every settings page's title, and so their words: a route's loader
// (in the first load) imports a small module of its own instead, as the object
// settings route does with object-tabs.ts.
import type { ObjectSummary, Permission } from '@crm/data';
import { strings as listStrings } from '../lists/strings.ts';
import { jobsHref, settingsHomeHref, trashHref } from '../workspace/objects.ts';
import { historyHref } from './history-href.ts';
import { strings as automations } from '../automations/strings.ts';
import { strings as history } from './history-nav-strings.ts';
import { strings as jobs } from './jobs-strings.ts';
import { strings as members } from './members-strings.ts';
import { strings as notifications } from './notifications-strings.ts';
import { strings as schedulingAccess } from './scheduling-access-nav-strings.ts';
import { strings as teams } from './teams-nav-strings.ts';
import { strings as security } from './security-strings.ts';
import { strings as workspaceSecurity } from './workspace-security-strings.ts';
import { strings } from './strings.ts';
import { strings as workspace } from './workspace-strings.ts';
import { navStrings as admin } from '../admin/nav-strings.ts';
import type { ObjectTab } from './object-tabs.ts';

export { OBJECT_TABS, isObjectTab, type ObjectTab } from './object-tabs.ts';
export { HISTORY_TABS, historyHref, isHistoryTab, type HistoryTab } from './history-href.ts';

/** Settings, Objects. */
export const objectsSettingsHref = (slug: string) => `/w/${slug}/settings/objects`;

/** Settings › Workspace › Lists (spec 0048, AC-4828). */
export const listsSettingsHref = (slug: string) => `/w/${slug}/settings/lists`;

/** One list's settings tab (General by default), by the list's API name, so links survive renames (AC-4829). */
export const listSettingsHref = (
  slug: string,
  list: { readonly apiSlug: string },
  tab: 'general' | 'fields' = 'general',
) => `/w/${slug}/settings/lists/${list.apiSlug}/${tab}`;

/** One object's settings tab (its Attributes tab by default), by the object's API name, so links survive renames. */
export const objectSettingsHref = (
  slug: string,
  object: Pick<ObjectSummary, 'apiSlug'>,
  tab: ObjectTab = 'attributes',
) => `/w/${slug}/settings/objects/${object.apiSlug}/${tab}`;

/** Settings › Account › Preferences (spec 0026): the interface theme. Where Settings opens. */
export const preferencesHref = settingsHomeHref;

/** Settings › Account › Profile (spec 0031, AC-821): the member's own name, picture and public profile. */
export const profileHref = (slug: string) => `/w/${slug}/settings/account/profile`;

/** Settings › Workspace › General (spec 0031, AC-822): the workspace's name, time zone and address, and its delete. */
export const generalSettingsHref = (slug: string) => `/w/${slug}/settings/general`;

/** Settings › Workspace › Automations (parity #53): what the workspace does for itself. */
export const automationsHref = (slug: string) => `/w/${slug}/settings/automations`;

/** Settings › Workspace › Members (spec 0031): who is in the workspace, roles and invitations. */
export const membersSettingsHref = (slug: string) => `/w/${slug}/settings/members`;

/** Settings › Workspace › Teams (spec 0031, slice 8): the groups of people that access rules name. */
export const teamsSettingsHref = (slug: string) => `/w/${slug}/settings/teams`;

/** Settings › Account › Notifications (spec 0038): the member's email for this workspace. */
export const notificationSettingsHref = (slug: string) => `/w/${slug}/settings/account/notifications`;

/** Settings › Account › Scheduling access (spec 0037, AC-1266): who can see or manage the member's scheduling. */
export const schedulingAccessHref = (slug: string) => `/w/${slug}/settings/account/scheduling`;

/** Settings › Account › Sign in and devices (spec 0033): two factor, the devices signed in and recent activity. */
export const securitySettingsHref = (slug: string) => `/w/${slug}/settings/account/sign-in`;

/** The settings navigation's pages: Account's, then Scheduling's and Workspace's. */
export type SettingsPageId =
  | 'profile'
  | 'preferences'
  | 'security'
  | 'notifications'
  | 'scheduling-access'
  | 'general'
  | 'members'
  | 'teams'
  | 'workspace-security'
  | 'objects'
  | 'lists'
  | 'jobs'
  | 'automations'
  | 'history'
  | 'trash'
  | 'admin-overview'
  | 'admin-users'
  | 'admin-pages'
  | 'admin-website';

/** Settings › Workspace › Security (spec 0033, milestone 4): the workspace's sign in rules, owners only. */
export const workspaceSecurityHref = (slug: string) => `/w/${slug}/settings/security`;

/**
 * The settings navigation's groups, in order (spec 0026, AC-682). Scheduling is gone from here (25 October 2026):
 * Calendars and Round robin are tabs of Bookings, where the work is, and one booking page's or one form's
 * settings stay in its editor. What is left is a member's own account and the workspace itself.
 */
export type SettingsGroupId = 'account' | 'workspace' | 'admin';

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
    | 'list'
    | 'list-checks'
    | 'zap'
    | 'clock'
    | 'users-round'
    | 'trash'
    | 'chart-line'
    | 'calendar-days'
    | 'calendar-clock'
    | 'globe';
  /** A quiet word after the name. Every entry opens a page in Settings (20 Oct 2026; Trash too since 23 Oct 2026). */
  readonly meta?: string;
  /** A permission the page needs before the member may open it at all; absent, every member may. */
  readonly requires?: Permission;
  /**
   * Only for a super admin (spec 0047): the api's `OPERATOR_EMAILS`, which `me.get` reports as `isOperator`. Never
   * a workspace permission; the server checks every read on its own.
   */
  readonly operatorOnly?: true;
  /** Not for a guest (spec 0031, slice 9): a page about scheduling, which guests have none of. */
  readonly notForGuests?: true;
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
 * and Workspace (General and Members, spec 0031; Objects, Background jobs,
 * Trash). Every entry is a page in Settings: the Booking pages and Forms links into
 * Captures went on 20 Oct 2026, as neither has workspace wide settings yet
 * (each page's and each form's own settings live in its editor). Every
 * member may open each page but Round robin and Security: everyone reads
 * Members and Objects, sees their own jobs and the trash they may see.
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
        // Who can see or manage the member's scheduling, and whose they reach (spec 0037, AC-1266): every member
        // but a guest, who has no scheduling.
        {
          id: 'scheduling-access',
          label: schedulingAccess.title,
          href: schedulingAccessHref(slug),
          icon: 'calendar-clock',
          notForGuests: true,
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
        // Teams (spec 0031, slice 8, AC-832): every member reads them; changing them is for `teams.manage`.
        { id: 'teams', label: teams.title, href: teamsSettingsHref(slug), icon: 'users-round' },
        // The workspace's sign in rules (spec 0033): owners only, so nobody else sees the entry at all.
        {
          id: 'workspace-security',
          label: workspaceSecurity.navLabel,
          href: workspaceSecurityHref(slug),
          icon: 'lock',
          requires: 'security.manage',
        },
        { id: 'objects', label: strings.objects, href: objectsSettingsHref(slug), icon: 'box' },
        // Lists (spec 0048, AC-4828): every member may open it; they see the lists they may read.
        { id: 'lists', label: listStrings.settingsTitle, href: listsSettingsHref(slug), icon: 'list' },
        // Automations (parity #53): for `automations.manage` alone, so nobody else sees the entry at all.
        {
          id: 'automations',
          label: automations.navLabel,
          href: automationsHref(slug),
          icon: 'zap',
          requires: 'automations.manage',
        },
        { id: 'jobs', label: jobs.title, href: jobsHref(slug), icon: 'list-checks' },
        // History (spec 0046): every member opens it; Workspace changes inside it is for `audit.read` alone.
        { id: 'history', label: history.title, href: historyHref(slug), icon: 'clock' },
        // The trash left the sidebar for here (the owner, 22 October 2026), and opens inside Settings, its sidebar
        // and trail kept (A120, 23 October 2026). ⌘K's Open trash reaches the same address; the old one redirects.
        { id: 'trash', label: strings.trash, href: trashHref(slug), icon: 'trash' },
      ],
    },
    {
      // The operator console (spec 0047): super admins only, so nobody else sees the group at all.
      id: 'admin',
      label: admin.group,
      entries: [
        { id: 'admin-overview', label: admin.overview, href: adminHref(slug), icon: 'chart-line', operatorOnly: true },
        { id: 'admin-users', label: admin.users, href: adminHref(slug, 'users'), icon: 'users', operatorOnly: true },
        {
          id: 'admin-pages',
          label: admin.pages,
          href: adminHref(slug, 'booking-pages'),
          icon: 'calendar-days',
          operatorOnly: true,
        },
        {
          id: 'admin-website',
          label: admin.website,
          href: adminHref(slug, 'website'),
          icon: 'globe',
          operatorOnly: true,
        },
      ],
    },
  ];
}

/** Settings › Super admin (spec 0047): Overview, or one of its pages. */
export const adminHref = (slug: string, page?: 'users' | 'booking-pages' | 'website') =>
  `/w/${slug}/settings/admin${page === undefined ? '' : `/${page}`}`;

/**
 * The groups as this member sees them: entries they may not open are left
 * out, and so is a group left with none, never shown locked (AC-682).
 * `permissions` undefined (still loading) keeps only entries that need none;
 * Super admin's entries show only when `isOperator` (spec 0047); a guest's leave out the scheduling ones.
 */
export function visibleSettingsNav(
  groups: readonly SettingsNavGroup[],
  permissions: readonly Permission[] | undefined,
  isOperator = false,
  isGuest = false,
): readonly SettingsNavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        (entry) =>
          (entry.operatorOnly !== true || isOperator) &&
          (entry.notForGuests !== true || !isGuest) &&
          (entry.requires === undefined || (permissions?.includes(entry.requires) ?? false)),
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
  if (rest === 'account/notifications') return 'notifications';
  if (rest === 'account/scheduling') return 'scheduling-access';
  if (rest === 'account/sign-in' || rest === 'account/security') return 'security';
  if (rest === 'objects' || rest.startsWith('objects/')) return 'objects';
  if (rest === 'lists' || rest.startsWith('lists/')) return 'lists';
  if (rest === 'jobs') return 'jobs';
  if (rest === 'automations') return 'automations';
  if (rest === 'history' || rest === 'history/changes' || rest === 'history/sign-ins') return 'history';
  if (rest === 'members') return 'members';
  if (rest === 'teams') return 'teams';
  if (rest === 'security') return 'workspace-security';
  if (rest === 'trash') return 'trash';
  if (rest === 'admin') return 'admin-overview';
  if (rest === 'admin/users' || rest.startsWith('admin/users/')) return 'admin-users';
  if (rest === 'admin/booking-pages' || rest.startsWith('admin/booking-pages/')) return 'admin-pages';
  if (rest === 'admin/website') return 'admin-website';
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
