import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RolePending, RoleScreen } from '../features/settings/RoleScreen.tsx';
import { strings } from '../features/settings/roles-strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';

// One role's page (spec 0037, AC-1240): a built in role by its name, a custom one by its id, both from the roles
// overview the Roles page holds (one read; a live `members` event reads it again and reloads this route).
export const Route = createFileRoute('/w/$slug/settings/roles/$roleId')({
  // One chunk for the page, its loading and its failure (the first load carries one import for it, not three).
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  loader: async ({ context, params }) => {
    try {
      const [access, overview, members] = await Promise.all([
        context.data.access.mine(params.slug),
        context.data.roles.overview(params.slug),
        context.data.members.list(params.slug),
      ]);
      const role = overview.roles.find((each) => each.id === params.roleId);
      if (role === undefined) return { screen: undefined };
      return {
        screen: {
          role,
          overview,
          members,
          canManage: access.permissions.includes('access.manage'),
          canChangePeople: access.permissions.includes('members.manage'),
        },
      };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') return { screen: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <RolePending />
    </LoadingNow>
  ),
  errorComponent: RoleError,
  component: RoleRoute,
});

function RoleRoute() {
  const { screen } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (screen === undefined) return <SettingsMissing backTo="home" />;
  return <RoleScreen data={data} toasts={toasts} slug={slug} {...screen} />;
}

function RoleError({ error }: ErrorComponentProps) {
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
