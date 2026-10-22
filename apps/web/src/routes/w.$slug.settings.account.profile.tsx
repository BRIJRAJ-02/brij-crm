import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ProfilePending, ProfileScreen } from '../features/settings/ProfileScreen.tsx';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings } from '../features/settings/workspace-strings.ts';

// Settings › Account › Profile (spec 0031, AC-821): the member's own name, picture and time zone in this workspace,
// their public profile, and the order it lists their Public pages in (owner ask A102).
export const Route = createFileRoute('/w/$slug/settings/account/profile')({
  loader: async ({ context, params }) => {
    // The booking pages, read beside the profile and never waited for: the order's section shows its own loading
    // and failure, so a slow or refused list never holds up the page.
    context.data.bookingPages
      .view(params.slug)
      .ready()
      .catch(() => undefined);
    try {
      return { profile: await context.data.profile.get(params.slug) };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { profile: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <ProfilePending />
    </LoadingNow>
  ),
  errorComponent: ProfileError,
  component: ProfileRoute,
});

function ProfileRoute() {
  const { profile } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  const router = useRouter();
  if (profile === undefined) return <SettingsMissing backTo="home" />;
  return (
    <ProfileScreen
      key={profile.memberId}
      data={data}
      slug={slug}
      profile={profile}
      onChanged={() => router.invalidate()}
    />
  );
}

function ProfileError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.profileTitle}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
