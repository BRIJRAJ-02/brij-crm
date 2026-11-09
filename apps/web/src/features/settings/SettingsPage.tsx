// Brief
// Purpose: puts one settings page beside the settings sidebar: its trail ("Account › Preferences"), h1 and primary action in the bar, then its body.
// Main task: hand SettingsLayout what the page's route loaded, so every settings page has the same header (AC-683).
// Leaves out: loading anything itself (each settings route's loader read through the data layer), and the sidebar (the settings layout route draws it).
import type { Hue, ObjectIcon } from '@crm/data';
import {
  EmptyState,
  Link,
  SettingsLayout,
  SettingsStack,
  TabPanel,
  Tabs,
  TopBar,
  ViewOnlyTag,
  type Crumb,
  type TabItem,
} from '@crm/ui';
import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import type { ReactNode, Ref } from 'react';
import { createPortal } from 'react-dom';
import { bookingsHref } from '../booking/links.ts';
import { useBookingsSettingsFrame } from '../bookings/settings-frame.ts';
import { strings as bookingsSettings } from '../bookings/settings-strings.ts';
import { useMyAccess, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import {
  objectsSettingsHref,
  profileHref,
  settingsEntryAt,
  settingsEntryOf,
  settingsGroupOf,
  settingsNameAt,
  settingsNav,
  settingsPageOf,
  settingsPathOf,
  visibleSettingsNav,
  type SettingsNavEntry,
} from './nav.ts';
import { strings } from './strings.ts';
import { useSettingsTopBarSlot } from './topBarSlot.ts';

/** What every settings page takes, whatever its body's shape. */
interface SettingsPageBase {
  /** The page's h1 ("Objects", "Projects"), and the last place in its trail. */
  readonly title: string;
  /** Places between the page's group and its title: Objects, on an object's page. */
  readonly crumbs?: readonly Crumb[];
  readonly icon?: ObjectIcon;
  readonly hue?: Hue;
  /** Beside the title: a Standard or Custom badge. */
  readonly meta?: ReactNode;
  /**
   * The viewer may look but not change anything here: a "View only" tag beside the title, whose lock gives this
   * reason ("Only owners and admins can change this."). In place of a callout in the body.
   */
  readonly viewOnly?: string;
  /** The page's one primary action, at the bar's end ("New object", "Connect Google calendar"). */
  readonly actions?: ReactNode;
  /** The visible title, for a page that moves focus to it itself (a cancelled job's Cancel goes away). */
  readonly titleRef?: Ref<HTMLHeadingElement>;
  /**
   * On a page that is one tab of a settings entry (Members' Teams), what the page adds to the entry's tab bar,
   * which SettingsPage draws itself: a count on its own tab, and its tools at the bar's end.
   */
  readonly tabBar?: SettingsTabBar;
  /** Under the tab bar, the body's sections a breath below it (the default), or a Table flush on its hairline. */
  readonly tabBody?: 'sections' | 'table';
  /**
   * The title is the page's own even on an entry's address (a page that isn't there says so), rather than the name
   * the sidebar gives that address. Off by default: the navigation names every settings page (5 November 2026).
   */
  readonly keepsTitle?: boolean;
  readonly children: ReactNode;
}

/** What a tabbed settings page adds to its entry's tab bar. */
export interface SettingsTabBar {
  /** A count after the page's own tab (Members 12). */
  readonly count?: number;
  /** The most that count shows before it reads "N+"; Tabs' own limit when left out. A real headcount gives no limit. */
  readonly countMax?: number;
  /** The page's tools at the bar's end (Members' search), or atop the body when there is no bar. */
  readonly end?: ReactNode;
}

/** A page in the settings column (SettingsLayout): most of them. */
interface ColumnSettingsPageProps extends SettingsPageBase {
  readonly isLoading?: boolean;
  /** While loading: a tile's place before the title, for a page that will have one (an object's). */
  readonly hasTile?: boolean;
  /** The body opens with Tabs: their underline divides the page in place of the header's hairline. */
  readonly hasTabs?: boolean;
  /** At the view's foot: the library SaveBar, for a page that saves its changes with one Save. */
  readonly footer?: ReactNode;
  readonly fillsView?: false;
}

/**
 * The body is a grid that fills the view and scrolls itself (Trash): it sits straight under the bar, edge to
 * edge, with no settings column around it, as a records table does. SettingsLayout is skipped, so the props only
 * it reads (loading, tabs, a footer) can't be given: the body draws its own loading rows.
 */
interface FillSettingsPageProps extends SettingsPageBase {
  readonly fillsView: true;
  readonly isLoading?: never;
  readonly hasTile?: never;
  readonly hasTabs?: never;
  readonly footer?: never;
}

/** Props for one settings page: in the settings column, or (`fillsView`) a grid that fills the view. */
export type SettingsPageProps = ColumnSettingsPageProps | FillSettingsPageProps;

/**
 * A settings page: a TopBar with the page's trail (Settings, its group, any
 * places between, then its title; the bar holds the page's h1) in the frame's
 * bar slot, as every page's TopBar sits, with an object's tile and badge and
 * the page's one primary action at its end, and SettingsLayout below it with
 * the body alone: no title block repeats the trail (21 October 2026).
 */
export function SettingsPage({
  title,
  crumbs = [],
  icon,
  hue,
  meta,
  viewOnly,
  actions,
  isLoading = false,
  hasTile = false,
  titleRef,
  hasTabs = false,
  footer,
  fillsView = false,
  tabBar,
  tabBody = 'sections',
  keepsTitle = false,
  children: body,
}: SettingsPageProps) {
  const { slug = '' } = useParams({ strict: false });
  const pathname = useLocation({ select: (location) => location.pathname });
  const page = settingsPageOf(pathname);
  const group = settingsGroupOf(settingsNav(slug, { hasBusiness: true }), page);
  const access = useMyAccess();
  const navigate = useNavigate();
  // The navigation as this member sees it: the one source of a settings page's name and its trail's places.
  const visible = visibleSettingsNav(
    settingsNav(slug, { hasBusiness: true }),
    access?.permissions,
    false,
    access?.role === 'guest',
  );
  // The entry this page is a tab of, as this member sees it, and only on the tab's own address (a role's page, under
  // Roles and access, has its trail instead).
  const entry = tabbedEntry(settingsEntryOf(visible, page), pathname);
  // On an entry's own address the page is called what the sidebar calls it (5 November 2026: Settings › Business ›
  // Places read "Business › Business", its page titling itself after the group).
  const home = keepsTitle ? undefined : settingsEntryAt(visible, pathname);
  const children =
    entry === undefined ? (
      // With no tab bar to hold them, the page's tools open its body (Members' search, for a guest).
      <>
        {tabBar?.end}
        {body}
      </>
    ) : (
      <EntryTabs entry={entry} page={page} tabBar={tabBar} tabBody={tabBody} onGo={(href) => void navigate({ href })}>
        {body}
      </EntryTabs>
    );
  // One of Bookings settings' pages (9 November 2026): its own grouped navigation beside the body, called what that
  // navigation calls it, under Bookings › Settings, and the way back on a phone is Bookings.
  const bookingsFrame = useBookingsSettingsFrame();
  const bookingsEntry = bookingsFrame?.nav.find((each) => each.id === bookingsFrame.current);
  const shownTitle = (keepsTitle ? undefined : bookingsEntry?.label) ?? entry?.label ?? home?.label ?? title;
  const shownHasTabs = hasTabs || entry !== undefined;
  // Settings heads the trail, so the page says where it is even on a phone, where the sidebar is a rail of icons.
  // TopBar ends it with the title, as the current place. A place the navigation lists reads as the navigation names
  // it (a place's way back to Places, never "Business" again after the group).
  const trail: readonly Crumb[] =
    bookingsFrame !== undefined
      ? [
          { id: 'bookings', label: bookingsSettings.bookings, href: bookingsHref(slug) },
          { id: 'settings', label: bookingsSettings.settings },
          ...crumbs,
        ]
      : [
          { id: 'settings', label: strings.settings },
          ...(group === undefined ? [] : [{ id: group.id, label: group.label }]),
          ...crumbs.map((crumb) => {
            const name = crumb.href === undefined ? undefined : settingsNameAt(visible, crumb.href);
            return name === undefined ? crumb : { ...crumb, label: name };
          }),
        ];
  const slot = useSettingsTopBarSlot();
  const barMeta =
    viewOnly === undefined ? (
      meta
    ) : (
      <>
        {meta}
        <ViewOnlyTag reason={viewOnly} />
      </>
    );
  return (
    <WorkspacePage
      page={{
        topBar: undefined,
        body: (
          <>
            {slot !== null &&
              createPortal(
                // The bar is the page's header (the owner, 21 October 2026): the trail on the left, with an
                // object's tile and badge, and the page's one primary action on the right, where People's
                // "New person" sits. No title block repeats them under it.
                <TopBar
                  title={shownTitle}
                  crumbs={trail}
                  // On a phone the sidebar is hidden on a page (5 November 2026): a chevron back to the list.
                  back={
                    bookingsFrame === undefined
                      ? { label: strings.allSettings, href: `/w/${slug}/settings` }
                      : { label: bookingsSettings.backToBookings, href: bookingsHref(slug) }
                  }
                  // An object's page loads with its tile still unknown: the bar's skeleton holds the trail's place.
                  isLoading={isLoading && hasTile}
                  {...(titleRef === undefined ? {} : { titleRef })}
                  {...(icon === undefined ? {} : { icon })}
                  {...(hue === undefined ? {} : { hue })}
                  {...(barMeta === undefined ? {} : { meta: barMeta })}
                >
                  {actions}
                </TopBar>,
                slot,
              )}
            {fillsView ? (
              // The view is a column: the body's bars take their height, and the grid the rest of it.
              children
            ) : (
              <SettingsLayout
                header="bar"
                {...(bookingsFrame === undefined
                  ? {}
                  : {
                      nav: bookingsFrame.nav,
                      navLabel: bookingsSettings.title,
                      ...(bookingsFrame.current === undefined ? {} : { currentNavId: bookingsFrame.current }),
                    })}
                hasTabs={shownHasTabs}
                title={shownTitle}
                isLoading={isLoading}
                hasTile={hasTile}
                footer={footer}
              >
                {children}
              </SettingsLayout>
            )}
          </>
        ),
      }}
    />
  );
}

/** `entry` when it holds more than one tab and `pathname` is one of those tabs' own address; else undefined. */
function tabbedEntry(entry: SettingsNavEntry | undefined, pathname: string): SettingsNavEntry | undefined {
  const tabs = entry?.tabs;
  if (tabs === undefined || tabs.length < 2) return undefined;
  return tabs.some((tab) => settingsPathOf(tab.href) === settingsPathOf(pathname)) ? entry : undefined;
}

/**
 * The tab bar of an entry that holds several pages (Members · Teams; Roles · Sign in rules; 5 November 2026): one strip
 * under the bar, each tab its own address, the page's body in its tab. (Members' own Invitations tab beside it went on
 * 5 November 2026, owner ask T12: everyone on their way in sits in the members' table.)
 */
function EntryTabs({
  entry,
  page,
  tabBar,
  tabBody,
  onGo,
  children,
}: {
  readonly entry: SettingsNavEntry;
  readonly page: string | undefined;
  readonly tabBar: SettingsTabBar | undefined;
  readonly tabBody: 'sections' | 'table';
  readonly onGo: (href: string) => void;
  readonly children: ReactNode;
}) {
  const tabs = entry.tabs ?? [];
  const items: readonly TabItem[] = tabs.map((tab): TabItem => ({
    id: tab.id,
    label: tab.label,
    href: tab.href,
    ...(tab.id === page && tabBar?.count !== undefined ? { count: tabBar.count } : {}),
    ...(tab.id === page && tabBar?.countMax !== undefined ? { countMax: tabBar.countMax } : {}),
  }));
  const selected = page ?? '';
  return (
    <Tabs
      label={entry.label}
      selectedKey={selected}
      onSelectionChange={(next) => {
        if (next === selected) return;
        const tab = tabs.find((each) => each.id === next);
        if (tab !== undefined) onGo(tab.href);
      }}
      tabs={items}
      {...(tabBar?.end === undefined ? {} : { end: tabBar.end })}
    >
      {items.map((item) => (
        <TabPanel key={item.id} id={item.id}>
          {item.id === selected && (tabBody === 'table' ? children : <SettingsStack>{children}</SettingsStack>)}
        </TabPanel>
      ))}
    </Tabs>
  );
}

/** The places between a settings page's group and its title on an object's page: Objects. */
export function settingsCrumbs(slug: string): readonly Crumb[] {
  return [{ id: 'objects', label: strings.objects, href: objectsSettingsHref(slug) }];
}

/**
 * A settings address that names nothing: an unknown object or tab (the way
 * back is Objects, under its trail), or any other address in Settings (the
 * way back is where Settings opens).
 */
export function SettingsMissing({ backTo = 'objects' }: { readonly backTo?: 'objects' | 'home' }) {
  const { slug = '' } = useParams({ strict: false });
  const isObject = backTo === 'objects';
  return (
    <SettingsPage title={strings.missingTitle} keepsTitle {...(isObject ? { crumbs: settingsCrumbs(slug) } : {})}>
      <EmptyState
        layout="block"
        icon="search"
        title={strings.missingText}
        actions={
          <Link href={isObject ? objectsSettingsHref(slug) : profileHref(slug)}>
            {isObject ? strings.backToObjects : strings.backToSettings}
          </Link>
        }
      />
    </SettingsPage>
  );
}

/** A settings page whose read failed: the frame and navigation stay, the body says so with Retry (AC-247). */
export function SettingsFailed({
  title,
  heading,
  text,
  onRetry,
}: {
  /** The page's title ("Objects"). */
  readonly title: string;
  /** What failed ("Couldn't load the objects"). */
  readonly heading: string;
  /** Why, in the data layer's words ("Can't reach the CRM" only when the network failed). */
  readonly text: string;
  readonly onRetry: () => void;
}) {
  return (
    <SettingsPage title={title}>
      <EmptyState layout="block" tone="error" title={heading} onRetry={onRetry}>
        {text}
      </EmptyState>
    </SettingsPage>
  );
}
