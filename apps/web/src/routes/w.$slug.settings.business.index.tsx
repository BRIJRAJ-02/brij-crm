import { isDataError, type HospitalityStore } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BusinessScreen } from '../features/hospitality/BusinessScreen.tsx';
import { strings } from '../features/hospitality/strings.ts';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Workspace › Business (spec 0065, AC-6507, AC-6508): the business the Hospitality apps share and its
// places, for `hospitality.manage`. The store loads with the page; the screen says when no app is installed.
export const Route = createFileRoute('/w/$slug/settings/business/')({
  loader: async ({ context, params }): Promise<{ readonly store: HospitalityStore }> => {
    const store = await context.data.hospitality.load();
    // The screen draws its own refusal (no app installed, no permission): the read's failure stays in the store.
    await store.readBusiness(params.slug).catch(() => undefined);
    return { store };
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.businessTitle} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: BusinessError,
  component: BusinessRoute,
});

function BusinessRoute() {
  const { store } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  return <BusinessScreen store={store} slug={slug} toasts={toasts} />;
}

function BusinessError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.businessTitle}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
