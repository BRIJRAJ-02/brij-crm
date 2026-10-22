import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { SecurityLoading, SecurityScreen } from '../features/settings/SecurityScreen.tsx';
import { strings } from '../features/settings/security-strings.ts';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Account › Sign in and devices (spec 0033; Security until 22 October 2026, renamed so the
// Settings sidebar holds one Security, the workspace's): how this person signs in and the devices signed in, held by
// the data layer, which reads them from the top each time the page opens; and
// the first page of Recent activity, started here and never waited for: its
// section shows its own loading rows, and a failed read shows there with a
// retry, never failing the page.
export const Route = createFileRoute('/w/$slug/settings/account/sign-in')({
  loader: ({ context }) => ({ activity: context.data.account.activity().catch(() => undefined) }),
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
    <SecurityScreen
      data={data}
      toasts={toasts}
      activity={activity}
      onActivityRetry={() => void router.invalidate({ filter: (match) => match.routeId === Route.id })}
    />
  );
}
