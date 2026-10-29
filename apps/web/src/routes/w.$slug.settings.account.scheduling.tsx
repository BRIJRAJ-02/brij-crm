import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { strings } from '../features/settings/scheduling-access-nav-strings.ts';
import { SchedulingAccessLoading, SchedulingAccessScreen } from '../features/settings/SchedulingAccessScreen.tsx';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Account › Scheduling access (spec 0037, AC-1266): who can see or manage the member's scheduling, and
// whose they reach. The loader starts the member's delegations through the data layer, which the screen then holds,
// so a grant or a removal by someone else (an `access` row naming them) reaches the open page.
export const Route = createFileRoute('/w/$slug/settings/account/scheduling')({
  // One chunk for the page, its loading and its failure (the first load carries one import for it, not three).
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  loader: async ({ context, params }) => {
    const [access, members, scheduling] = await Promise.all([
      context.data.access.mine(params.slug),
      context.data.members.list(params.slug),
      context.data.scheduling.open(),
    ]);
    await scheduling.delegations(params.slug, 'mine').ready();
    return { access, members, scheduling };
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.title} isLoading>
        <SchedulingAccessLoading />
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: SchedulingAccessError,
  component: SchedulingAccessRoute,
});

function SchedulingAccessRoute() {
  const { access, members, scheduling } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  return (
    <SchedulingAccessScreen scheduling={scheduling} toasts={toasts} slug={slug} access={access} members={members} />
  );
}

function SchedulingAccessError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.loadFailed}
      text={isDataError(error) ? error.message : strings.loadFailed}
      onRetry={() => void router.invalidate()}
    />
  );
}
