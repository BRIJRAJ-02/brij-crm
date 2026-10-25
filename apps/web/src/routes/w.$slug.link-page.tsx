import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { LinkPageLoader } from '../features/link-page/LinkPageLoader.tsx';
import { LinkPagePending } from '../features/link-page/LinkPagePending.tsx';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings as linkPageStrings } from '../features/link-page/strings.ts';
import { strings } from '../features/settings/workspace-strings.ts';

// The member's own link page (spec 0051), a page of the workspace since 25 October 2026. It answered at
// `/w/$slug/settings/account/profile?view=link-page` until then: three levels inside configuration, behind a query
// parameter, for the surface a member opens most (the owner). That address still works and comes here.
export const Route = createFileRoute('/w/$slug/link-page')({
  loader: async ({ context, params }) => {
    try {
      return { profile: await context.data.profile.get(params.slug) };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { profile: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <LinkPagePending />
    </LoadingNow>
  ),
  errorComponent: LinkPageError,
  component: LinkPageRoute,
});

function LinkPageRoute() {
  const { profile } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  if (profile === undefined) return <SettingsMissing backTo="home" />;
  return <LinkPageLoader data={data} slug={slug} profile={profile} />;
}

function LinkPageError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={linkPageStrings.title}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
