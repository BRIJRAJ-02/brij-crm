// Brief
// Purpose: what Services, Staff and Shifts show while Appointments is off (spec 0066 B1).
// Main task: open Settings › Apps to turn it on.
// Leaves out: switching it here (Apps owns the switch).
import { ButtonLink, EmptyState } from '@crm/ui';
import { appsSettingsHref } from '../settings/nav.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { strings } from './strings.ts';

/** The page with one next action: Open Apps. */
export function NotInstalled({ slug, title }: { readonly slug: string; readonly title: string }) {
  return (
    <SettingsPage title={title}>
      <EmptyState
        title={strings.notInstalled}
        icon="blocks"
        actions={
          <ButtonLink variant="primary" href={appsSettingsHref(slug)}>
            {strings.openApps}
          </ButtonLink>
        }
      >
        {strings.notInstalledText}
      </EmptyState>
    </SettingsPage>
  );
}
