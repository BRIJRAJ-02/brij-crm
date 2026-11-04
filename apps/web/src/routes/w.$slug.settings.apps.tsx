import { isDataError, type HospitalityStore, type WorkspaceSettings } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AppsScreen } from '../features/hospitality/AppsScreen.tsx';
import { strings } from '../features/hospitality/strings.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Workspace › Apps (spec 0065, AC-6501): the Hospitality apps, where Timefix opened early access. Every
// member reads it; owners and admins install and remove. The store loads with the page, never in the first load.
export const Route = createFileRoute('/w/$slug/settings/apps')({
  loader: async ({
    context,
    params,
  }): Promise<{ readonly store: HospitalityStore | undefined; readonly workspace: WorkspaceSettings | undefined }> => {
    const store = await context.data.hospitality.load();
    try {
      const [, workspace] = await Promise.all([
        store.readApps(params.slug),
        context.data.workspace.get(params.slug).catch(() => undefined),
      ]);
      return { store, workspace };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
        return { store: undefined, workspace: undefined };
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
  const { store, workspace } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  if (store === undefined) return <SettingsMissing backTo="home" />;
  return <AppsScreen store={store} slug={slug} workspace={workspace} toasts={toasts} />;
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
