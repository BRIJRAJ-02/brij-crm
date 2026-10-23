// Brief
// Purpose: puts one page of a workspace (its TopBar and body) inside the workspace frame.
// Main task: hand the frame what the workspace route loaded: its name and objects, and which one is open.
// Leaves out: loading anything itself; the /w/$slug route's loader did that through the data layer.
// The frame is mounted once, by the /w/$slug layout (WorkspaceLayout), so moving between pages never remounts the
// sidebar, its menus or a confirm open in it; each page portals its bars into the frame's slots.
import type { Me, MyAccess, Permission } from '@crm/data';
import { AppShellSlot } from '@crm/ui';
import { useMatch, useParams, useRouteContext, useRouterState } from '@tanstack/react-router';
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  // Selected, so a router state change (each step of a page switch) re-renders a reader only when the name changes.
  return useMatch({
    from: '/w/$slug',
    shouldThrow: false,
    select: (frame) => {
      // Absent while the frame's beforeLoad is still asking, whatever the route's type says.
      const me = frame.context.me as Me | undefined;
      const loaded = frame.loaderData as { readonly workspaceName?: string } | undefined;
      return loaded?.workspaceName ?? me?.workspaces.find((workspace) => workspace.slug === slug)?.name;
    },
  });
}

/** The open workspace's objects, as the frame loaded them; undefined while they load. */
export function useWorkspaceObjects() {
  return useMatch({ from: '/w/$slug', shouldThrow: false, select: (frame) => frame.loaderData?.objects });
}

/** The person's own access in the open workspace, as the frame loaded it; undefined while it loads. */
export function useMyAccess(): MyAccess | undefined {
  return useMatch({ from: '/w/$slug', shouldThrow: false, select: (frame) => frame.loaderData?.access });
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
  /** A page of the sidebar's that isn't an object's: Tasks, a Scheduling page or the trash (spec 0034). */
  readonly currentPage?: SidebarPage;
  /** Inside Settings: the settings sidebar in place of the app's (spec 0026). */
  readonly settings?: SettingsSidebar;
  /** The workspace itself failed to load: no Records section, rather than one loading for ever. */
  readonly isFailed?: boolean;
}

/** What a page tells the frame it sits in about itself: which sidebar entry is current, and Settings' sidebar. */
interface FrameNav {
  readonly currentObject: string | undefined;
  readonly currentPage: SidebarPage | undefined;
  readonly settingsCurrent: SettingsSidebar['current'];
  readonly settingsBackHref: string | undefined;
}

const NO_NAV: FrameNav = {
  currentObject: undefined,
  currentPage: undefined,
  settingsCurrent: undefined,
  settingsBackHref: undefined,
};

const isSameNav = (a: FrameNav, b: FrameNav) =>
  a.currentObject === b.currentObject &&
  a.currentPage === b.currentPage &&
  a.settingsCurrent === b.settingsCurrent &&
  a.settingsBackHref === b.settingsBackHref;

/** The frame WorkspaceLayout mounted: its bars' slots for a page to portal into, and where it says what is open. */
interface LayoutFrame {
  readonly topBar: HTMLElement | null;
  readonly viewBar: HTMLElement | null;
  readonly toolbar: HTMLElement | null;
  readonly setNav: (nav: FrameNav) => void;
}

const Layout = createContext<LayoutFrame | undefined>(undefined);

/**
 * Set inside a page that a layout route already framed (Bookings, its tabs): a
 * child route's own WorkspacePage then draws only its body, under the
 * layout's TopBar and tabs, so a screen mounts the same alone or in a layout.
 */
const InFrame = createContext(false);

/**
 * A workspace page inside WorkspaceFrame. Under WorkspaceLayout (every page
 * the /w/$slug layout renders), its bars go into the frame that layout
 * mounted, which stays mounted from page to page; outside it (the layout's
 * own pending and error pages), a frame of its own. Inside a page that is
 * already framed, only its body.
 */
export function WorkspacePage(props: WorkspacePageProps) {
  const isInFrame = useContext(InFrame);
  const layout = useContext(Layout);
  if (isInFrame) return <>{props.page.body}</>;
  return (
    <InFrame.Provider value>
      {layout === undefined ? <FramedWorkspacePage {...props} /> : <LaidOutPage layout={layout} {...props} />}
    </InFrame.Provider>
  );
}

/** A page in the layout's frame: it says what is open, portals its bars into the frame's slots, and draws its body. */
function LaidOutPage({
  layout,
  page,
  currentObject,
  currentPage,
  settings,
}: WorkspacePageProps & { readonly layout: LayoutFrame }) {
  const { setNav } = layout;
  const settingsCurrent = settings?.current;
  const settingsBackHref = settings?.backHref;
  // Before paint, so the sidebar marks the new page in the same frame the page appears in.
  useLayoutEffect(() => {
    setNav({ currentObject, currentPage, settingsCurrent, settingsBackHref });
    // The next page sets its own in the same commit; a child without a WorkspacePage then marks nothing.
    return () => {
      setNav(NO_NAV);
    };
  }, [setNav, currentObject, currentPage, settingsCurrent, settingsBackHref]);
  return (
    <>
      {layout.topBar !== null && page.topBar !== undefined && createPortal(page.topBar, layout.topBar)}
      {layout.viewBar !== null && page.viewBar !== undefined && createPortal(page.viewBar, layout.viewBar)}
      {layout.toolbar !== null && page.toolbar !== undefined && createPortal(page.toolbar, layout.toolbar)}
      {page.body}
    </>
  );
}

/** Props for WorkspaceLayout. */
export interface WorkspaceLayoutProps {
  /** The page: the layout route's Outlet, or its own "not found". */
  readonly children: ReactNode;
}

/**
 * The workspace frame, mounted once by the /w/$slug layout route: the
 * sidebar, the workspace menu and anything opened from them stay put while
 * the pages inside change. Each page (a WorkspacePage) fills the frame's bars
 * and says which sidebar entry is current; a new page starts at the top.
 */
export function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const [topBar, setTopBar] = useState<HTMLElement | null>(null);
  const [viewBar, setViewBar] = useState<HTMLElement | null>(null);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [nav, setNavState] = useState<FrameNav>(NO_NAV);
  const setNav = useCallback((next: FrameNav) => {
    setNavState((current) => (isSameNav(current, next) ? current : next));
  }, []);
  // The page under the workspace's own route (Settings and Bookings are one page with their tabs): another one gets
  // a new view box, at its top, as when each page drew its own frame; a record's other tab, or another record or
  // view of the same route, keeps its box and its scroll.
  const viewKey = useRouterState({
    select: (state) => {
      const at = state.matches.findIndex((match) => match.routeId === '/w/$slug');
      return at === -1 ? undefined : state.matches[at + 1]?.routeId;
    },
  });
  const frame = useMemo(() => ({ topBar, viewBar, toolbar, setNav }), [topBar, viewBar, toolbar, setNav]);
  const { settingsBackHref, settingsCurrent } = nav;
  // Kept while the page stays, so the frame's sidebar isn't drawn again for a new but equal object.
  const settings: SettingsSidebar | undefined = useMemo(
    () =>
      settingsBackHref === undefined
        ? undefined
        : { backHref: settingsBackHref, ...(settingsCurrent === undefined ? {} : { current: settingsCurrent }) },
    [settingsBackHref, settingsCurrent],
  );
  return (
    <Layout value={frame}>
      <FrameWithData
        {...(nav.currentObject === undefined ? {} : { currentObject: nav.currentObject })}
        {...(nav.currentPage === undefined ? {} : { currentPage: nav.currentPage })}
        {...(settings === undefined ? {} : { settings })}
        topBar={<AppShellSlot ref={setTopBar} />}
        viewBar={<AppShellSlot ref={setViewBar} />}
        toolbar={<AppShellSlot ref={setToolbar} />}
        {...(viewKey === undefined ? {} : { viewKey })}
      >
        {children}
      </FrameWithData>
    </Layout>
  );
}

/** A page with a frame of its own: the layout's pending and error pages, which render in place of the layout. */
function FramedWorkspacePage({ page, currentObject, currentPage, settings, isFailed = false }: WorkspacePageProps) {
  return (
    <FrameWithData
      {...(currentObject === undefined ? {} : { currentObject })}
      {...(currentPage === undefined ? {} : { currentPage })}
      {...(settings === undefined ? {} : { settings })}
      isFailed={isFailed}
      topBar={page.topBar}
      viewBar={page.viewBar}
      toolbar={page.toolbar}
    >
      {page.body}
    </FrameWithData>
  );
}

/** Props for FrameWithData: what is open, and the bars and body (or the slots pages portal them into). */
interface FrameWithDataProps {
  readonly currentObject?: string;
  readonly currentPage?: SidebarPage;
  readonly settings?: SettingsSidebar;
  readonly isFailed?: boolean;
  readonly topBar: ReactNode;
  readonly viewBar: ReactNode;
  readonly toolbar: ReactNode;
  readonly viewKey?: string;
  readonly children: ReactNode;
}

/** WorkspaceFrame with the frame's data read from the `/w/$slug` match (absent while it loads). */
function FrameWithData({
  currentObject,
  currentPage,
  settings,
  isFailed = false,
  topBar,
  viewBar,
  toolbar,
  viewKey,
  children,
}: FrameWithDataProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const { slug = '' } = useParams({ strict: false });
  // Each read selected, so the frame re-renders when what it shows changes, not at every step of a page switch.
  const workspace = useMatch({ from: '/w/$slug', shouldThrow: false, select: (frame) => frame.loaderData });
  const workspaceName = useWorkspaceName();
  // Every workspace the person is in, for the workspace menu's switcher (spec 0031, AC-801).
  const me: Me | undefined = useMatch({
    from: '/w/$slug',
    shouldThrow: false,
    select: (frame): Me | undefined => frame.context.me,
  });
  return (
    <WorkspaceFrame
      data={data}
      toasts={toasts}
      slug={slug}
      {...(workspaceName === undefined ? {} : { workspaceName })}
      {...(me === undefined ? {} : { workspaces: me.workspaces })}
      isOperator={me?.isOperator === true}
      {...(workspace?.access === undefined
        ? {}
        : { roleLabel: workspace.access.roleLabel, isOwner: workspace.access.role === 'owner' })}
      {...(workspace?.objects === undefined ? {} : { objects: workspace.objects })}
      // Loaded without objects (the door refused this workspace), or failed to load: no Records section.
      isMissing={workspace === undefined ? isFailed : workspace.objects === undefined}
      {...(currentObject === undefined ? {} : { currentObject })}
      {...(currentPage === undefined ? {} : { currentPage })}
      {...(settings === undefined ? {} : { settings })}
      {...(workspace?.access === undefined ? {} : { permissions: workspace.access.permissions })}
      {...(viewKey === undefined ? {} : { viewKey })}
      topBar={topBar}
      viewBar={viewBar}
      toolbar={toolbar}
    >
      {children}
    </WorkspaceFrame>
  );
}
