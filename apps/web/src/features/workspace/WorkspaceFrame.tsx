// Brief
// Purpose: the frame every page inside a workspace sits in: the sidebar beside the page (inside Settings, the settings sidebar).
// Main task: move between Tasks, the member's sections (Records, then Scheduling) in their own order, and the trash; fold, reorder or hide, or fold the whole sidebar, kept for the member on every device (spec 0034); open Settings (⌘,), the shortcuts (?) and sign out; undo (⌘Z).
// Leaves out: the workspace menu's contents (spec 0031), Quick actions (the command menu), Inbox, Lists and Invite teammates (features still to come), starring (spec 0034's milestone 3), and the theme (Settings › Preferences).
import type { DataLayer, NavSnapshot, NavSource, NavState, NavUniverse, ObjectSummary, Permission } from '@crm/data';
import { useNav } from '@crm/data/react';
import {
  AppShell,
  AppShellContext,
  GRID_SHORTCUTS,
  Menu,
  MenuItem,
  MenuSection,
  NavGroup,
  NavItem,
  NavSection,
  ProviderMark,
  ShortcutHelp,
  Sidebar,
  type Toasts,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { settingsNav, visibleSettingsNav, type SettingsPageId } from '../settings/nav.ts';
import { strings as settingsStrings } from '../settings/strings.ts';
import { CalendarBanner } from './CalendarBanner.tsx';
import { settingsHomeHref, trashHref } from './objects.ts';
import { keepRailHint, readRailHint } from './rail.ts';
import { PAGE_LINKS, topEntries, universeOf, type SidebarPage } from './sidebar.ts';
import { itemMenu, SidebarSections } from './SidebarSections.tsx';
import { strings } from './strings.ts';
import { belongsElsewhere, isRailKey, RAIL_KEYS, SETTINGS_KEYS, UNDO_KEYS, type KeyTarget } from './undo.ts';
import { useUndoShortcut } from './useUndoShortcut.ts';

export type { SidebarPage } from './sidebar.ts';

// Behind a section's menu, so it loads only when first opened.
const CustomiseSidebarDialog = lazy(() =>
  import('./CustomiseSidebarDialog.tsx').then((module) => ({ default: module.CustomiseSidebarDialog })),
);

/**
 * What the sidebar draws when the member's own couldn't be read (spec 0034): the defaults, with the pages every
 * member has. The data layer says it couldn't, with Retry, and reads it again after the next change that lands.
 * When guests arrive (spec 0031), who see no Scheduling pages, this takes the pages from the person's role.
 */
const DEFAULT_NAV: NavState = {
  items: [],
  sections: { order: ['favourites', 'records', 'lists', 'scheduling'], folded: [] },
  rail: false,
  version: 0,
  favourites: [],
  top: ['tasks'],
  scheduling: ['bookings', 'availability', 'booking_pages', 'forms'],
};

/** Nothing read, ever: one snapshot, so React sees no change. */
const NOT_READ: NavSnapshot = { status: 'loading' };

/** No sidebar to hold: a workspace that isn't there, or isn't the person's, has none to read. */
const NO_NAV: NavSource = {
  retain: () => () => undefined,
  subscribe: () => () => undefined,
  getSnapshot: () => NOT_READ,
};

/** Inside Settings (spec 0026): the settings sidebar's current page and the way back out. */
export interface SettingsSidebar {
  /** The page shown, marked current; undefined on an address that names none. */
  readonly current?: SettingsPageId;
  /** Where the back link goes: the page Settings was opened from, else the workspace's home. */
  readonly backHref: string;
}

/** Props for the workspace frame. */
export interface WorkspaceFrameProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  /** The workspace's address. */
  readonly slug: string;
  /** Its name at the top of the sidebar; the product's name while it isn't known. */
  readonly workspaceName?: string;
  /** The person's role here ("Owner", "Admin" or "Member"), heading the workspace menu once it is known. */
  readonly roleLabel?: string;
  /** Its objects; undefined while they load, so the Records section shows skeleton rows. */
  readonly objects?: readonly ObjectSummary[];
  /** The workspace doesn't exist, isn't the person's, or failed to load: no Records section at all. */
  readonly isMissing?: boolean;
  /** The `apiSlug` of the object whose page is open. */
  readonly currentObject?: string;
  /** A page of the sidebar's that isn't an object's: Tasks, a Scheduling page or the trash. */
  readonly currentPage?: SidebarPage;
  /** Inside Settings: the settings sidebar in place of the app's (spec 0026, AC-681). */
  readonly settings?: SettingsSidebar;
  /** The person's permissions here, which settings pages they may open; undefined while they load. */
  readonly permissions?: readonly Permission[];
  /** The page's TopBar. */
  readonly topBar?: ReactNode;
  /** The view's ViewBar, on an object's page. */
  readonly viewBar?: ReactNode;
  /** The view's Toolbar (its sorts, filters and Save), on a view (spec 0020). */
  readonly toolbar?: ReactNode;
  readonly children: ReactNode;
}

/**
 * AppShell and the Sidebar (spec 0034): the workspace's name with Sign out in
 * its menu (the button spins while it signs out), Tasks, the member's
 * sections in their order and folds, and Trash, Settings and Help at the
 * foot; the rail as they left it. Inside Settings, the settings sidebar
 * instead: the way back, then the settings pages in their groups.
 */
export function WorkspaceFrame({
  data,
  toasts,
  slug,
  workspaceName,
  roleLabel,
  objects,
  isMissing = false,
  currentObject,
  currentPage,
  settings,
  permissions,
  topBar,
  viewBar,
  toolbar,
  children,
}: WorkspaceFrameProps) {
  const navigate = useNavigate();
  const [isSigningOut, setSigningOut] = useState(false);
  // Cmd+Z (Ctrl+Z elsewhere) undoes this tab's last change; ? lists the shortcuts (spec 0006, AC-48).
  const [isHelpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);
  // ⌘, (Ctrl+, elsewhere) opens Settings from anywhere in the workspace (spec 0026, AC-685); inside it, it puts
  // focus on the current page in the settings sidebar, so the key still answers.
  const openSettings = useCallback(() => {
    if (settings === undefined) {
      void navigate({ href: settingsHomeHref(slug) });
      return;
    }
    document.querySelector<HTMLElement>('nav[data-keyboard="arrows"] [aria-current="page"]')?.focus();
  }, [navigate, settings, slug]);
  useUndoShortcut(data, toasts, slug, openHelp, openSettings);
  // The member's own sidebar (spec 0034): read with the workspace (AC-936), each change shown at once (AC-937). While
  // it loads, Records alone shows loading; read and failed, the defaults show, and the data layer says so.
  const snapshot = useNav(isMissing ? NO_NAV : data.nav.source(slug));
  const nav = snapshot.status === 'ready' ? snapshot.nav : snapshot.status === 'error' ? DEFAULT_NAV : undefined;
  const universe = useMemo(() => universeOf(objects, nav ?? DEFAULT_NAV), [objects, nav]);
  const isRail = nav?.rail ?? readRailHint(slug);
  const keptRail = snapshot.status === 'ready' ? snapshot.nav.rail : undefined;
  useEffect(() => {
    if (keptRail !== undefined) keepRailHint(slug, keptRail);
  }, [slug, keptRail]);
  const setRail = useCallback(
    (on: boolean) => {
      void data.nav.change(slug, { op: 'rail', on }, universe);
    },
    [data, slug, universe],
  );
  const [isCustomising, setCustomising] = useState(false);
  const [hasCustomised, setHasCustomised] = useState(false);
  const openCustomise = useCallback(() => {
    setHasCustomised(true);
    setCustomising(true);
  }, []);
  const signOut = () => {
    if (isSigningOut) return;
    setSigningOut(true);
    data.auth.signOut().then(
      () => {
        void navigate({ to: '/sign-in', replace: true });
      },
      () => {
        setSigningOut(false);
        toasts.toast({ tone: 'danger', message: strings.signOutFailed });
      },
    );
  };
  return (
    <AppShell
      topBar={topBar}
      viewBar={viewBar}
      toolbar={toolbar}
      // A calendar that stopped syncing says so on every page (spec 0024, AC-619).
      banner={isMissing ? undefined : <CalendarBanner data={data} slug={slug} />}
      sidebar={
        settings !== undefined ? (
          <SettingsNavigation slug={slug} settings={settings} permissions={permissions} />
        ) : (
          <Sidebar
            workspace={workspaceName ?? strings.product}
            // Timefix's mark heads the sidebar, as in timefix (F29); the workspace's name stays the switcher's.
            mark={<ProviderMark provider="timefix" size="lg" />}
            // Not known yet: skeletons, never the product's name as a stand in that then changes.
            isWorkspaceLoading={workspaceName === undefined && !isMissing}
            isWorkspaceBusy={isSigningOut}
            workspaceBusyLabel={strings.signingOut}
            workspaceMenu={
              <Menu
                label={strings.workspaceMenu}
                onAction={(key) => {
                  if (key === 'sign-out') signOut();
                  if (key === 'shortcuts') openHelp();
                }}
              >
                {roleLabel === undefined ? (
                  <>
                    <MenuItem id="settings" icon="settings" href={settingsHomeHref(slug)} kbd="⌘,">
                      {strings.settings}
                    </MenuItem>
                    <MenuItem id="sign-out">{strings.signOut}</MenuItem>
                  </>
                ) : (
                  // The person's role heads the menu (spec 0009, AC-136); Settings sits above Sign out (spec 0012).
                  <MenuSection label={roleLabel}>
                    <MenuItem id="settings" icon="settings" href={settingsHomeHref(slug)} kbd="⌘,">
                      {strings.settings}
                    </MenuItem>
                    <MenuItem id="sign-out">{strings.signOut}</MenuItem>
                  </MenuSection>
                )}
                {/* The shortcut list, also on ?, so it can be found with the pointer too. */}
                <MenuItem id="shortcuts" kbd="?">
                  {strings.keyboardShortcuts}
                </MenuItem>
              </Menu>
            }
            // The member's rail (AC-935), kept for them; below the compact breakpoint the shell folds it anyway, and
            // the buttons wait for their sidebar, so a press never lands on a guess.
            isCollapsed={isRail}
            {...(nav === undefined || isMissing ? {} : { onCollapsedChange: setRail })}
            // The foot (AC-930): Trash for every member, Settings with ⌘, (spec 0026, AC-685), and Help, which opens
            // the keyboard shortcuts until a help centre exists. Invite teammates joins with spec 0031's invite flow.
            footer={
              <>
                {!isMissing && (
                  <NavItem icon="trash" href={trashHref(slug)} isCurrent={currentPage === 'trash'}>
                    {strings.trash}
                  </NavItem>
                )}
                <NavItem icon="settings" href={settingsHomeHref(slug)} kbd="⌘,">
                  {strings.settings}
                </NavItem>
                <NavItem icon="circle-question-mark" onPress={openHelp} kbd="?">
                  {strings.help}
                </NavItem>
              </>
            }
          >
            {!isMissing && nav !== undefined && (
              <TopPages
                slug={slug}
                nav={nav}
                universe={universe}
                currentPage={currentPage}
                onHide={(page) => {
                  void data.nav.change(slug, { op: 'hide', kind: 'page', id: page }, universe);
                }}
              />
            )}
            {!isMissing &&
              (nav === undefined ? (
                // The member's order isn't known yet: Records shows loading, and nothing guesses at the rest.
                <NavSection title={strings.records} isLoading />
              ) : (
                <SidebarSections
                  data={data}
                  slug={slug}
                  nav={nav}
                  universe={universe}
                  objects={objects}
                  {...(currentObject === undefined ? {} : { currentObject })}
                  {...(currentPage === undefined ? {} : { currentPage })}
                  onCustomise={openCustomise}
                />
              ))}
            {!isMissing && nav !== undefined && <RailShortcut isRail={isRail} onRail={setRail} />}
          </Sidebar>
        )
      }
    >
      {children}
      {hasCustomised && nav !== undefined && (
        <Suspense fallback={null}>
          <CustomiseSidebarDialog
            data={data}
            slug={slug}
            nav={nav}
            objects={objects}
            isOpen={isCustomising}
            onOpenChange={setCustomising}
          />
        </Suspense>
      )}
      <ShortcutHelp
        isOpen={isHelpOpen}
        onOpenChange={setHelpOpen}
        groups={[
          {
            title: strings.shortcutsEverywhere,
            shortcuts: [
              { label: strings.undoShortcut, keys: UNDO_KEYS },
              { label: strings.openSettings, keys: SETTINGS_KEYS },
              { label: strings.toggleRail, keys: RAIL_KEYS },
              { label: strings.showShortcuts, keys: ['?'] },
            ],
          },
          GRID_SHORTCUTS,
        ]}
      />
    </AppShell>
  );
}

/** The pages above the sections (AC-921, AC-924): Tasks today, Inbox once notifications exist; one hidden isn't drawn, and its menu hides it. */
function TopPages({
  slug,
  nav,
  universe,
  currentPage,
  onHide,
}: {
  readonly slug: string;
  readonly nav: NavState;
  readonly universe: NavUniverse;
  readonly currentPage: SidebarPage | undefined;
  readonly onHide: (page: string) => void;
}) {
  const items = topEntries(nav, universe)
    .filter((entry) => !entry.hidden)
    .flatMap((entry) => {
      const page = PAGE_LINKS[entry.id as keyof typeof PAGE_LINKS];
      if (page === undefined) return [];
      return [
        <NavItem
          key={entry.id}
          icon={page.icon}
          href={page.href(slug)}
          isCurrent={currentPage === entry.id}
          menu={itemMenu(page.label, strings.hideFromSidebar, () => {
            onHide(entry.id);
          })}
        >
          {page.label}
        </NavItem>,
      ];
    });
  // A group of their own, named for screen readers, a section's space under the head (on the rail, the first group).
  return items.length === 0 ? null : <NavGroup label={strings.yourWork}>{items}</NavGroup>;
}

/**
 * `[` folds the sidebar to its rail and back (AC-935), unless a text field, an editor or a dialog has the key.
 * Drawn inside the shell, so it knows when the shell has folded the sidebar on a narrow screen: there the key does
 * nothing, as the collapse button isn't there either, and the member's stored choice stays as it was.
 */
function RailShortcut({ isRail, onRail }: { readonly isRail: boolean; readonly onRail: (on: boolean) => void }) {
  const { isCompact } = useContext(AppShellContext);
  useEffect(() => {
    if (isCompact) return;
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isRailKey(event)) return;
      const target = event.target instanceof Element ? (event.target as Element & KeyTarget) : null;
      if (belongsElsewhere(target)) return;
      event.preventDefault();
      onRail(!isRail);
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
    };
  }, [isCompact, isRail, onRail]);
  return null;
}

/** The settings sidebar (spec 0026): Settings with the way back, then Account, Workspace and Scheduling. */
function SettingsNavigation({
  slug,
  settings,
  permissions,
}: {
  readonly slug: string;
  readonly settings: SettingsSidebar;
  readonly permissions: readonly Permission[] | undefined;
}) {
  return (
    <Sidebar
      heading={settingsStrings.settings}
      back={{ label: settingsStrings.leaveSettings, href: settings.backHref }}
      label={settingsStrings.settings}
      keyboard="arrows"
    >
      {visibleSettingsNav(settingsNav(slug), permissions).map((group) => (
        <NavGroup key={group.id} label={group.label} isLabelShown>
          {group.entries.map((entry) => (
            <NavItem
              key={entry.id}
              icon={entry.icon}
              href={entry.href}
              isCurrent={entry.id === settings.current}
              {...(entry.meta === undefined ? {} : { meta: entry.meta })}
            >
              {entry.label}
            </NavItem>
          ))}
        </NavGroup>
      ))}
    </Sidebar>
  );
}
