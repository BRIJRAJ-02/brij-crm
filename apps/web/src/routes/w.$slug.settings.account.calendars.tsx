import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { CalendarScreen, CalendarsLoading } from '../features/settings/CalendarScreen.tsx';
import { strings } from '../features/settings/calendar-strings.ts';
import { isConnectResult, type ConnectResult } from '../features/settings/connect-result.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Account › Calendars (specs 0024 and 0026; the one place to connect a calendar since 5 November 2026):
// every member's own calendar connections, a Connect button per provider in the empty state. Bookings links
// here for setup. `?calendar=` is how connecting went, as the API's callback sends the browser back (through
// `/settings/calendar`); the screen says so once.

/** The page's address: how a connect just went, if one did. */
interface CalendarSearch {
  readonly calendar?: ConnectResult;
}

export const Route = createFileRoute('/w/$slug/settings/account/calendars')({
  validateSearch: (search: Record<string, unknown>): CalendarSearch =>
    isConnectResult(search.calendar) ? { calendar: search.calendar } : {},
  loader: async ({ context, params }) => {
    try {
      const view = context.data.calendar.view(params.slug);
      await view.ready();
      return { page: { view } };
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
      onResultSeen={() =>
        void navigate({ to: '/w/$slug/settings/account/calendars', params: { slug }, search: {}, replace: true })
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
