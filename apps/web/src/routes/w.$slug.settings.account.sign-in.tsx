import { LoadingNow } from '@crm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { SecurityLoading, SecurityScreen } from '../features/settings/SecurityScreen.tsx';
import { strings } from '../features/settings/security-strings.ts';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Account › Sign in and devices (spec 0033; Security until 22 October 2026, renamed so the
// Settings sidebar holds one Security, the workspace's): how this person signs in and the devices signed in, held by
// the data layer, which reads them from the top each time the page opens. The sign in history is not read here: it
// has one place, Settings › Workspace › History › Your sign ins (the simplify pass, 2 November 2026).
export const Route = createFileRoute('/w/$slug/settings/account/sign-in')({
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.title}>
        <SecurityLoading />
      </SettingsPage>
    </LoadingNow>
  ),
  component: SecurityRoute,
});

function SecurityRoute() {
  const { data, toasts } = Route.useRouteContext();
  return <SecurityScreen data={data} toasts={toasts} />;
}
