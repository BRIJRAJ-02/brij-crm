import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ConnectedAppsPending, ConnectedAppsScreen } from '../features/partners/ConnectedAppsScreen.tsx';
import { connectedStrings } from '../features/partners/strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/strings.ts';

// Settings › Workspace › Connected apps (spec 0070, AC-7013): owners only. The access read comes first, from the data
// layer's cache, so nobody else asks the server anything and finds no such page (hidden means absent). The list is
// a held one the screen keeps; the loader warms it.
export const Route = createFileRoute('/w/$slug/settings/connected-apps')({
  loader: async ({ context, params }) => {
    try {
      const access = await context.data.access.mine(params.slug);
      if (!access.permissions.includes('connected_apps.manage')) return { allowed: false };
      await context.data.connectedApps.view(params.slug).ready();
      return { allowed: true };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) return { allowed: false };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <ConnectedAppsPending title={strings.connectedApps} />
    </LoadingNow>
  ),
  errorComponent: ConnectedAppsError,
  component: ConnectedAppsRoute,
});

function ConnectedAppsRoute() {
  const { allowed } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (!allowed) return <SettingsMissing backTo="home" />;
  return <ConnectedAppsScreen data={data} toasts={toasts} slug={slug} title={strings.connectedApps} />;
}

function ConnectedAppsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.connectedApps}
      heading={connectedStrings.failedTitle}
      text={isDataError(error) ? error.message : connectedStrings.failedTitle}
      onRetry={() => void router.invalidate()}
    />
  );
}
