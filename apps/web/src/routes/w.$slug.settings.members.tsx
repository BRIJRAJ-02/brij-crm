import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useNavigate, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useCallback } from 'react';
import { MembersPending, MembersScreen } from '../features/settings/MembersScreen.tsx';
import { strings } from '../features/settings/members-strings.ts';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { useWorkspaceName } from '../features/workspace/WorkspacePage.tsx';

/** The Members page's search (`?q=`): what the list is searched by, cut to the server's limit. */
interface MembersSearch {
  readonly q?: string;
}

// Settings › Workspace › Members (spec 0031, AC-810): every member reads the list, a page at a time, searched by
// `?q=`; holders of `members.invite` also get the open invitations. Everything through the data layer. The whole
// list is held too, so a live `members` event (a role changed, someone joined) reloads this route.
export const Route = createFileRoute('/w/$slug/settings/members')({
  validateSearch: (search: Record<string, unknown>): MembersSearch => {
    const q = typeof search.q === 'string' ? search.q.trim().slice(0, 100) : '';
    return q === '' ? {} : { q };
  },
  loaderDeps: ({ search }) => ({ q: search.q ?? '' }),
  loader: async ({ context, params, deps }) => {
    try {
      const [access, page, roles] = await Promise.all([
        context.data.access.mine(params.slug),
        context.data.members.page(params.slug, { search: deps.q }),
        context.data.roles.list(params.slug),
        context.data.members.list(params.slug),
      ]);
      const invitations = access.permissions.includes('members.invite')
        ? await context.data.invitations.list(params.slug)
        : undefined;
      return { screen: { access, page, roles, invitations } };
    } catch (error) {
      // The frame above shows "workspace not found" for this one.
      if (isDataError(error) && error.code === 'NOT_FOUND') return { screen: undefined };
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
  const { screen } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { q = '' } = Route.useSearch();
  const { data, toasts } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  const workspaceName = useWorkspaceName() ?? slug;
  const onSearch = useCallback(
    (search: string) => {
      void navigate({ search: search === '' ? {} : { q: search }, replace: true });
    },
    [navigate],
  );
  if (screen === undefined) return <SettingsMissing backTo="home" />;
  return (
    <MembersScreen
      data={data}
      toasts={toasts}
      slug={slug}
      workspaceName={workspaceName}
      page={screen.page}
      search={q}
      onSearch={onSearch}
      invitations={screen.invitations}
      access={screen.access}
      roles={screen.roles}
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
