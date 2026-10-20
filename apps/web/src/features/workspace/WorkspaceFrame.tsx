// Brief
// Purpose: the frame every page inside a workspace sits in: the sidebar beside the page (inside Settings, the settings sidebar).
// Main task: move between the workspace's objects, Bookings, Captures and the trash, open Settings (⌘,) and sign out; undo (⌘Z).
// Leaves out: switching or creating workspaces, Quick actions, favourites and lists (#23 and later); the theme (Settings › Preferences).
import type { DataLayer, ObjectSummary, Permission } from '@crm/data';
import {
  AppShell,
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
import { CalendarBanner } from './CalendarBanner.tsx';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState, type ReactNode } from 'react';
import { settingsNav, visibleSettingsNav, type SettingsPageId } from '../settings/nav.ts';
import { strings as settingsStrings } from '../settings/strings.ts';
import { bookingsHref, capturesHref, navObjects, objectHref, settingsHomeHref, trashHref } from './objects.ts';
import { strings } from './strings.ts';
import { SETTINGS_KEYS, UNDO_KEYS } from './undo.ts';
import { useUndoShortcut } from './useUndoShortcut.ts';

/** A page the sidebar lists that isn't an object's. */
export type SidebarPage = 'bookings' | 'captures' | 'trash';

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
  /** A page of the sidebar's that isn't an object's: Bookings, Captures or the trash (spec 0022). */
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
 * AppShell and the Sidebar: the workspace's name with Sign out in its menu
 * (the button spins while it signs out), the Records section, the
 * destinations, and Settings at the foot. Inside Settings, the settings
 * sidebar instead: the way back, then the settings pages in their groups.
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
  const listed = objects === undefined ? undefined : navObjects(objects);
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
            // Settings at the foot, with its shortcut (spec 0026, AC-685); the theme lives in Settings › Preferences.
            footer={
              <NavItem icon="settings" href={settingsHomeHref(slug)} kbd="⌘,">
                {strings.settings}
              </NavItem>
            }
          >
            {!isMissing && (
              <NavSection title={strings.records} isLoading={listed === undefined} emptyLabel={strings.noObjects}>
                {listed?.map((object) => (
                  <NavItem
                    key={object.id}
                    icon={object.icon}
                    hue={object.hue}
                    href={objectHref(slug, object)}
                    isCurrent={object.apiSlug === currentObject}
                  >
                    {object.pluralName}
                  </NavItem>
                ))}
              </NavSection>
            )}
            {/* After Records, as Timefix's rail has them: Bookings, Captures (Links and Forms), then the trash, for every member (spec 0022, AC-533). */}
            {!isMissing && listed !== undefined && (
              <NavGroup label={strings.destinations}>
                <NavItem icon="calendar-days" href={bookingsHref(slug)} isCurrent={currentPage === 'bookings'}>
                  {strings.bookings}
                </NavItem>
                <NavItem icon="link" href={capturesHref(slug)} isCurrent={currentPage === 'captures'}>
                  {strings.captures}
                </NavItem>
                <NavItem icon="trash" href={trashHref(slug)} isCurrent={currentPage === 'trash'}>
                  {strings.trash}
                </NavItem>
              </NavGroup>
            )}
          </Sidebar>
        )
      }
    >
      {children}
      <ShortcutHelp
        isOpen={isHelpOpen}
        onOpenChange={setHelpOpen}
        groups={[
          {
            title: strings.shortcutsEverywhere,
            shortcuts: [
              { label: strings.undoShortcut, keys: UNDO_KEYS },
              { label: strings.openSettings, keys: SETTINGS_KEYS },
              { label: strings.showShortcuts, keys: ['?'] },
            ],
          },
          GRID_SHORTCUTS,
        ]}
      />
    </AppShell>
  );
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
