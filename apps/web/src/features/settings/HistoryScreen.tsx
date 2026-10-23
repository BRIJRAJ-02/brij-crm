// Brief
// Purpose: Settings › Workspace › History (spec 0046): one place to look back. Owners and admins read the workspace's changes; everyone reads their own sign ins.
// Main task: find who changed what in this workspace, and when, newest first; or check this account's recent sign ins.
// Leaves out: Background jobs and Trash (their own pages), filters and a row's details (milestone 2), and IP addresses or request ids anywhere.
import { Skeleton, TabPanel, Tabs } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SettingsPage } from './SettingsPage.tsx';
import { historyHref, isHistoryTab, type HistoryTab } from './history-href.ts';
import { strings as nav } from './history-nav-strings.ts';
import { strings } from './history-strings.ts';

/** Props for History. */
export interface HistoryScreenProps {
  readonly slug: string;
  /** The tab this address shows. */
  readonly tab: HistoryTab;
  /** Whether the reader holds `audit.read`: only then are there two tabs, else the sign ins alone with no tab bar. */
  readonly canReadChanges: boolean;
  /** The tab's own content. */
  readonly children: ReactNode;
}

/**
 * History: the settings page, and for a holder of `audit.read` two Tabs, each its own address (AC-4600, AC-4601).
 * Anyone else gets their sign ins with no tab bar: a tab they can't open is never shown locked.
 */
export function HistoryScreen({ slug, tab, canReadChanges, children }: HistoryScreenProps) {
  const navigate = useNavigate();
  if (!canReadChanges) return <SettingsPage title={nav.title}>{children}</SettingsPage>;
  return (
    <SettingsPage title={nav.title} hasTabs>
      <Tabs
        label={strings.tabs}
        selectedKey={tab}
        onSelectionChange={(next) => {
          if (isHistoryTab(next) && next !== tab) void navigate({ href: historyHref(slug, next) });
        }}
        tabs={[
          { id: 'changes', label: strings.changesTab, href: historyHref(slug, 'changes') },
          { id: 'sign-ins', label: strings.signInsTab, href: historyHref(slug, 'sign-ins') },
        ]}
      >
        <TabPanel id="changes">{tab === 'changes' && children}</TabPanel>
        <TabPanel id="sign-ins">{tab === 'sign-ins' && children}</TabPanel>
      </Tabs>
    </SettingsPage>
  );
}

/** History while its route loads: the page, its tabs when the tab is one only owners and admins reach, and `body`. */
export function HistoryPending({ tab, body }: { readonly tab: HistoryTab; readonly body: ReactNode }) {
  if (tab === 'sign-ins') {
    return (
      <SettingsPage title={nav.title} isLoading>
        {body}
      </SettingsPage>
    );
  }
  return (
    <SettingsPage title={nav.title} hasTabs isLoading>
      <Tabs
        label={strings.tabs}
        selectedKey={tab}
        tabs={[
          { id: 'changes', label: strings.changesTab },
          { id: 'sign-ins', label: strings.signInsTab },
        ]}
      >
        <TabPanel id="changes">{body}</TabPanel>
        <TabPanel id="sign-ins">
          <Skeleton width="medium" />
        </TabPanel>
      </Tabs>
    </SettingsPage>
  );
}
