import { isDataError } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { CalendarScreen, CalendarsLoading } from '../features/settings/CalendarScreen.tsx';
import { isConnectResult, strings, type ConnectResult } from '../features/settings/calendar-strings.ts';
import { SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Bookings › Calendars (specs 0024 and 0026), up out of Settings › Scheduling (25 October 2026): every member's own
// calendar connections, which is the one thing that makes every other tab here work. The loader reads them through
// the data layer; the screen holds the list, so a connection still syncing its first window updates as it finishes.
// `?calendar=` is how connecting went, as the API's callback sends the browser back; the screen says so once. The
// old Settings addresses redirect here, keeping that search.

/** The page's address: how a connect just went, if one did. */
interface CalendarSearch {
  readonly calendar?: ConnectResult;
}

export const Route = createFileRoute('/w/$slug/bookings/calendars')({
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
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.title} isLoading inFrame>
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
      inFrame
      data={data}
      slug={slug}
      view={page.view}
      {...(calendar === undefined ? {} : { result: calendar })}
      onResultSeen={() =>
        void navigate({ to: '/w/$slug/bookings/calendars', params: { slug }, search: {}, replace: true })
      }
    />
  );
}

function CalendarError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    // Inside the Bookings frame, which already draws the TopBar and the tab strip: the tab's own panel says so.
    <PageColumn>
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void router.invalidate()}>
        {isDataError(error) ? error.message : strings.failedText}
      </EmptyState>
    </PageColumn>
  );
}
