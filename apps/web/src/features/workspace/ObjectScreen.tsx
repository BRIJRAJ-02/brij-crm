// Brief
// Purpose: the states of a page inside a workspace around its content: loading, failed, missing, or no objects.
// Main task: say plainly what happened and offer the way on (Try again, or open your workspace).
// Leaves out: the records themselves, which RecordsScreen shows.
import { EmptyState, Link, TopBar } from '@crm/ui';
import { strings } from './strings.ts';

/** A workspace with no objects to list: its name, and a plain empty state (no way out to loop through). */
export function noObjectsPage(workspaceName: string) {
  return {
    topBar: <TopBar title={workspaceName} />,
    body: <EmptyState title={strings.noObjects}>{strings.noObjectsText}</EmptyState>,
  };
}

/** An address inside the workspace that names nothing: what happened as the title, what to do under it, and the way to the person's workspace. */
export function missingPage(title: string, text: string) {
  return {
    topBar: <TopBar title={title} />,
    body: (
      <EmptyState icon="search" title={text} actions={<Link href="/">{strings.openWorkspace}</Link>}>
        {strings.checkAddress}
      </EmptyState>
    ),
  };
}

/** The workspace's page while it loads: a top bar and a body that hold their places, so nothing jumps when it arrives. */
export function pendingPage() {
  return {
    topBar: <TopBar title={strings.loadingTitle} isLoading />,
    body: <EmptyState title={strings.loadingTitle} isLoading />,
  };
}

/** The workspace's page when loading failed: under the workspace's name (when known), what happened, what to do, and a retry. */
export function failedPage(workspaceName: string | undefined, onRetry: () => void) {
  return {
    // Before the workspace is known, the product names the page, so the body
    // says "Couldn’t load this workspace" once, not twice.
    topBar: <TopBar title={workspaceName ?? strings.product} />,
    body: (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={onRetry}>
        {strings.failedText}
      </EmptyState>
    ),
  };
}
