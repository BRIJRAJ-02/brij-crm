import { isDataError, type HospitalityStore, type Place } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { FloorScreen } from '../features/hospitality/FloorScreen.tsx';
import { strings } from '../features/hospitality/strings.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';

// One place's tables and areas (spec 0065, AC-6509), under Settings › Business, for `hospitality.manage`. The loader
// reads the business (the place's name) and the place's floor together.
export const Route = createFileRoute('/w/$slug/settings/business/places/$placeId')({
  loader: async ({
    context,
    params,
  }): Promise<{ readonly store: HospitalityStore; readonly place: Place | undefined }> => {
    const store = await context.data.hospitality.load();
    try {
      const [business] = await Promise.all([
        store.readBusiness(params.slug),
        store.readFloor(params.slug, params.placeId).catch(() => undefined),
      ]);
      return { store, place: business.places.find((each) => each.id === params.placeId) };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'APP_NOT_INSTALLED')) {
        return { store, place: undefined };
      }
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.tables} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: FloorError,
  component: FloorRoute,
});

function FloorRoute() {
  const { store, place } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  if (place === undefined) return <SettingsMissing backTo="home" />;
  return <FloorScreen store={store} slug={slug} place={place} toasts={toasts} />;
}

function FloorError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.tables}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
