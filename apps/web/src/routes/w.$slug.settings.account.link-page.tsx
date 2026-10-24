import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { LinkPagePending } from '../features/link-page/LinkPagePending.tsx';
import { LinkPageScreen } from '../features/link-page/LinkPageScreen.tsx';
import { strings } from '../features/link-page/strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Settings › Account › Link page (spec 0051): the person's page at /<handle>, built as blocks, beside its phone
// preview. The loader reads the profile (the handle and the card's name, bio and picture) and starts the blocks,
// never waiting for them: the list shows its own loading and failure, so a slow read never holds up the page.
export const Route = createFileRoute('/w/$slug/settings/account/link-page')({
  loader: async ({ context, params }) => {
    context.data.linkPage.read(params.slug).catch(() => undefined);
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
  return <LinkPageScreen key={profile.memberId} data={data} slug={slug} profile={profile} />;
}

function LinkPageError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
