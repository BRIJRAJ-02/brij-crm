// Brief
// Purpose: puts one page of a workspace (its TopBar and body) inside the workspace frame.
// Main task: hand the frame what the workspace route loaded: its name and objects, and which one is open.
// Leaves out: loading anything itself; the /w/$slug route's loader did that through the data layer.
import type { Me, MyAccess, Permission } from '@crm/data';
import { useMatch, useParams, useRouteContext } from '@tanstack/react-router';
import { createContext, useContext, type ReactNode } from 'react';
import { WorkspaceFrame, type SettingsSidebar, type SidebarPage } from './WorkspaceFrame.tsx';

/** One page in the frame: its TopBar (its title, the h1), on a view its ViewBar, and its body. */
export interface FramedPage {
  readonly topBar: ReactNode;
  readonly viewBar?: ReactNode;
  /** On a view, its Toolbar (spec 0020). */
  readonly toolbar?: ReactNode;
  readonly body: ReactNode;
}

/** The workspace's name: what the frame loaded, else what `me` already said (known before the frame loads). */
export function useWorkspaceName(): string | undefined {
  const { slug = '' } = useParams({ strict: false });
  const frame = useMatch({ from: '/w/$slug', shouldThrow: false });
  // Absent while the frame's beforeLoad is still asking, whatever the route's type says.
  const me: Me | undefined = frame?.context.me;
  return frame?.loaderData?.workspaceName ?? me?.workspaces.find((workspace) => workspace.slug === slug)?.name;
}

/** The person's own access in the open workspace, as the frame loaded it; undefined while it loads. */
export function useMyAccess(): MyAccess | undefined {
  return useMatch({ from: '/w/$slug', shouldThrow: false })?.loaderData?.access;
}

/**
 * Whether the person holds `permission` in the open workspace. Only for
 * hiding a control they can't use: the server checks every call on its own.
 * False while access loads, so a control never shows and then vanishes.
 */
export function useCan(permission: Permission): boolean {
  return useMyAccess()?.permissions.includes(permission) ?? false;
}

/** Props for WorkspacePage. */
export interface WorkspacePageProps {
  readonly page: FramedPage;
  /** The `apiSlug` of the object whose page is open. */
  readonly currentObject?: string;
  /** A page of the sidebar's that isn't an object's: Bookings, Captures or the trash (spec 0022). */
  readonly currentPage?: SidebarPage;
  /** Inside Settings: the settings sidebar in place of the app's (spec 0026). */
  readonly settings?: SettingsSidebar;
  /** The workspace itself failed to load: no Records section, rather than one loading for ever. */
  readonly isFailed?: boolean;
}

/**
 * Set inside a page that a layout route already framed (Bookings, its tabs): a
 * child route's own WorkspacePage then draws only its body, under the
 * layout's TopBar and tabs, so a screen mounts the same alone or in a layout.
 */
const InFrame = createContext(false);

/**
 * A workspace page inside WorkspaceFrame, reading the frame's data from the
 * `/w/$slug` match (absent while it loads). Inside a page that is already
 * framed, only its body.
 */
export function WorkspacePage(props: WorkspacePageProps) {
  if (useContext(InFrame)) return <>{props.page.body}</>;
  return (
    <InFrame.Provider value>
      <FramedWorkspacePage {...props} />
    </InFrame.Provider>
  );
}

/** The frame itself, with the page's bars and body. */
function FramedWorkspacePage({ page, currentObject, currentPage, settings, isFailed = false }: WorkspacePageProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const { slug = '' } = useParams({ strict: false });
  const workspace = useMatch({ from: '/w/$slug', shouldThrow: false })?.loaderData;
  const workspaceName = useWorkspaceName();
  return (
    <WorkspaceFrame
      data={data}
      toasts={toasts}
      slug={slug}
      {...(workspaceName === undefined ? {} : { workspaceName })}
      {...(workspace?.access === undefined ? {} : { roleLabel: workspace.access.roleLabel })}
      {...(workspace?.objects === undefined ? {} : { objects: workspace.objects })}
      // Loaded without objects (the door refused this workspace), or failed to load: no Records section.
      isMissing={workspace === undefined ? isFailed : workspace.objects === undefined}
      {...(currentObject === undefined ? {} : { currentObject })}
      {...(currentPage === undefined ? {} : { currentPage })}
      {...(settings === undefined ? {} : { settings })}
      {...(workspace?.access === undefined ? {} : { permissions: workspace.access.permissions })}
      topBar={page.topBar}
      viewBar={page.viewBar}
      toolbar={page.toolbar}
    >
      {page.body}
    </WorkspaceFrame>
  );
}
