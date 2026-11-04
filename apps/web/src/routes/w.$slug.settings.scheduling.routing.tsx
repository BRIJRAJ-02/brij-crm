import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { loadRouting, routingSearch } from '../features/routing/load.ts';
import { RoutingPending, RoutingScreen } from '../features/routing/RoutingScreen.tsx';
import { strings as routingStrings } from '../features/routing/tab-strings.ts';
import { SchedulingSettingsPage } from '../features/settings/SchedulingSettingsPage.tsx';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/strings.ts';

// Settings › Scheduling › Routing (5 November 2026): the screen Bookings › Routing shows (spec 0037, AC-1383), here so
// every setting is under Settings, for holders of routing.manage. One screen and one loader (`routing/load.ts`).
export const Route = createFileRoute('/w/$slug/settings/scheduling/routing')({
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  validateSearch: routingSearch,
  loader: ({ context, params }) => loadRouting(context.data, params.slug),
  pendingComponent: () => (
    <LoadingNow>
      <SchedulingSettingsPage title={strings.routing} isLoading>
        <RoutingPending />
      </SchedulingSettingsPage>
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
    <SchedulingSettingsPage title={strings.routing} hasToolsInBar>
      <RoutingScreen
        data={data}
        slug={slug}
        search={search}
        members={members}
        {...(stage === undefined ? {} : { stage })}
        toasts={toasts}
        onSearch={(next) => void navigate({ search: (current) => ({ ...current, ...next }), replace: true })}
      />
    </SchedulingSettingsPage>
  );
}

function RoutingError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.routing}
      heading={routingStrings.failedTitle}
      text={isDataError(error) ? error.message : routingStrings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
