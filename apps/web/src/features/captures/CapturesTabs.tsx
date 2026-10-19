// Brief
// Purpose: the Links · Forms strip at the top of Captures, one tab per child route.
// Main task: switch between the booking links and the forms, each with its own address.
// Leaves out: what each tab shows (its child route renders that into the chosen panel).
import { TabPanel, Tabs } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { strings } from './strings.ts';
import { captureTabHref, isCaptureTab, type CaptureTab } from './tabs.ts';

/** Props for CapturesTabs. */
export interface CapturesTabsProps {
  readonly slug: string;
  /** The tab the address names. */
  readonly tab: CaptureTab;
  /** The child route's page (an `Outlet`), drawn in the chosen tab's panel. */
  readonly children: ReactNode;
}

/** Links · Forms. Choosing a tab moves to its address; the panel holds whatever that address renders. */
export function CapturesTabs({ slug, tab, children }: CapturesTabsProps) {
  const navigate = useNavigate();
  return (
    <Tabs
      label={strings.tabsLabel}
      selectedKey={tab}
      onSelectionChange={(next) => {
        if (isCaptureTab(next) && next !== tab) void navigate({ href: captureTabHref(slug, next) });
      }}
      tabs={[
        { id: 'links', label: strings.linksTab },
        { id: 'forms', label: strings.formsTab },
      ]}
    >
      <TabPanel id="links">{tab === 'links' && children}</TabPanel>
      <TabPanel id="forms">{tab === 'forms' && children}</TabPanel>
    </Tabs>
  );
}
