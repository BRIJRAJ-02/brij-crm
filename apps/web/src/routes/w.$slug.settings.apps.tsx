import { isDataError, type HospitalityStore } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AppsScreen } from '../features/hospitality/AppsScreen.tsx';
import { strings } from '../features/hospitality/strings.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Workspace › Apps (spec 0065, AC-6501): the business apps. Every member reads it; owners and admins switch
// them. The store loads with the page, never in the first load.
export const Route = createFileRoute('/w/$slug/settings/apps')({
  loader: async ({ context, params }): Promise<{ readonly store: HospitalityStore | undefined }> => {
    const store = await context.data.hospitality.load();
    try {
      await store.readApps(params.slug);
      return { store };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
        return { store: undefined };
      }
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.appsTitle} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: AppsError,
  component: AppsRoute,
});

function AppsRoute() {
  const { store } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  if (store === undefined) return <SettingsMissing backTo="home" />;
  return <AppsScreen store={store} slug={slug} toasts={toasts} />;
}

function AppsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.appsTitle}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
