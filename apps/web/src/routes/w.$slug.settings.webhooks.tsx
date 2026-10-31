import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { WebhooksPending, WebhooksScreen } from '../features/settings/WebhooksScreen.tsx';
import { strings } from '../features/settings/webhooks-strings.ts';

// Settings › Workspace › Webhooks (spec 0064, AC-6419): owners and admins (`webhooks.manage`). Settings, not CRM data:
// read when the page opens, and each write answers what changed. Anyone else finds no such page (hidden means absent),
// as the navigation never offers it to them: the access read comes first, from the data layer's cache.
export const Route = createFileRoute('/w/$slug/settings/webhooks')({
  loader: async ({ context, params }) => {
    try {
      const access = await context.data.access.mine(params.slug);
      if (!access.permissions.includes('webhooks.manage')) return { list: undefined };
      return { list: await context.data.webhooks.list(params.slug) };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) return { list: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <WebhooksPending />
    </LoadingNow>
  ),
  errorComponent: WebhooksError,
  component: WebhooksRoute,
});

function WebhooksRoute() {
  const { list } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (list === undefined) return <SettingsMissing backTo="home" />;
  return <WebhooksScreen data={data} toasts={toasts} slug={slug} initial={list} />;
}

function WebhooksError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.failedTitle}
      text={isDataError(error) && error.code !== 'INTERNAL' ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
