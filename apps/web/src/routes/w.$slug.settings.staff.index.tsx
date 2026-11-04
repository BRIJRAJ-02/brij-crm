import { isDataError, type ServicesStore } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { StaffScreen } from '../features/services/StaffScreen.tsx';
import { strings } from '../features/services/strings.ts';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Workspace › Staff (spec 0066 B1, AC-6613): the people clients book, for `services.manage` while
// Appointments is installed. The store loads with the page; the screen draws its own refusal.
export const Route = createFileRoute('/w/$slug/settings/staff/')({
  loader: async ({ context, params }): Promise<{ readonly store: ServicesStore }> => {
    const store = await context.data.services.load();
    store.team(params.slug).retain();
    store.catalogue(params.slug).retain();
    return { store };
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.staffTitle} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: StaffError,
  component: StaffRoute,
});

function StaffRoute() {
  const { store } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  return <StaffScreen store={store} slug={slug} toasts={toasts} />;
}

function StaffError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.staffTitle}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
