import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { WorkspaceSecurityPending, WorkspaceSecurityScreen } from '../features/settings/WorkspaceSecurityScreen.tsx';
import { strings } from '../features/settings/workspace-security-strings.ts';

// Settings › Workspace › Security (spec 0033, milestone 4): the workspace's sign in rules, owners only. Settings, not
// CRM data: read when the page opens, and each change answers the new rules. Anyone else finds no such page (hidden
// means absent), as the navigation never offers it to them: the access read comes first, from the data layer's
// cache, so nothing is asked of the server for them (Q101), as Round robin does (SS-R10).
export const Route = createFileRoute('/w/$slug/settings/security')({
  loader: async ({ context, params }) => {
    const workspaceName =
      context.me.workspaces.find((workspace) => workspace.slug === params.slug)?.name ?? params.slug;
    try {
      const access = await context.data.access.mine(params.slug);
      if (!access.permissions.includes('security.manage')) return { workspaceName, rules: undefined };
      return { workspaceName, rules: await context.data.workspaceSecurity.get(params.slug) };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
        return { workspaceName, rules: undefined };
      }
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <WorkspaceSecurityPending />
    </LoadingNow>
  ),
  errorComponent: WorkspaceSecurityError,
  component: WorkspaceSecurityRoute,
});

function WorkspaceSecurityRoute() {
  const { workspaceName, rules } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (rules === undefined) return <SettingsMissing backTo="home" />;
  return (
    <WorkspaceSecurityScreen data={data} toasts={toasts} slug={slug} workspaceName={workspaceName} initial={rules} />
  );
}

function WorkspaceSecurityError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.title}
      heading={strings.failedTitle}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
