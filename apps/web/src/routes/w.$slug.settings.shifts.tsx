import { isDataError, type ServicesStore } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ShiftsScreen } from '../features/services/ShiftsScreen.tsx';
import { strings } from '../features/services/strings.ts';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

/** `?place=` names a place by id, `?week=` a day of the week to show (its Monday is taken). */
interface ShiftsSearch {
  readonly place?: string;
  readonly week?: string;
}

// Settings › Workspace › Shifts (spec 0066 B1, AC-6612): who works when at a place, a week at a time, for
// `services.calendar` while Appointments is installed. The place and the week are in the address.
export const Route = createFileRoute('/w/$slug/settings/shifts')({
  validateSearch: (search: Record<string, unknown>): ShiftsSearch => ({
    ...(typeof search.place === 'string' && /^[0-9a-f-]{36}$/i.test(search.place) ? { place: search.place } : {}),
    ...(typeof search.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(search.week) ? { week: search.week } : {}),
  }),
  loader: async ({ context, params }): Promise<{ readonly store: ServicesStore }> => {
    const store = await context.data.services.load();
    store.team(params.slug, 'shifts').retain();
    return { store };
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.shiftsTitle} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: ShiftsError,
  component: ShiftsRoute,
});

function ShiftsRoute() {
  const { store } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { place, week } = Route.useSearch();
  const { toasts } = Route.useRouteContext();
  return (
    <ShiftsScreen
      store={store}
      slug={slug}
      toasts={toasts}
      {...(place === undefined ? {} : { placeId: place })}
      {...(week === undefined ? {} : { week })}
    />
  );
}

function ShiftsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.shiftsTitle}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
