// Brief
// Purpose: one object's page in a workspace (People in this loop), under its name and colour tile.
// Main task: see the object's records; in milestone 1 there are none yet, and the page says so plainly.
// Leaves out: the table, "New person" and "Add attribute", which arrive with records in milestone 2.
import type { ObjectSummary } from '@crm/data';
import { EmptyState, Link, Skeleton, TopBar } from '@crm/ui';
import { strings } from './strings.ts';

/** The object's page: its TopBar and, until records exist, the empty state. Goes inside WorkspaceFrame as `topBar` and children. */
export function objectPage(object: ObjectSummary) {
  return {
    topBar: <TopBar title={object.pluralName} icon={object.icon} hue={object.hue} />,
    body: (
      <EmptyState title={strings.emptyTitle(object.pluralName)} icon={object.icon}>
        {strings.emptyText(object.pluralName)}
      </EmptyState>
    ),
  };
}

/** An address inside the workspace that names no object. */
export function missingPage(title: string, text: string) {
  return {
    topBar: <TopBar title={title} />,
    body: <EmptyState icon="search" title={text} actions={<Link href="/">{strings.goHome}</Link>} />,
  };
}

/** The workspace's page while it loads: no title yet, a Skeleton for the view. */
export function pendingPage() {
  return { topBar: undefined, body: <Skeleton lines={4} /> };
}

/** The workspace's page when loading failed: the failure as its title, and a retry. */
export function failedPage(title: string, onRetry: () => void) {
  return {
    topBar: <TopBar title={title} />,
    body: <EmptyState tone="error" title={strings.failedText} onRetry={onRetry} />,
  };
}
