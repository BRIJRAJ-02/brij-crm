import { LoadingNow } from '@crm/ui';
import { createFileRoute } from '@tanstack/react-router';
import { SecurityLoading, SecurityScreen } from '../features/settings/SecurityScreen.tsx';
import { strings } from '../features/settings/security-strings.ts';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Account › Security (spec 0033): the person's own devices. Nothing
// to wait for: the screen holds the account's session list through the data
// layer, which reads it from the top each time the page opens.
export const Route = createFileRoute('/w/$slug/settings/account/security')({
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
