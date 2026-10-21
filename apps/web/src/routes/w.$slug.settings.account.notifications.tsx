import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { strings } from '../features/settings/notifications-strings.ts';
import {
  NotificationSettingsLoading,
  NotificationSettingsScreen,
} from '../features/settings/NotificationSettingsScreen.tsx';
import { SettingsFailed, SettingsMissing, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Account › Notifications (spec 0038, AC-1179): the member's email
// settings for this workspace. The loader starts them through the data layer
// (the inbox's store loads in its own chunk); the screen holds them, so a
// change in another tab shows here live.
export const Route = createFileRoute('/w/$slug/settings/account/notifications')({
  loader: async ({ context, params }) => {
    try {
      return { page: { settings: await context.data.inbox.settings(params.slug) } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.title} isLoading>
        <NotificationSettingsLoading />
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: NotificationSettingsError,
  component: NotificationSettingsRoute,
});

function NotificationSettingsRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (page === undefined) return <SettingsMissing backTo="home" />;
  return <NotificationSettingsScreen slug={slug} settings={page.settings} />;
}

function NotificationSettingsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.loadFailed}
      text={isDataError(error) ? error.message : strings.loadFailed}
      onRetry={() => void router.invalidate()}
    />
  );
}
