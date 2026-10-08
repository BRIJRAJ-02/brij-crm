// Brief
// Purpose: the frame every page inside a workspace sits in: the sidebar beside the page.
// Main task: move between the workspace's records (People in this loop), switch the theme and sign out.
// Leaves out: switching or creating workspaces, Quick actions, favourites and lists (#23 and later).
import type { DataLayer, ObjectSummary } from '@crm/data';
import { AppShell, Menu, MenuItem, MenuSection, NavItem, NavSection, Sidebar, ThemeSwitch, type Toasts } from '@crm/ui';
import type { ThemeController } from '@crm/ui/theme';
import { useNavigate } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { navObjects, objectHref } from './objects.ts';
import { strings } from './strings.ts';

/** Props for the workspace frame. */
export interface WorkspaceFrameProps {
  readonly data: DataLayer;
  readonly theme: ThemeController;
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
  /** The page's TopBar. */
  readonly topBar?: ReactNode;
  /** The view's ViewBar, on an object's page. */
  readonly viewBar?: ReactNode;
  readonly children: ReactNode;
}

/**
 * AppShell and the Sidebar: the workspace's name with Sign out in its menu
 * (the button spins while it signs out), the Records section, and the theme
 * switch, stacked when the sidebar is folded to its rail.
 */
export function WorkspaceFrame({
  data,
  theme,
  toasts,
  slug,
  workspaceName,
  roleLabel,
  objects,
  isMissing = false,
  currentObject,
  topBar,
  viewBar,
  children,
}: WorkspaceFrameProps) {
  const navigate = useNavigate();
  const [isSigningOut, setSigningOut] = useState(false);
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
      sidebar={
        <Sidebar
          workspace={workspaceName ?? strings.product}
          isWorkspaceBusy={isSigningOut}
          workspaceBusyLabel={strings.signingOut}
          workspaceMenu={
            <Menu
              label={strings.workspaceMenu}
              onAction={(key) => {
                if (key === 'sign-out') signOut();
              }}
            >
              {roleLabel === undefined ? (
                <MenuItem id="sign-out">{strings.signOut}</MenuItem>
              ) : (
                // The person's role heads the menu (spec 0009, AC-136).
                <MenuSection label={roleLabel}>
                  <MenuItem id="sign-out">{strings.signOut}</MenuItem>
                </MenuSection>
              )}
            </Menu>
          }
          footer={({ isCollapsed }) => (
            <ThemeSwitch controller={theme} isCompact orientation={isCollapsed ? 'vertical' : 'horizontal'} />
          )}
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
        </Sidebar>
      }
    >
      {children}
    </AppShell>
  );
}
