import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { limitsStrings as strings } from '../features/booking/limits-strings.ts';
import { memberSearch } from '../features/booking/links.ts';
import { MeetingLimitsPending, MeetingLimitsScreen } from '../features/booking/MeetingLimitsScreen.tsx';
import { SettingsFailed } from '../features/settings/SettingsPage.tsx';

// Bookings settings › Meeting limits (spec 0037, AC-1297 to AC-1299; out of Availability on 10 November 2026, the
// mock's Meetings group). `?member=` names a colleague in the reader's reach (`members.visible`); anyone outside it
// opens the reader's own. The limits are held through the data layer before the page draws, read again live.
export const Route = createFileRoute('/w/$slug/bookings_/settings/limits')({
  // One chunk for the page, its loading and its failure (the first load carries one import for it, not three).
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  validateSearch: memberSearch,
  loaderDeps: ({ search }) => ({ member: search.member }),
  loader: async ({ context, params, deps }) => {
    const [access, scheduling] = await Promise.all([
      context.data.access.mine(params.slug),
      context.data.scheduling.open(),
    ]);
    const members = await scheduling.visible(params.slug);
    const member =
      deps.member !== undefined && deps.member !== access.memberId && members.some((each) => each.id === deps.member)
        ? deps.member
        : undefined;
    // A failure shows in the Card, with its retry.
    await scheduling.limits
      .held(params.slug, member)
      .ready()
      .catch(() => undefined);
    return { member, members, me: access.memberId };
  },
  pendingComponent: () => (
    <LoadingNow>
      <MeetingLimitsPending />
    </LoadingNow>
  ),
  errorComponent: MeetingLimitsError,
  component: MeetingLimitsRoute,
});

function MeetingLimitsRoute() {
  const { member, members, me } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  return <MeetingLimitsScreen data={data} slug={slug} member={member} members={members} me={me} />;
}

function MeetingLimitsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.loadFailed}
      text={isDataError(error) ? error.message : strings.loadFailedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
