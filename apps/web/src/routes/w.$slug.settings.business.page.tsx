import { isDataError, type BusinessPageStore } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { BusinessPageScreen } from '../features/hospitality/BusinessPageScreen.tsx';
import { pageStrings } from '../features/hospitality/business-page-strings.ts';
import { strings } from '../features/hospitality/strings.ts';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Business › Page (spec 0066, B4 lite): the business's public page, for `hospitality.manage`. The store
// loads with the page; the screen says when no app is installed or the person may not manage it.
export const Route = createFileRoute('/w/$slug/settings/business/page')({
  loader: async ({ context }): Promise<{ readonly store: BusinessPageStore }> => ({
    store: await context.data.businessPage.load(),
  }),
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={pageStrings.title} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: BusinessPageError,
  component: BusinessPageRoute,
});

function BusinessPageRoute() {
  const { store } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  return <BusinessPageScreen store={store} slug={slug} toasts={toasts} />;
}

function BusinessPageError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={pageStrings.title}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
