// Where settings pages are, which ones exist and how the settings navigation
// groups them (specs 0012 and 0026). Plain functions with no React or library
// imports, so any screen can use them without pulling another screen in. It
// carries every settings page's title, and so their words: a route's loader
// (in the first load) imports a small module of its own instead, as the object
// settings route does with object-tabs.ts.
import type { ObjectSummary, Permission } from '@crm/data';
import { strings as listStrings } from '../lists/strings.ts';
import { trashHref } from '../workspace/objects.ts';
import { historyHref } from './history-href.ts';
import { strings as history } from './history-nav-strings.ts';
import { strings as members } from './members-strings.ts';
import { strings as notifications } from './notifications-strings.ts';
import { strings as schedulingAccess } from './scheduling-access-nav-strings.ts';
import { strings as brand } from './brand-strings.ts';
import { strings as teams } from './teams-nav-strings.ts';
import { strings as roles } from './roles-nav-strings.ts';
import { strings as security } from './security-strings.ts';
import { strings } from './strings.ts';
import { strings as workspace } from './workspace-strings.ts';
import { navStrings as admin } from '../admin/nav-strings.ts';
import { strings as hospitality } from '../hospitality/strings.ts';
import { strings as services } from '../services/strings.ts';
import type { ObjectTab } from './object-tabs.ts';

export { OBJECT_TABS, isObjectTab, type ObjectTab } from './object-tabs.ts';
export { HISTORY_TABS, historyHref, isHistoryTab, type HistoryTab } from './history-href.ts';

/** Settings, Objects. */
export const objectsSettingsHref = (slug: string) => `/w/${slug}/settings/objects`;

/** Settings › Data › Lists (spec 0048, AC-4828). */
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

/** Settings › Account › Profile (spec 0031, AC-821): the member's own name and picture. Settings' first entry. */
export const profileHref = (slug: string) => `/w/${slug}/settings/account/profile`;

/** Settings › Account › Preferences (spec 0026): the interface theme. */
export const preferencesHref = (slug: string) => `/w/${slug}/settings/account/preferences`;

/** Settings › Workspace › General (spec 0031, AC-822): the workspace's name, time zone and address, and its delete. */
export const generalSettingsHref = (slug: string) => `/w/${slug}/settings/general`;

/** Settings › Workspace › Brand (spec 0060, AC-1): the logo, colour and template its booking pages and forms wear. */
export const brandSettingsHref = (slug: string) => `/w/${slug}/settings/brand`;

/** Settings › Workspace › Apps (spec 0065, AC-6501): the apps a workspace installs (the Hospitality suite today). */
export const appsSettingsHref = (slug: string) => `/w/${slug}/settings/apps`;

/** Settings › Business › Places (spec 0065, AC-6507): the business profile and its places. */
export const businessSettingsHref = (slug: string) => `/w/${slug}/settings/business`;
/** Settings › Business › Page (spec 0066, B4 lite): the business's public page. */
export const businessPageHref = (slug: string) => `/w/${slug}/settings/business/page`;

/** Settings › Business › Services (spec 0066 B1): the catalogue clients book from. */
export const servicesSettingsHref = (slug: string) => `/w/${slug}/settings/services`;
/** Settings › Business › Staff (spec 0066 B1): the people clients book. */
export const staffSettingsHref = (slug: string) => `/w/${slug}/settings/staff`;
/** One staff member's profile (spec 0066 B1), by id. */
export const staffProfileHref = (slug: string, staffId: string) => `/w/${slug}/settings/staff/${staffId}`;
/** Settings › Business › Shifts (spec 0066 B1): who works when, per place and week (`?place=&week=`). */
export const shiftsSettingsHref = (slug: string, query: { readonly place?: string; readonly week?: string } = {}) => {
  const params = new URLSearchParams({
    ...(query.place === undefined ? {} : { place: query.place }),
    ...(query.week === undefined ? {} : { week: query.week }),
  }).toString();
  return `/w/${slug}/settings/shifts${params === '' ? '' : `?${params}`}`;
};

/** One place's tables and areas (spec 0065, AC-6509), under Settings › Business › Places. */
export const placeTablesHref = (slug: string, placeId: string) => `/w/${slug}/settings/business/places/${placeId}`;

/** Settings › People › Members (spec 0031): who is in the workspace, and (its second tab) the invitations out. */
export const membersSettingsHref = (slug: string) => `/w/${slug}/settings/members`;

/** Settings › People › Members › Teams (spec 0031, slice 8): the groups of people that access rules name. */
export const teamsSettingsHref = (slug: string) => `/w/${slug}/settings/teams`;

/** Settings › People › Roles and access (spec 0037, AC-1239): every role and what it can do. */
export const rolesSettingsHref = (slug: string) => `/w/${slug}/settings/roles`;

/** One role's page (spec 0037, AC-1240), by its id: a built in role's name, or a custom role's uuid. */
export const roleHref = (slug: string, roleId: string) => `/w/${slug}/settings/roles/${roleId}`;

/** Settings › People › Roles and access › Sign in rules (spec 0033, milestone 4): the workspace's, owners only. */
export const workspaceSecurityHref = (slug: string) => `/w/${slug}/settings/security`;

/** Settings › Account › Notifications (spec 0038): the member's email for this workspace. */
export const notificationSettingsHref = (slug: string) => `/w/${slug}/settings/account/notifications`;

/** Settings › Account › Sign in and security (spec 0033): two factor, the devices signed in and recent sign ins. */
export const securitySettingsHref = (slug: string) => `/w/${slug}/settings/account/sign-in`;

/** Settings › Account › Calendars (specs 0024 and 0026): the one place a member connects and disconnects calendars. */
export const calendarsSettingsHref = (slug: string) => `/w/${slug}/settings/account/calendars`;

/** Settings › Scheduling › Availability (spec 0035): the member's schedules, the screen Bookings' tab shows too. */
export const availabilitySettingsHref = (slug: string) => `/w/${slug}/settings/scheduling/availability`;

/** Settings › Scheduling › Round robin (spec 0029): the groups a booking is shared out between. */
export const roundRobinSettingsHref = (slug: string) => `/w/${slug}/settings/scheduling/round-robin`;

/** Settings › Scheduling › Routing (spec 0037, AC-1383): what every routed form and team page shares. */
export const routingSettingsHref = (slug: string) => `/w/${slug}/settings/scheduling/routing`;

/** Settings › Scheduling › Scheduling access (spec 0037, AC-1266): who can see or manage the member's scheduling. */
export const schedulingAccessHref = (slug: string) => `/w/${slug}/settings/scheduling/access`;

/** Settings › Super admin (spec 0047): Overview, or one of its pages. */
export const adminHref = (slug: string, page?: 'users' | 'booking-pages' | 'website') =>
  `/w/${slug}/settings/admin${page === undefined ? '' : `/${page}`}`;

/** Every settings page the navigation knows, by id. */
export type SettingsPageId =
  | 'profile'
  | 'preferences'
  | 'notifications'
  | 'security'
  | 'calendars'
  | 'general'
  | 'brand'
  | 'history'
  | 'apps'
  | 'business'
  | 'services'
  | 'staff'
  | 'shifts'
  | 'members'
  | 'teams'
  | 'roles'
  | 'workspace-security'
  | 'availability'
  | 'round-robin'
  | 'routing'
  | 'scheduling-access'
  | 'objects'
  | 'lists'
  | 'trash'
  | 'jobs'
  | 'admin-overview'
  | 'admin-users'
  | 'admin-pages'
  | 'admin-website';

/** The settings navigation's groups, in order (spec 0026, AC-682; regrouped on 5 November 2026). */
export type SettingsGroupId = 'account' | 'workspace' | 'people' | 'scheduling' | 'business' | 'data' | 'admin';

/** The icon an entry wears: each entry its own, so the phone's list never shows one twice. */
export type SettingsIcon =
  | 'user-round'
  | 'sliders-horizontal'
  | 'bell'
  | 'shield-check'
  | 'calendar'
  | 'building'
  | 'palette'
  | 'clock'
  | 'users'
  | 'key'
  | 'calendar-clock'
  | 'refresh-cw'
  | 'git-branch'
  | 'eye'
  | 'box'
  | 'list'
  | 'trash'
  | 'chart-line'
  | 'users-round'
  | 'calendar-days'
  | 'globe'
  | 'blocks'
  | 'store'
  | 'scissors'
  | 'id-card'
  | 'calendar-check';

/** One tab of a settings entry that holds several pages (Members' Teams): its own page and address. */
export interface SettingsTab {
  readonly id: SettingsPageId;
  readonly label: string;
  readonly href: string;
  /** A permission the tab's page needs; absent, every member may open it. */
  readonly requires?: Permission;
  /** Not for a guest (spec 0031, slice 9). */
  readonly notForGuests?: true;
  /** Other words for this tab's page, for Find a setting and ⌘K ("session length" finds Sign in rules). */
  readonly keywords?: readonly string[];
}

/** One entry in the settings navigation. */
export interface SettingsNavEntry {
  readonly id: SettingsPageId;
  readonly label: string;
  readonly href: string;
  readonly icon: SettingsIcon;
  /** A quiet word after the name. */
  readonly meta?: string;
  /** Other words a person may type into "Find a setting" for this page (2FA, password, logo). */
  readonly keywords?: readonly string[];
  /** A permission the page needs before the member may open it at all; absent, every member may. */
  readonly requires?: Permission;
  /**
   * Only for a super admin (spec 0047): the api's `OPERATOR_EMAILS`, which `me.get` reports as `isOperator`. Never
   * a workspace permission; the server checks every read on its own.
   */
  readonly operatorOnly?: true;
  /** Not for a guest (spec 0031, slice 9): a page about scheduling or the CRM's data, which guests have none of. */
  readonly notForGuests?: true;
  /**
   * The pages this one entry holds as tabs, the first being the entry's own (the owner, 4 November 2026). Each tab
   * keeps its own address, so old links still land. `visibleSettingsNav` keeps the tabs the member may open, points
   * the entry at the first, and names it after that tab when it is the only one.
   */
  readonly tabs?: readonly SettingsTab[];
}

/** One group of the settings navigation, under its label. */
export interface SettingsNavGroup {
  readonly id: SettingsGroupId;
  readonly label: string;
  readonly entries: readonly SettingsNavEntry[];
}

/**
 * Settings › Business (spec 0065, 0066 B1): its places, hours and tables for `hospitality.manage`, the catalogue and
 * the profiles for `services.manage`, the shifts for `services.calendar` (the front desk sets the rota without the
 * catalogue). Shown only while Appointments or Table seating is installed.
 */
function businessGroup(slug: string): SettingsNavGroup {
  return {
    id: 'business',
    label: strings.business,
    entries: [
      {
        id: 'business',
        label: strings.places,
        href: businessSettingsHref(slug),
        icon: 'store',
        requires: 'hospitality.manage',
        keywords: ['business', 'profile', 'tables', 'opening hours', 'business page'],
      },
      {
        id: 'services',
        label: services.servicesTitle,
        href: servicesSettingsHref(slug),
        icon: 'scissors',
        requires: 'services.manage',
        keywords: ['catalogue', 'prices', 'treatments'],
      },
      {
        id: 'staff',
        label: services.staffTitle,
        href: staffSettingsHref(slug),
        icon: 'id-card',
        requires: 'services.manage',
        keywords: ['stylists', 'team', 'profiles'],
      },
      {
        id: 'shifts',
        label: services.shiftsTitle,
        href: shiftsSettingsHref(slug),
        icon: 'calendar-check',
        requires: 'services.calendar',
        keywords: ['rota', 'roster', 'working hours'],
      },
    ],
  };
}

/**
 * The settings navigation (spec 0026, AC-682), as decided on 5 November 2026 (the owner delegates the call): Account
 * (the member's own, Calendars included), Workspace (what the whole workspace wears, and its History), People (who
 * is in it and what they may do), Scheduling (the screens Bookings' tabs show, so every setting is under Settings),
 * Business (only while Appointments or Table seating is installed), Data (Objects, Lists and Trash), then Super
 * admin for operators. Webhooks, Automations, Developer and Background
 * jobs stay parked out of the navigation until each is built properly; their addresses redirect, or (jobs) stay
 * for the links already sent.
 */
export function settingsNav(
  slug: string,
  options: {
    /**
     * Whether Appointments or Table seating is installed (spec 0065, 0066): only then does the Business group show
     * (Places, Services, Staff and Shifts). Absent, the group is left out.
     */
    readonly hasBusiness?: boolean;
  } = {},
): readonly SettingsNavGroup[] {
  return [
    {
      id: 'account',
      label: strings.account,
      entries: [
        {
          id: 'profile',
          label: workspace.profileTitle,
          href: profileHref(slug),
          icon: 'user-round',
          keywords: ['name', 'photo', 'picture', 'avatar', 'public profile'],
        },
        {
          id: 'preferences',
          label: strings.preferences,
          href: preferencesHref(slug),
          icon: 'sliders-horizontal',
          keywords: ['theme', 'dark', 'light', 'appearance'],
        },
        {
          id: 'notifications',
          label: notifications.title,
          href: notificationSettingsHref(slug),
          icon: 'bell',
          keywords: ['email', 'alerts'],
        },
        {
          id: 'security',
          label: security.title,
          href: securitySettingsHref(slug),
          icon: 'shield-check',
          keywords: ['two factor', '2fa', 'devices', 'sessions', 'sign ins', 'backup codes', 'google', 'sign out'],
        },
        // The one place to connect a calendar (5 November 2026); Bookings links here for setup.
        {
          id: 'calendars',
          label: strings.calendars,
          href: calendarsSettingsHref(slug),
          icon: 'calendar',
          notForGuests: true,
          keywords: ['google', 'outlook', 'microsoft', 'connect', 'sync'],
        },
      ],
    },
    {
      id: 'workspace',
      label: strings.workspace,
      entries: [
        {
          id: 'general',
          label: workspace.generalTitle,
          href: generalSettingsHref(slug),
          icon: 'building',
          keywords: ['name', 'address', 'time zone', 'url', 'delete workspace'],
        },
        // Brand (spec 0060): every member but a guest reads it; owners and admins change it.
        {
          id: 'brand',
          label: brand.navLabel,
          href: brandSettingsHref(slug),
          icon: 'palette',
          notForGuests: true,
          keywords: ['logo', 'colour', 'color', 'template'],
        },
        // History (spec 0046): the workspace's changes, for `audit.read` alone. Each member's own sign ins are in
        // Account › Sign in and security.
        {
          id: 'history',
          label: history.title,
          href: historyHref(slug),
          icon: 'clock',
          requires: 'audit.read',
          keywords: ['audit', 'log', 'changes', 'activity'],
        },
        // Apps (spec 0065, AC-6501): owners and admins install them, so nobody else sees the entry at all.
        {
          id: 'apps',
          label: hospitality.appsTitle,
          href: appsSettingsHref(slug),
          icon: 'blocks',
          requires: 'workspace.manage',
          keywords: ['hospitality', 'menu', 'qr', 'table seating', 'appointments', 'install'],
        },
      ],
    },
    {
      id: 'people',
      label: strings.people,
      entries: [
        // Members, with Teams (spec 0031, slice 8); everyone on their way in sits in Members' own table (owner ask T12).
        {
          id: 'members',
          label: members.title,
          href: membersSettingsHref(slug),
          icon: 'users',
          keywords: ['invite', 'invitations', 'invite link', 'email domain', 'remove member'],
          tabs: [
            { id: 'members', label: members.title, href: membersSettingsHref(slug) },
            { id: 'teams', label: teams.title, href: teamsSettingsHref(slug), notForGuests: true },
          ],
        },
        // Roles (spec 0037, AC-1239) and the workspace's sign in rules (spec 0033): every member but a guest reads
        // the roles; the rules are for owners (`security.manage`) alone.
        {
          id: 'roles',
          label: strings.rolesAndAccess,
          href: rolesSettingsHref(slug),
          icon: 'key',
          keywords: ['permissions', 'admin', 'owner'],
          tabs: [
            { id: 'roles', label: roles.title, href: rolesSettingsHref(slug), notForGuests: true },
            {
              id: 'workspace-security',
              label: strings.signInRules,
              href: workspaceSecurityHref(slug),
              requires: 'security.manage',
              keywords: ['require two factor', 'security', 'session length', 'sign out everyone'],
            },
          ],
        },
      ],
    },
    {
      // The screens Bookings' tabs show (spec 0037), here too so every setting is under Settings. One screen each;
      // Bookings' tabs stay as shortcuts to them.
      id: 'scheduling',
      label: strings.scheduling,
      entries: [
        {
          id: 'availability',
          label: strings.availability,
          href: availabilitySettingsHref(slug),
          icon: 'calendar-clock',
          notForGuests: true,
          keywords: ['hours', 'schedule', 'working hours', 'time off', 'limits'],
        },
        {
          id: 'round-robin',
          label: strings.roundRobin,
          href: roundRobinSettingsHref(slug),
          icon: 'refresh-cw',
          requires: 'booking.manage',
          keywords: ['rotation', 'groups', 'team booking'],
        },
        {
          id: 'routing',
          label: strings.routing,
          href: routingSettingsHref(slug),
          icon: 'git-branch',
          requires: 'routing.manage',
          keywords: ['skills', 'decisions', 'routed forms'],
        },
        {
          id: 'scheduling-access',
          label: schedulingAccess.title,
          href: schedulingAccessHref(slug),
          icon: 'eye',
          notForGuests: true,
          keywords: ['manage', 'delegate', 'calendar access'],
        },
      ],
    },
    // The business, only while Appointments or Table seating is installed (`businessGroup`).
    ...(options.hasBusiness === true ? [businessGroup(slug)] : []),
    {
      id: 'data',
      label: strings.data,
      entries: [
        {
          id: 'objects',
          label: strings.objects,
          href: objectsSettingsHref(slug),
          icon: 'box',
          notForGuests: true,
          keywords: ['attributes', 'fields'],
        },
        // Lists (spec 0048, AC-4828): every member but a guest; they see the lists they may read.
        {
          id: 'lists',
          label: listStrings.settingsTitle,
          href: listsSettingsHref(slug),
          icon: 'list',
          notForGuests: true,
        },
        // The trash opens inside Settings (A120, 23 October 2026); ⌘K's Open trash reaches the same address.
        {
          id: 'trash',
          label: strings.trash,
          href: trashHref(slug),
          icon: 'trash',
          keywords: ['deleted', 'restore', 'bin'],
        },
      ],
    },
    {
      // The operator console (spec 0047): super admins only, so nobody else sees the group at all.
      id: 'admin',
      label: admin.group,
      entries: [
        { id: 'admin-overview', label: admin.overview, href: adminHref(slug), icon: 'chart-line', operatorOnly: true },
        {
          id: 'admin-users',
          label: admin.users,
          href: adminHref(slug, 'users'),
          icon: 'users-round',
          operatorOnly: true,
        },
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
  const mayOpen = (entry: Pick<SettingsNavEntry, 'operatorOnly' | 'notForGuests' | 'requires'>) =>
    (entry.operatorOnly !== true || isOperator) &&
    (entry.notForGuests !== true || !isGuest) &&
    (entry.requires === undefined || (permissions?.includes(entry.requires) ?? false));
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter(mayOpen).flatMap((entry): readonly SettingsNavEntry[] => {
        if (entry.tabs === undefined) return [entry];
        const tabs = entry.tabs.filter(mayOpen);
        const [first] = tabs;
        if (first === undefined) return [];
        // The entry opens its first tab the member may open; alone, it takes that tab's name.
        return [{ ...entry, href: first.href, label: tabs.length === 1 ? first.label : entry.label, tabs }];
      }),
    }))
    .filter((group) => group.entries.length > 0);
}

/** One place "Find a setting" can open: an entry, or one tab of it (Teams), with where it sits. */
export interface SettingsSearchHit {
  readonly id: SettingsPageId;
  readonly label: string;
  readonly href: string;
  readonly icon: SettingsIcon;
  /** The group, and the entry for a tab ("People › Members"), shown quietly after the label. */
  readonly where: string;
}

/** Lower case, accents and punctuation gone, so "Two-factor" finds "two factor". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * "Find a setting" (5 November 2026, as Vercel's and Linear's settings search): the places among `groups` (the
 * member's visible ones) whose name, group or keywords hold every word typed, best first: a name that starts with
 * the query, then a name holding it, then the rest, each in the navigation's order. An empty query finds nothing.
 */
export function searchSettings(groups: readonly SettingsNavGroup[], query: string): readonly SettingsSearchHit[] {
  const words = fold(query)
    .split(' ')
    .filter((word) => word !== '');
  if (words.length === 0) return [];
  const whole = words.join(' ');
  const places = groups.flatMap((group) =>
    group.entries.flatMap((entry) => [
      {
        hit: { id: entry.id, label: entry.label, href: entry.href, icon: entry.icon, where: group.label },
        keywords: entry.keywords ?? [],
      },
      ...(entry.tabs ?? [])
        .filter((tab) => tab.href !== entry.href)
        .map((tab) => ({
          hit: {
            id: tab.id,
            label: tab.label,
            href: tab.href,
            icon: entry.icon,
            where: `${group.label} › ${entry.label}`,
          },
          keywords: tab.keywords ?? [],
        })),
    ]),
  );
  return places
    .map(({ hit, keywords }, order) => {
      const name = fold(hit.label);
      const haystack = [name, fold(hit.where), ...keywords.map(fold)].join(' ');
      const rank = name.startsWith(whole) ? 0 : name.includes(whole) ? 1 : 2;
      return { hit, order, rank, isHit: words.every((word) => haystack.includes(word)) };
    })
    .filter((each) => each.isHit)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ hit }) => hit);
}

/** An address without its query or trailing slashes, so a link's address compares with the one shown. */
export const settingsPathOf = (href: string) => (href.split('?')[0] ?? href).replace(/\/+$/, '');

/**
 * The entry whose own address `pathname` is (Settings › Business › Places at `/settings/business`), so the page is
 * called what the sidebar calls it; undefined anywhere else (one of its tabs, a page under it, an unknown address).
 */
export function settingsEntryAt(groups: readonly SettingsNavGroup[], pathname: string): SettingsNavEntry | undefined {
  const path = settingsPathOf(pathname);
  return groups.flatMap((group) => group.entries).find((entry) => settingsPathOf(entry.href) === path);
}

/**
 * What the navigation calls an address: a tab's name on its own address (Roles, under Roles and access), else its
 * entry's (Places); undefined for an address it doesn't list. A settings trail names its places with it, so a page's
 * own words for the way back (a place's "Business") never disagree with the sidebar (5 November 2026).
 */
export function settingsNameAt(groups: readonly SettingsNavGroup[], href: string): string | undefined {
  const path = settingsPathOf(href);
  const entries = groups.flatMap((group) => group.entries);
  const tab = entries.flatMap((entry) => entry.tabs ?? []).find((each) => settingsPathOf(each.href) === path);
  return tab?.label ?? entries.find((entry) => settingsPathOf(entry.href) === path)?.label;
}

/** The navigation entry that holds `page`: the page's own, or the one it is a tab of (Teams is in Members). */
export function settingsEntryOf(
  groups: readonly SettingsNavGroup[],
  page: SettingsPageId | undefined,
): SettingsNavEntry | undefined {
  if (page === undefined) return undefined;
  const entries = groups.flatMap((group) => group.entries);
  return (
    entries.find((entry) => entry.id === page) ?? entries.find((entry) => entry.tabs?.some((tab) => tab.id === page))
  );
}

/** The settings page an address shows, as the navigation marks it current; undefined for none (an unknown address). */
export function settingsPageOf(pathname: string): SettingsPageId | undefined {
  const match = /^\/w\/[^/]+\/settings\/(.+?)\/*$/.exec(pathname);
  const rest = match?.[1] ?? '';
  const under = (base: string) => rest === base || rest.startsWith(`${base}/`);
  if (rest === 'account/profile') return 'profile';
  if (rest === 'account/preferences') return 'preferences';
  if (rest === 'account/notifications') return 'notifications';
  if (rest === 'account/sign-in' || rest === 'account/security') return 'security';
  if (rest === 'account/calendars') return 'calendars';
  if (rest === 'general') return 'general';
  if (rest === 'brand') return 'brand';
  if (rest === 'apps') return 'apps';
  if (under('business')) return 'business';
  if (rest === 'services') return 'services';
  if (under('staff')) return 'staff';
  if (rest === 'shifts') return 'shifts';
  if (under('history')) return 'history';
  if (rest === 'members') return 'members';
  if (rest === 'teams') return 'teams';
  if (under('roles')) return 'roles';
  if (rest === 'security') return 'workspace-security';
  if (rest === 'scheduling/availability') return 'availability';
  if (rest === 'scheduling/round-robin') return 'round-robin';
  if (rest === 'scheduling/routing') return 'routing';
  if (rest === 'scheduling/access' || rest === 'account/scheduling') return 'scheduling-access';
  if (under('objects')) return 'objects';
  if (under('lists')) return 'lists';
  if (rest === 'trash') return 'trash';
  if (rest === 'jobs') return 'jobs';
  if (rest === 'admin') return 'admin-overview';
  if (under('admin/users')) return 'admin-users';
  if (under('admin/booking-pages')) return 'admin-pages';
  if (rest === 'admin/website') return 'admin-website';
  return undefined;
}

/** The group a settings page sits in, for its trail ("Account › Preferences"). */
export function settingsGroupOf(
  groups: readonly SettingsNavGroup[],
  page: SettingsPageId | undefined,
): SettingsNavGroup | undefined {
  const entry = settingsEntryOf(groups, page);
  return entry === undefined ? undefined : groups.find((group) => group.entries.includes(entry));
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
