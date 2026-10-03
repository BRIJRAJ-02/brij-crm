// Brief
// Purpose: puts one page of a workspace (its TopBar and body) inside the workspace frame.
// Main task: hand the frame what the workspace route loaded: its name and objects, and which one is open.
// Leaves out: loading anything itself; the /w/$slug route's loader did that through the data layer.
import { useMatch, useParams, useRouteContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { WorkspaceFrame } from './WorkspaceFrame.tsx';

/** One page in the frame: its TopBar (its title, the h1) and its body. */
export interface FramedPage {
  readonly topBar: ReactNode;
  readonly body: ReactNode;
}

/** A workspace page inside WorkspaceFrame, reading the frame's data from the `/w/$slug` match (absent while it loads). */
export function WorkspacePage({ page, currentObject }: { readonly page: FramedPage; readonly currentObject?: string }) {
  const { data, theme, toasts } = useRouteContext({ from: '__root__' });
  const { slug = '' } = useParams({ strict: false });
  const workspace = useMatch({ from: '/w/$slug', shouldThrow: false })?.loaderData;
  return (
    <WorkspaceFrame
      data={data}
      theme={theme}
      toasts={toasts}
      slug={slug}
      {...(workspace?.workspaceName === undefined ? {} : { workspaceName: workspace.workspaceName })}
      {...(workspace?.objects === undefined ? {} : { objects: workspace.objects })}
      // Loaded, without objects: the door refused this workspace.
      isMissing={workspace !== undefined && workspace.objects === undefined}
      {...(currentObject === undefined ? {} : { currentObject })}
      topBar={page.topBar}
    >
      {page.body}
    </WorkspaceFrame>
  );
}
