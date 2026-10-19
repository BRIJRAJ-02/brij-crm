// Brief
// Purpose: what a Captures tab shows until its lane moves its screen in (booking links, forms).
// Main task: say the tab is empty and what will show there.
// Leaves out: everything else; the booking and forms lanes replace this in their tab's route.
import { EmptyState } from '@crm/ui';
import { strings } from './strings.ts';
import type { CaptureTab } from './tabs.ts';

/** A Captures tab's empty state. */
export function CapturePlaceholder({ tab }: { readonly tab: CaptureTab }) {
  return tab === 'links' ? (
    <EmptyState icon="link" title={strings.linksEmptyTitle}>
      {strings.linksEmptyText}
    </EmptyState>
  ) : (
    <EmptyState icon="clipboard-list" title={strings.formsEmptyTitle}>
      {strings.formsEmptyText}
    </EmptyState>
  );
}
