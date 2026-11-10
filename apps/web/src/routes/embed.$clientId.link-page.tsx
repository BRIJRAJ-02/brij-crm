import { isDataError, type EmbedSessionView, type MyProfile } from '@crm/data';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { EmbedFrame } from '../features/embed/EmbedFrame.tsx';
import { EmbedStatus } from '../features/embed/EmbedStatus.tsx';
import { embedEndedHref } from '../features/embed/paths.ts';
import { LinkPageLoader } from '../features/link-page/LinkPageLoader.tsx';
import { EmbeddedLinkPages } from '../features/link-page/place.tsx';
import { MemberPageUnavailable, TeamPagesScreen } from '../features/link-page/TeamPagesScreen.tsx';
import { EmbeddedLayout } from '../features/workspace/WorkspacePage.tsx';

/** The address's own words, as the app's link page has them, and the partner's look (spec 0070, AC-7032). */
interface EmbedLinkPageSearch {
  readonly edit?: true;
  readonly team?: true;
  readonly member?: string;
  readonly theme?: 'light' | 'dark';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isOn = (value: unknown) => value === true || value === 'true';

// The link page screens inside a partner's frame (spec 0070, AC-7032, AC-7033): the person's own page, Team pages
// and a member's page, the app's own screens without the sidebar or the workspace menu, every link kept inside the
// frame. The frame's session names the workspace; an address for another partner's frame, or a session that is
// gone, goes to the frame's own page, which asks the partner for a fresh launch.
export const Route = createFileRoute('/embed/$clientId/link-page')({
  validateSearch: (search: Record<string, unknown>): EmbedLinkPageSearch => {
    const member = search['member'];
    const theme = search['theme'];
    return {
      ...(isOn(search['edit']) ? { edit: true as const } : {}),
      ...(isOn(search['team']) ? { team: true as const } : {}),
      ...(typeof member === 'string' && UUID.test(member) ? { member } : {}),
      ...(theme === 'light' || theme === 'dark' ? { theme } : {}),
    };
  },
  loaderDeps: ({ search }) => ({ team: search.team === true, member: search.member }),
  loader: async ({
    context,
    params,
    deps,
  }): Promise<{
    readonly session: EmbedSessionView;
    readonly profile: MyProfile | undefined;
  }> => {
    const ended = () => redirect({ href: embedEndedHref(params.clientId), replace: true });
    let session;
    try {
      session = await context.data.embed.session();
    } catch (error) {
      if (isDataError(error) && (error.code === 'UNAUTHENTICATED' || error.code === 'NOT_FOUND')) throw ended();
      throw error;
    }
    if (session.partner.clientId !== params.clientId) throw ended();
    // Team pages read their own list when they open; someone who can't manage them gets their own page instead.
    if (deps.team && session.canManageTeam) return { session, profile: undefined };
    try {
      const profile =
        deps.member === undefined
          ? await context.data.profile.get(session.workspace)
          : await context.data.profile.getFor(session.workspace, deps.member);
      return { session, profile };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
        return { session, profile: undefined };
      }
      throw error;
    }
  },
  pendingComponent: () => <EmbedStatus state="opening" origins={[]} />,
  errorComponent: EmbedLinkPageError,
  component: EmbedLinkPageRoute,
});

function EmbedLinkPageRoute() {
  const { session, profile } = Route.useLoaderData();
  const { clientId } = Route.useParams();
  const { data } = Route.useRouteContext();
  const { edit, member, team, theme } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const slug = session.workspace;
  const isTeam = team === true && session.canManageTeam;
  // Their own page couldn't be read: the frame's own page, with its own frame.
  if (!isTeam && profile === undefined && member === undefined) {
    return (
      <EmbedFrame origins={session.frameOrigins} theme={theme}>
        <EmbedStatus state="failed" origins={session.frameOrigins} onRetry={() => void router.invalidate()} />
      </EmbedFrame>
    );
  }
  const screen = (() => {
    // Team pages only for someone who may manage them; anyone else sees their own page.
    if (isTeam) return <TeamPagesScreen data={data} slug={slug} />;
    if (profile === undefined) return <MemberPageUnavailable slug={slug} />;
    return (
      <LinkPageLoader
        key={member ?? 'own'}
        data={data}
        slug={slug}
        profile={profile}
        {...(member === undefined ? {} : { member })}
        isEditing={edit === true}
        onEditing={(isEditing) =>
          void navigate({
            search: {
              ...(member === undefined ? {} : { member }),
              ...(isEditing ? { edit: true } : {}),
              ...(theme === undefined ? {} : { theme }),
            },
          })
        }
      />
    );
  })();
  return (
    <EmbedFrame origins={session.frameOrigins} theme={theme}>
      <EmbeddedLinkPages
        place={{
          // Every screen's address in this frame (`embedLinkPageBase`, written out: a shared import is a first load file).
          base: `/embed/${clientId}/link-page`,
          ...(theme === undefined ? {} : { theme }),
          canManageTeam: session.canManageTeam,
          workspaceName: session.workspaceName,
          appName: session.partner.name,
        }}
      >
        <EmbeddedLayout>{screen}</EmbeddedLayout>
      </EmbeddedLinkPages>
    </EmbedFrame>
  );
}

function EmbedLinkPageError(_props: ErrorComponentProps) {
  const router = useRouter();
  return <EmbedStatus state="failed" origins={[]} onRetry={() => void router.invalidate()} />;
}
