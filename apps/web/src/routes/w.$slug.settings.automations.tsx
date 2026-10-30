import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AutomationsPending, AutomationsScreen } from '../features/automations/AutomationsScreen.tsx';
import { strings } from '../features/automations/strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Settings, Automations (parity #53): "when X, if Y, do Z" for owners and admins (`automations.manage`). The loader
// warms the held list and run log, the objects and the members through the data layer; the screen holds them, so it
// updates live as runs finish. Anyone without the permission finds nothing here.
export const Route = createFileRoute('/w/$slug/settings/automations')({
  loader: async ({ context, params }) => {
    try {
      const access = await context.data.access.mine(params.slug);
      if (!access.permissions.includes('automations.manage')) return { page: undefined };
      const [objects, members, held] = await Promise.all([
        context.data.objects.list(params.slug),
        context.data.members.list(params.slug),
        context.data.automations.open(params.slug),
      ]);
      await held.ready();
      return { page: { held, objects, members } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <AutomationsPending />
    </LoadingNow>
  ),
  errorComponent: AutomationsError,
  component: AutomationsRoute,
});

function AutomationsRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (page === undefined) return <SettingsMissing backTo="home" />;
  return <AutomationsScreen data={data} slug={slug} held={page.held} objects={page.objects} members={page.members} />;
}

function AutomationsError({ error }: ErrorComponentProps) {
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
