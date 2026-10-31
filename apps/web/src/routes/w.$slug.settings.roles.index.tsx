import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RolesPending, RolesScreen } from '../features/settings/RolesScreen.tsx';
import { strings } from '../features/settings/roles-strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Settings › Workspace › Roles (spec 0037, AC-1239): every member reads the roles and what each can do; holders of
// `access.manage` also make and change custom ones. Everything through the data layer. The roles are held too, so a
// live `members` event (another admin changed a role) reloads this route.
export const Route = createFileRoute('/w/$slug/settings/roles/')({
  // One chunk for the page, its loading and its failure (the first load carries one import for it, not three).
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  loader: async ({ context, params }) => {
    try {
      const [access, overview] = await Promise.all([
        context.data.access.mine(params.slug),
        context.data.roles.overview(params.slug),
      ]);
      return { screen: { canManage: access.permissions.includes('access.manage'), overview } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { screen: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <RolesPending />
    </LoadingNow>
  ),
  errorComponent: RolesError,
  component: RolesRoute,
});

function RolesRoute() {
  const { screen } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (screen === undefined) return <SettingsMissing backTo="home" />;
  return (
    <RolesScreen data={data} toasts={toasts} slug={slug} overview={screen.overview} canManage={screen.canManage} />
  );
}

function RolesError({ error }: ErrorComponentProps) {
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
