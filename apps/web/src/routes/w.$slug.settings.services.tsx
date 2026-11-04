import { isDataError, type ServicesStore } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ServicesScreen } from '../features/services/ServicesScreen.tsx';
import { strings } from '../features/services/strings.ts';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Workspace › Services (spec 0066 B1, AC-6613): the catalogue, for `services.manage` while Appointments is
// installed. The store loads with the page; the screen draws its own refusal (no app, no permission).
export const Route = createFileRoute('/w/$slug/settings/services')({
  loader: async ({ context, params }): Promise<{ readonly store: ServicesStore }> => {
    const store = await context.data.services.load();
    store.catalogue(params.slug).retain();
    return { store };
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.servicesTitle} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: ServicesError,
  component: ServicesRoute,
});

function ServicesRoute() {
  const { store } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  return <ServicesScreen store={store} slug={slug} toasts={toasts} />;
}

function ServicesError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.servicesTitle}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
