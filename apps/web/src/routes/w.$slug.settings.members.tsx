import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { MembersPending, MembersScreen } from '../features/settings/MembersScreen.tsx';
import { strings } from '../features/settings/members-strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';

// Settings › Workspace › Members (spec 0031, AC-810): every member reads the list; holders of `members.invite` also
// get the open invitations. Everything through the data layer; a live `members` event reloads this route.
export const Route = createFileRoute('/w/$slug/settings/members')({
  loader: async ({ context, params }) => {
    try {
      const [access, members] = await Promise.all([
        context.data.access.mine(params.slug),
        context.data.members.list(params.slug),
      ]);
      const invitations = access.permissions.includes('members.invite')
        ? await context.data.invitations.list(params.slug)
        : undefined;
      return { page: { access, members, invitations } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { page: undefined };
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <MembersPending />
    </LoadingNow>
  ),
  errorComponent: MembersError,
  component: MembersRoute,
});

function MembersRoute() {
  const { page } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data, toasts } = Route.useRouteContext();
  if (page === undefined) return <SettingsMissing backTo="home" />;
  return (
    <MembersScreen
      data={data}
      toasts={toasts}
      slug={slug}
      members={page.members}
      invitations={page.invitations}
      access={page.access}
    />
  );
}

function MembersError({ error }: ErrorComponentProps) {
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
