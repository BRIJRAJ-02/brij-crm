import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { DeveloperPending, DeveloperScreen } from '../features/settings/DeveloperScreen.tsx';
import { strings } from '../features/settings/developer-nav-strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Settings › Workspace › Developer (parity #34): the workspace's API keys, for holders of `api_keys.manage` alone;
// anyone else finds nothing here. The loader warms the held key list through the data layer; the screen holds it, so
// every key write shows at once.
export const Route = createFileRoute('/w/$slug/settings/developer')({
  // One chunk for the page, its loading and its failure.
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  loader: async ({ context, params }) => {
    try {
      const access = await context.data.access.mine(params.slug);
      if (!access.permissions.includes('api_keys.manage')) return { allowed: false };
      await context.data.apiKeys.view(params.slug).ready();
      return { allowed: true };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { allowed: false };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <DeveloperPending />
    </LoadingNow>
  ),
  errorComponent: DeveloperError,
  component: DeveloperRoute,
});

function DeveloperRoute() {
  const { allowed } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (!allowed) return <SettingsMissing backTo="home" />;
  return <DeveloperScreen data={data} toasts={toasts} slug={slug} />;
}

function DeveloperError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.somethingWrong}
      onRetry={() => void router.invalidate()}
    />
  );
}
