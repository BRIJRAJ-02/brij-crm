import { isDataError, type ServicesStore } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { StaffProfileScreen } from '../features/services/StaffProfileScreen.tsx';
import { strings } from '../features/services/strings.ts';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

// One staff member's profile (spec 0066 B1, AC-6611), under Settings › Staff, for `services.manage`. It reads the
// team the Staff page holds, so going back and forth reads nothing twice.
export const Route = createFileRoute('/w/$slug/settings/staff/$staffId')({
  loader: async ({ context, params }): Promise<{ readonly store: ServicesStore }> => {
    const store = await context.data.services.load();
    store.team(params.slug).retain();
    return { store };
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.profileTitle} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: ProfileError,
  component: ProfileRoute,
});

function ProfileRoute() {
  const { store } = Route.useLoaderData();
  const { slug, staffId } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  return <StaffProfileScreen store={store} slug={slug} staffId={staffId} toasts={toasts} />;
}

function ProfileError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.profileTitle}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
