import { isDataError } from '@crm/data';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { CalendarScreen } from '../features/settings/CalendarScreen.tsx';
import { isConnectResult, strings, type ConnectResult } from '../features/settings/calendar-strings.ts';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings, Calendar (spec 0024): every member's own calendar connections.
// The loader reads them through the data layer; the screen holds the list, so
// a connection still syncing its first window updates as it finishes.
// `?calendar=` is how connecting went, as the API's callback sends the
// browser back; the screen says so once.

/** The page's address: how a connect just went, if one did. */
interface CalendarSearch {
  readonly calendar?: ConnectResult;
}

export const Route = createFileRoute('/w/$slug/settings/calendar')({
  validateSearch: (search: Record<string, unknown>): CalendarSearch =>
    isConnectResult(search.calendar) ? { calendar: search.calendar } : {},
  loader: async ({ context, params }) => {
    try {
      const view = context.data.calendar.view(params.slug);
      await view.ready();
      return { page: { view } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: CalendarPending,
  errorComponent: CalendarError,
  component: CalendarRoute,
});

function CalendarRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { calendar } = Route.useSearch();
  const { data } = Route.useRouteContext();
  const navigate = useNavigate();
  if (page === undefined) return <SettingsMissing current="calendar" />;
  return (
    <CalendarScreen
      data={data}
      slug={slug}
      view={page.view}
      {...(calendar === undefined ? {} : { result: calendar })}
      onResultSeen={() =>
        void navigate({ to: '/w/$slug/settings/calendar', params: { slug }, search: {}, replace: true })
      }
    />
  );
}

function CalendarPending() {
  return (
    <SettingsPage title={strings.title} description={strings.description} current="calendar" isLoading>
      {null}
    </SettingsPage>
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
      current="calendar"
    />
  );
}
