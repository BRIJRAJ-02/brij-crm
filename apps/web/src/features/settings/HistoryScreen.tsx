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

/** Props for History while its route loads. */
export interface HistoryPendingProps {
  /** The tab the address names. */
  readonly tab: HistoryTab;
  /** Whether the reader holds `audit.read`, by the access the workspace frame already read: the tab bar or none. */
  readonly canReadChanges: boolean;
  /** The tab's own loading shape. */
  readonly body: ReactNode;
}

/**
 * History while its route loads, in the loaded layout: the tab bar exactly when the loaded page has one, its tabs
 * disabled until the page is there (a press while loading would go nowhere), and `body` in the named tab.
 */
export function HistoryPending({ tab, canReadChanges, body }: HistoryPendingProps) {
  if (!canReadChanges) {
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
          { id: 'changes', label: strings.changesTab, isDisabled: true },
          { id: 'sign-ins', label: strings.signInsTab, isDisabled: true },
        ]}
      >
        <TabPanel id="changes">{tab === 'changes' ? body : <Skeleton width="medium" />}</TabPanel>
        <TabPanel id="sign-ins">{tab === 'sign-ins' ? body : <Skeleton width="medium" />}</TabPanel>
      </Tabs>
    </SettingsPage>
  );
}
