import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { TeamsPending, TeamsScreen } from '../features/settings/TeamsScreen.tsx';
import { strings } from '../features/settings/teams-strings.ts';

// Settings › Workspace › Teams (spec 0031, slice 8, AC-824, AC-827): every member reads the teams and who is in them;
// holders of `teams.manage` also change them. Everything through the data layer. The teams are held too, so a live
// `members` event (another admin changed a team) reloads this route.
export const Route = createFileRoute('/w/$slug/settings/teams')({
  // One chunk for the page, its loading and its failure (the first load carries one import for it, not three).
  codeSplitGroupings: [['component', 'pendingComponent', 'errorComponent']],
  loader: async ({ context, params }) => {
    try {
      const [access, teams, members] = await Promise.all([
        context.data.access.mine(params.slug),
        context.data.teams.list(params.slug),
        context.data.members.list(params.slug),
      ]);
      return { screen: { canManage: access.permissions.includes('teams.manage'), teams, members } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { screen: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <TeamsPending />
    </LoadingNow>
  ),
  errorComponent: TeamsError,
  component: TeamsRoute,
});

function TeamsRoute() {
  const { screen } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (screen === undefined) return <SettingsMissing backTo="home" />;
  return (
    <TeamsScreen
      data={data}
      toasts={toasts}
      slug={slug}
      teams={screen.teams}
      members={screen.members}
      canManage={screen.canManage}
    />
  );
}

function TeamsError({ error }: ErrorComponentProps) {
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
