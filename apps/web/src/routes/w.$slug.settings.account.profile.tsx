import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useLocation, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { LinkPageLoader } from '../features/link-page/LinkPageLoader.tsx';
import { LinkPagePending } from '../features/link-page/LinkPagePending.tsx';
import { ProfilePending, ProfileScreen } from '../features/settings/ProfileScreen.tsx';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { isGooglePhotoResult, strings, type GooglePhotoResult } from '../features/settings/workspace-strings.ts';

/** The page's address: how a Google photo sync just went, if one did (`?google-photo=`, from the API's callback). */
interface ProfileSearch {
  readonly 'google-photo'?: GooglePhotoResult;
}

// Settings › Account › Profile (spec 0031, AC-821): the member's own name, picture and time zone in this workspace,
// their public profile, and a row that opens their link page's editor (spec 0051).
export const Route = createFileRoute('/w/$slug/settings/account/profile')({
  // A result this build doesn't know (one the API added since) says the sync didn't work, rather than nothing.
  validateSearch: (search: Record<string, unknown>): ProfileSearch => {
    const result = search['google-photo'];
    if (typeof result !== 'string') return {};
    return { 'google-photo': isGooglePhotoResult(result) ? result : 'failed' };
  },
  loader: async ({ context, params }) => {
    try {
      return { profile: await context.data.profile.get(params.slug) };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { profile: undefined };
      throw error;
    }
  },
  pendingComponent: ProfileRoutePending,
  errorComponent: ProfileError,
  component: ProfileRoute,
});

function ProfileRoute() {
  const { profile } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  const { 'google-photo': photoResult } = Route.useSearch();
  const view = useLinkPageView();
  const router = useRouter();
  const navigate = useNavigate();
  if (profile === undefined) return <SettingsMissing backTo="home" />;
  if (view) return <LinkPageLoader data={data} slug={slug} profile={profile} />;
  return (
    <ProfileScreen
      key={profile.memberId}
      data={data}
      slug={slug}
      profile={profile}
      onChanged={() => router.invalidate()}
      {...(photoResult === undefined ? {} : { photoResult })}
      onPhotoResultSeen={() =>
        void navigate({ to: '/w/$slug/settings/account/profile', params: { slug }, search: {}, replace: true })
      }
    />
  );
}

/**
 * Whether the address asks for the link page's editor (`?view=link-page`, spec 0051), read off the address in the
 * page's own chunk rather than validated up front, so the app's first load carries none of it.
 */
function useLinkPageView(): boolean {
  return useLocation({ select: (location) => new URLSearchParams(location.searchStr).get('view') === 'link-page' });
}

/** While the profile loads: the link page's own shape for its view, else Profile's. */
function ProfileRoutePending() {
  const view = useLinkPageView();
  return <LoadingNow>{view ? <LinkPagePending /> : <ProfilePending />}</LoadingNow>;
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
