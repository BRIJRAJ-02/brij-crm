import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RotationsPending, RotationsScreen } from '../features/booking/RotationsScreen.tsx';
import { strings } from '../features/booking/rotation-strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Settings › Scheduling › Rotations (spec 0029; spec 0037 AC-1433 gives it its own Settings entry): the rotations
// the reader may see, from the data layer's held list (`rotations.view`), which every rotation write patches. Owners
// and admins (`booking.admin`) make and change them; anyone else sees the ones they're in.
export const Route = createFileRoute('/w/$slug/settings/scheduling/rotations')({
  loader: async ({ context, params }) => {
    try {
      const [access, people] = await Promise.all([
        context.data.access.mine(params.slug),
        context.data.members.list(params.slug),
        context.data.rotations.view(params.slug).ready(),
      ]);
      return { page: { canManage: access.permissions.includes('booking.admin'), people } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <RotationsPending />
    </LoadingNow>
  ),
  errorComponent: RotationsError,
  component: RotationsRoute,
});

function RotationsRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (page === undefined) return <SettingsMissing backTo="home" />;
  return <RotationsScreen data={data} slug={slug} people={page.people} canManage={page.canManage} />;
}

function RotationsError({ error }: ErrorComponentProps) {
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
