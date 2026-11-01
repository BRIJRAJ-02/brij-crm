import { isDataError } from '@crm/data';
import { EmptyState, LoadingNow, PageColumn } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RotationsPending, RotationsScreen } from '../features/booking/RotationsScreen.tsx';
import { strings } from '../features/booking/rotation-strings.ts';
import { SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Bookings › Round robin (spec 0029), up out of Settings › Scheduling (25 October 2026): the rotations the reader
// may see, from the data layer's held list (`rotations.view`), which every rotation write patches. Owners and
// admins (`booking.admin`) make and change them; anyone else who makes booking pages (`booking.manage`) sees the
// ones they're in. Without `booking.manage` there is no such page (hidden means absent), as the navigation never
// offers it (SS-R10): the access read comes first, from the data layer's cache, so nothing else is asked for then.
// The old Settings address redirects here.
export const Route = createFileRoute('/w/$slug/bookings/round-robin')({
  loader: async ({ context, params }) => {
    try {
      const access = await context.data.access.mine(params.slug);
      if (!access.permissions.includes('booking.manage')) return { page: undefined };
      const [people] = await Promise.all([
        context.data.members.list(params.slug),
        context.data.rotations.view(params.slug).ready(),
      ]);
      // A guest is never offered as a member of a group or as its editor: guests take no bookings (spec 0031, slice 9).
      const hosts = people.filter((person) => person.role !== 'guest');
      return { page: { canManage: access.permissions.includes('booking.admin'), people: hosts } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <RotationsPending inFrame />
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
  return <RotationsScreen inFrame data={data} slug={slug} people={page.people} canManage={page.canManage} />;
}

function RotationsError({ error }: ErrorComponentProps) {
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
