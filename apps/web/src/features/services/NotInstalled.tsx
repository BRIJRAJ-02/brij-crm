// Brief
// Purpose: what Services, Staff and Shifts show while Appointments isn't installed (spec 0066 B1).
// Main task: open Settings › Apps to install it.
// Leaves out: installing it here (Apps owns the business card the first install asks for).
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
