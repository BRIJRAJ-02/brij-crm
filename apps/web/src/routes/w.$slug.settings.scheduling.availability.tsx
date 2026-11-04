import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AvailabilityPending, AvailabilityScreen } from '../features/booking/AvailabilityScreen.tsx';
import { loadAvailability } from '../features/booking/availability-load.ts';
import { availabilitySearch } from '../features/booking/links.ts';
import { scheduleStrings } from '../features/booking/schedule-strings.ts';
import { SchedulingSettingsPage } from '../features/settings/SchedulingSettingsPage.tsx';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/strings.ts';

// Settings › Scheduling › Availability (5 November 2026): the screen Bookings › Availability shows (spec 0035), here
// so every setting is under Settings. One screen and one loader (`availability-load.ts`); `?member=` and
// `?schedule=` read as they do on the tab, and a switch keeps the reader on this address.
export const Route = createFileRoute('/w/$slug/settings/scheduling/availability')({
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  validateSearch: availabilitySearch,
  loaderDeps: ({ search }) => ({ member: search.member }),
  loader: ({ context, params, deps }) => loadAvailability(context.data, params.slug, deps.member),
  pendingComponent: () => (
    <LoadingNow>
      <SchedulingSettingsPage title={strings.availability} isLoading>
        <AvailabilityPending />
      </SchedulingSettingsPage>
    </LoadingNow>
  ),
  errorComponent: AvailabilityError,
  component: AvailabilityRoute,
});

function AvailabilityRoute() {
  const { member, members, me, ownHours, people } = Route.useLoaderData();
  const { schedule } = Route.useSearch();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  return (
    <SchedulingSettingsPage title={strings.availability}>
      <AvailabilityScreen
        data={data}
        slug={slug}
        scheduleId={schedule}
        member={member}
        members={members}
        me={me}
        ownHours={ownHours}
        nameOf={(id) => people.find((person) => person.id === id)?.name}
        // Who may cover time off: never a guest, who takes no bookings (spec 0031, slice 9).
        people={people.filter((person) => person.role !== 'guest')}
      />
    </SchedulingSettingsPage>
  );
}

function AvailabilityError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.availability}
      heading={scheduleStrings.schedulesFailed}
      text={isDataError(error) ? error.message : scheduleStrings.schedulesFailed}
      onRetry={() => void router.invalidate()}
    />
  );
}
