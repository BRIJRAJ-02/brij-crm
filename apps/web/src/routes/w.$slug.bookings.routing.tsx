import { isDataError } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { loadRouting, routingSearch } from '../features/routing/load.ts';
import { RoutingPending, RoutingScreen } from '../features/routing/RoutingScreen.tsx';
import { strings } from '../features/routing/tab-strings.ts';
import { SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Bookings › Routing (spec 0037, AC-1383): what every routed form and team page shares, for holders of
// routing.manage (owners and admins). Overview (`?view` absent) and Decisions (`?view=decisions`, with its filters
// and the decision open in the address). Without routing.manage there is no such page (hidden means absent). The
// same screen is Settings › Scheduling › Routing (5 November 2026); both load through `features/routing/load.ts`.
export const Route = createFileRoute('/w/$slug/bookings/routing')({
  validateSearch: routingSearch,
  loader: ({ context, params }) => loadRouting(context.data, params.slug),
  pendingComponent: () => (
    <LoadingNow>
      <RoutingPending />
    </LoadingNow>
  ),
  errorComponent: RoutingError,
  component: RoutingRoute,
});

function RoutingRoute() {
  const { members, stage } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const { data, toasts } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  if (members === undefined) return <SettingsMissing backTo="home" />;
  return (
    <RoutingScreen
      data={data}
      slug={slug}
      search={search}
      members={members}
      {...(stage === undefined ? {} : { stage })}
      toasts={toasts}
      onSearch={(next) => void navigate({ search: (current) => ({ ...current, ...next }), replace: true })}
    />
  );
}

function RoutingError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <PageColumn>
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void router.invalidate()}>
        {isDataError(error) ? error.message : strings.failedText}
      </EmptyState>
    </PageColumn>
  );
}
