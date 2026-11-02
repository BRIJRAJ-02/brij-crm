import { isDataError, type AttributeDefinition, type DataLayer } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn } from '@crm/ui';
import { createFileRoute, redirect, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RotationsPending, RotationsScreen } from '../features/booking/RotationsScreen.tsx';
import { RoutingPending, RoutingScreen, type RoutingSearch } from '../features/routing/RoutingScreen.tsx';
import { strings as rotationStrings } from '../features/booking/rotation-strings.ts';
import { strings as routingStrings } from '../features/routing/tab-strings.ts';
import { SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { useCan } from '../features/workspace/WorkspacePage.tsx';

// Bookings › Hosts (2 November 2026): who takes the booking, in two views the address holds as `v` — Groups (the
// round robin groups, spec 0029) and Rules (routing, spec 0037 AC-1383). They were two tabs, Round robin and
// Routing, one word apart and both answering the same question: the group is the pool, the rule picks from it.
// Lane L9's Insights belongs here too, as a third view (`v=insights`), not a fifth tab.
// Rules is only for holders of `routing.manage` (owners and admins), exactly as the Routing tab was: without it
// the view is not drawn at all and `?v=rules` falls back to Groups. Groups itself still needs `booking.manage`;
// without it the page is absent, as it always was (SS-R10).

/** What Hosts' address holds: which view, plus whatever that view's own search is. */
export type HostsSearch = { readonly v?: 'rules' } & RoutingSearch;

export const Route = createFileRoute('/w/$slug/bookings/hosts')({
  validateSearch: (raw: Record<string, unknown>): HostsSearch => {
    const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
    const tag = text(raw.tag);
    const period = text(raw.period);
    const surface = text(raw.surface);
    const rule = text(raw.rule);
    const host = text(raw.host);
    const decision = text(raw.decision);
    return {
      ...(raw.v === 'rules' ? { v: 'rules' as const } : {}),
      view: raw.view === 'decisions' || raw.view === 'skills' || raw.view === 'test' ? raw.view : 'overview',
      ...(surface === undefined ? {} : { surface }),
      ...(rule === undefined ? {} : { rule }),
      ...(host === undefined ? {} : { host }),
      ...(tag === 'yes' || tag === 'no' || tag === 'none' ? { tag } : {}),
      ...(period === 'today' || period === '7' || period === '30' || period === '90' ? { period } : {}),
      ...(decision === undefined ? {} : { decision }),
    };
  },
  loaderDeps: ({ search }) => ({ isRules: search.v === 'rules' }),
  loader: async ({ context, params, deps }) => {
    try {
      // The access read comes first, from the data layer's cache, so nothing else is asked for when the reader
      // may not see the page at all (hidden means absent).
      const access = await context.data.access.mine(params.slug);
      if (deps.isRules) {
        // Without routing.manage there are no rules to show: the switch never offers them, and a held link to
        // them lands on the groups instead of on an empty page.
        if (!access.permissions.includes('routing.manage')) {
          throw redirect({
            to: '/w/$slug/bookings/hosts',
            params: { slug: params.slug },
            search: { view: 'overview' as const },
            replace: true,
          });
        }
        const [members, stage] = await Promise.all([
          context.data.members.list(params.slug),
          dealsStage(context.data, params.slug),
        ]);
        return { view: 'rules' as const, members, ...(stage === undefined ? {} : { stage }) };
      }
      const canRoute = access.permissions.includes('routing.manage');
      if (!access.permissions.includes('booking.manage')) return { view: 'groups' as const, page: undefined, canRoute };
      const [people] = await Promise.all([
        context.data.members.list(params.slug),
        context.data.rotations.view(params.slug).ready(),
      ]);
      // A guest is never offered as a member of a group or as its editor: guests take no bookings (spec 0031, slice 9).
      const hosts = people.filter((person) => person.role !== 'guest');
      return {
        view: 'groups' as const,
        page: { canManage: access.permissions.includes('booking.admin'), people: hosts },
        // The switch itself: drawn only for a reader who may see the rules.
        canRoute,
      };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND')
        return { view: 'groups' as const, page: undefined, canRoute: false };
      throw error;
    }
  },
  pendingComponent: HostsPending,
  errorComponent: HostsError,
  component: HostsRoute,
});

/** Deals' Stage field (api slug `stage`), for Won means (spec 0037, AC-1385); none when Deals or the field is hidden. */
async function dealsStage(data: DataLayer, slug: string): Promise<AttributeDefinition | undefined> {
  const objects = await data.objects.list(slug);
  const deals = objects.find((each) => each.standardKey === 'deals');
  if (deals === undefined) return undefined;
  const attributes = await data.attributes.list(slug, deals.id);
  return attributes.find((each) => each.apiSlug === 'stage' && !each.isArchived);
}

/**
 * The skeleton while the loader runs. It follows `?v=rules` only for a holder of `routing.manage`: for anybody
 * else the loader is about to send them to the groups, so a routing skeleton would both name a view they may not
 * have and stand where the page will not. The permission comes from the frame's held access read.
 */
function HostsPending() {
  const { v } = Route.useSearch();
  const canRoute = useCan('routing.manage');
  return <LoadingNow>{v === 'rules' && canRoute ? <RoutingPending /> : <RotationsPending inFrame />}</LoadingNow>;
}

function HostsRoute() {
  const loaded = Route.useLoaderData();
  return loaded.view === 'rules' ? <HostsRules /> : <HostsGroups />;
}

/** Hosts › Rules: what every routed form and team page shares (spec 0037, AC-1383). */
function HostsRules() {
  const loaded = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const { data, toasts } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  if (loaded.view !== 'rules') return undefined;
  return (
    <RoutingScreen
      data={data}
      slug={slug}
      search={search}
      members={loaded.members}
      {...(loaded.stage === undefined ? {} : { stage: loaded.stage })}
      toasts={toasts}
      hasGroupsSwitch
      onSearch={(next) => void navigate({ search: (current) => ({ ...current, ...next }), replace: true })}
    />
  );
}

/** Hosts › Groups: the round robin groups a booking is shared out between (spec 0029). */
function HostsGroups() {
  const loaded = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (loaded.view !== 'groups') return undefined;
  if (loaded.page === undefined) return <SettingsMissing backTo="home" />;
  return (
    <RotationsScreen
      inFrame
      data={data}
      slug={slug}
      people={loaded.page.people}
      canManage={loaded.page.canManage}
      hasRulesSwitch={loaded.canRoute}
    />
  );
}

function HostsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const { v } = Route.useSearch();
  return (
    // Inside the Bookings frame, which already draws the TopBar and the tab strip: the tab's own panel says so.
    <PageColumn>
      <EmptyState
        tone="error"
        title={v === 'rules' ? routingStrings.failedTitle : rotationStrings.failedTitle}
        onRetry={() => void router.invalidate()}
      >
        {isDataError(error) ? error.message : rotationStrings.failedText}
      </EmptyState>
    </PageColumn>
  );
}
