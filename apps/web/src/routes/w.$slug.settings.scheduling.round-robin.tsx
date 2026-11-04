import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RotationsPending, RotationsScreen } from '../features/booking/RotationsScreen.tsx';
import { strings } from '../features/booking/rotation-strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Settings › Scheduling › Round robin (spec 0029; back in Settings on 5 November 2026, so every setting is under
// Settings): the screen Bookings › Round robin shows too, as a settings page with its New group in the TopBar. The
// rotations the reader may see come from the data layer's held list; without `booking.manage` there is no such page
// (hidden means absent), and the access read comes first, from the data layer's cache.
export const Route = createFileRoute('/w/$slug/settings/scheduling/round-robin')({
  loader: async ({ context, params }) => {
    try {
      const access = await context.data.access.mine(params.slug);
      if (!access.permissions.includes('booking.manage')) return { page: undefined };
      const [people] = await Promise.all([
        context.data.members.list(params.slug),
        context.data.rotations.view(params.slug).ready(),
      ]);
      // A guest is never offered as a member of a group or as its editor (spec 0031, slice 9).
      const hosts = people.filter((person) => person.role !== 'guest');
      return { page: { canManage: access.permissions.includes('booking.admin'), people: hosts } };
    } catch (error) {
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
