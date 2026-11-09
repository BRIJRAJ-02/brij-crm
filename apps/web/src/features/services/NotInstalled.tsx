// Brief
// Purpose: what Services, Staff and Shifts show while Appointments is off (spec 0066 B1).
// Main task: open Settings › Apps to turn it on.
// Leaves out: switching it here (Apps owns the switch).
import { ButtonLink, EmptyState } from '@crm/ui';
import { appsSettingsHref } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

/** The page with one next action: Open Apps. */
export function NotInstalled({ slug, title }: { readonly slug: string; readonly title: string }) {
  const canSwitch = useCan('workspace.manage');
  return (
    <SettingsPage title={title}>
      <EmptyState
        title={strings.notInstalled}
        icon="blocks"
        {...(canSwitch
          ? {
              actions: (
                <ButtonLink variant="primary" href={appsSettingsHref(slug)}>
                  {strings.openApps}
                </ButtonLink>
              ),
            }
          : {})}
      >
        {canSwitch ? strings.notInstalledText : strings.notInstalledAsk}
      </EmptyState>
    </SettingsPage>
  );
}
