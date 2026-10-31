import { isDataError, type MemberSummary } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RoutingPending, RoutingScreen, type RoutingSearch } from '../features/routing/RoutingScreen.tsx';
import { strings } from '../features/routing/tab-strings.ts';
import { SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Bookings › Routing (spec 0037, AC-1383): what every routed form and team page shares, for holders of
// routing.manage (owners and admins). Overview (`?view` absent) and Decisions (`?view=decisions`, with its filters
// and the decision open in the address). Without routing.manage there is no such page (hidden means absent): the
// access read comes first, from the data layer's cache, so nothing else is asked for then. The screen holds the
// Overview and the Decisions log from the data layer, read again whenever the person comes back to the page.
export const Route = createFileRoute('/w/$slug/bookings/routing')({
  validateSearch: (raw: Record<string, unknown>): RoutingSearch => {
    const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
    const tag = text(raw.tag);
    const period = text(raw.period);
    const surface = text(raw.surface);
    const rule = text(raw.rule);
    const host = text(raw.host);
    const decision = text(raw.decision);
    return {
      view: raw.view === 'decisions' ? 'decisions' : 'overview',
      ...(surface === undefined ? {} : { surface }),
      ...(rule === undefined ? {} : { rule }),
      ...(host === undefined ? {} : { host }),
      ...(tag === 'yes' || tag === 'no' || tag === 'none' ? { tag } : {}),
      ...(period === 'today' || period === '7' || period === '30' || period === '90' ? { period } : {}),
      ...(decision === undefined ? {} : { decision }),
    };
  },
  loader: async ({ context, params }): Promise<{ readonly members?: readonly MemberSummary[] }> => {
    try {
      const access = await context.data.access.mine(params.slug);
      if (!access.permissions.includes('routing.manage')) return {};
      return { members: await context.data.members.list(params.slug) };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return {};
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <RoutingPending />
    </LoadingNow>
  ),
  errorComponent: RoutingError,
  component: RoutingRoute,
});

function RoutingRoute() {
  const { members } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const { data } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  if (members === undefined) return <SettingsMissing backTo="home" />;
  return (
    <RoutingScreen
      data={data}
      slug={slug}
      search={search}
      members={members}
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
