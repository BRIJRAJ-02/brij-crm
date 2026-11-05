// Brief
// Purpose: Settings › Workspace › History (spec 0046): the workspace's changes, for owners and admins (`audit.read`).
// Main task: find who changed what in this workspace, and when, newest first, a day at a time.
// Leaves out: each member's own sign ins (Account › Sign in and security has them since 5 November 2026), Background jobs and Trash (their own pages), filters (milestone 2), and IP addresses or request ids anywhere.
import type { ReactNode } from 'react';
import { SettingsPage } from './SettingsPage.tsx';
import { strings as nav } from './history-nav-strings.ts';

/** Props for History. */
export interface HistoryScreenProps {
  /** The workspace's changes (WorkspaceChangesTab). */
  readonly children: ReactNode;
}

/** History: one page, the workspace's changes, with no tabs (its sign ins tab moved to Sign in and security). */
export function HistoryScreen({ children }: HistoryScreenProps) {
  return <SettingsPage title={nav.title}>{children}</SettingsPage>;
}

/** History while its route loads, in the loaded layout. */
export function HistoryPending({ body }: { readonly body: ReactNode }) {
  return (
    <SettingsPage title={nav.title} isLoading>
      {body}
    </SettingsPage>
  );
}
