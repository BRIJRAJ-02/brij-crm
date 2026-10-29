import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { strings } from '../features/settings/scheduling-access-strings.ts';
import { SchedulingAccessLoading, SchedulingAccessScreen } from '../features/settings/SchedulingAccessScreen.tsx';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Account › Scheduling access (spec 0037, AC-1266): who can see or manage the member's scheduling, and
// whose they reach. The loader starts the member's delegations through the data layer, which the screen then holds,
// so a grant or a removal by someone else (an `access` row naming them) reaches the open page.
export const Route = createFileRoute('/w/$slug/settings/account/scheduling')({
  loader: async ({ context, params }) => {
    const held = context.data.scheduling.delegations(params.slug, 'mine');
    const [access, members] = await Promise.all([
      context.data.access.mine(params.slug),
      context.data.members.list(params.slug),
      held.ready(),
    ]);
    return { access, members };
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
  const { access, members } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  return <SchedulingAccessScreen data={data} toasts={toasts} slug={slug} access={access} members={members} />;
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
