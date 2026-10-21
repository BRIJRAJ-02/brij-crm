import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { SecurityLoading, SecurityScreen } from '../features/settings/SecurityScreen.tsx';
import { strings } from '../features/settings/security-strings.ts';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Account › Security (spec 0033): the person's own devices, held by
// the data layer, which reads them from the top each time the page opens; and
// the first page of Recent activity, read here (a failed read shows in its
// section with a retry, never failing the page).
export const Route = createFileRoute('/w/$slug/settings/account/security')({
  loader: async ({ context }) => ({ activity: await context.data.account.activity().catch(() => undefined) }),
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
  const { activity } = Route.useLoaderData();
  const router = useRouter();
  return (
    <SecurityScreen data={data} toasts={toasts} activity={activity} onActivityRetry={() => void router.invalidate()} />
  );
}
