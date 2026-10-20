// Where `/` and the welcome page send a signed in person (spec 0031, AC-802):
// the workspace they last opened while they are still in it, else their
// oldest. Plain code with no React, so the loaders in the first load use it.
import type { Me } from '@crm/data';

/** The workspace to open for `me`: the last one opened while it is still listed, else the oldest, else none. */
export function homeWorkspace(me: Pick<Me, 'workspaces' | 'lastWorkspaceId'>): Me['workspaces'][number] | undefined {
  const last = me.workspaces.find((workspace) => workspace.id === me.lastWorkspaceId);
  return last ?? me.workspaces[0];
}
