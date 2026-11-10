import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { sessionNotes, takeConnectArrival } from '../features/calendars/connect-start.ts';
import { CalendarScreen, CalendarsLoading } from '../features/settings/CalendarScreen.tsx';
import { strings } from '../features/settings/calendar-strings.ts';
import { isConnectResult, type ConnectResult } from '../features/settings/connect-result.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Bookings settings › Calendars (specs 0024 and 0026; the one place to connect a calendar, in Bookings settings since
// 9 November 2026, out of Settings › Account): every member's own calendar connections, a Connect button per provider
// in the empty state. Bookings links here for setup. `?calendar=` is how connecting went, as the API's callback sends the browser back (through
// `/settings/calendar`); the screen says so once, and a new account (`takeConnectArrival`) opens the connect popup at
// its calendars.

/** The page's address: how a connect just went, if one did. */
interface CalendarSearch {
  readonly calendar?: ConnectResult;
}

export const Route = createFileRoute('/w/$slug/bookings_/settings/calendars')({
  validateSearch: (search: Record<string, unknown>): CalendarSearch =>
    isConnectResult(search.calendar) ? { calendar: search.calendar } : {},
  loaderDeps: ({ search }) => ({ calendar: search.calendar }),
  loader: async ({ context, params, deps }) => {
    try {
      const view = context.data.calendar.view(params.slug);
      await view.ready();
      // Back from the provider connected: which account that made, read once from what the page noted as it left.
      const snapshot = view.getSnapshot();
      const arrival =
        deps.calendar === 'connected' && snapshot.status === 'ready'
          ? takeConnectArrival(
              sessionNotes(),
              snapshot.connections.map((connection) => connection.id),
              Date.now(),
            )
          : undefined;
      return { page: { view, arrival } };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.title} isLoading>
        <CalendarsLoading />
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: CalendarError,
  component: CalendarRoute,
});

function CalendarRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { calendar } = Route.useSearch();
  const { data } = Route.useRouteContext();
  const navigate = useNavigate();
  if (page === undefined) return <SettingsMissing backTo="home" />;
  return (
    <CalendarScreen
      data={data}
      slug={slug}
      view={page.view}
      {...(calendar === undefined ? {} : { result: calendar })}
      {...(page.arrival === undefined ? {} : { arrival: page.arrival })}
      onResultSeen={() =>
        void navigate({ to: '/w/$slug/bookings/settings/calendars', params: { slug }, search: {}, replace: true })
      }
    />
  );
}

function CalendarError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
