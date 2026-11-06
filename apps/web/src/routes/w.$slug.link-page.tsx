import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { LinkPageLoader } from '../features/link-page/LinkPageLoader.tsx';
import { LinkPagePending } from '../features/link-page/LinkPagePending.tsx';
import { TeamPagesScreen } from '../features/link-page/TeamPagesScreen.tsx';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings as linkPageStrings } from '../features/link-page/strings.ts';
import { strings } from '../features/settings/workspace-strings.ts';

/** The address's own words: `?edit` the builder, `?team` Team pages, `?member=` a member's page (spec 0070). */
interface LinkPageSearch {
  readonly edit?: true;
  readonly team?: true;
  readonly member?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isOn = (value: unknown) => value !== undefined && value !== false && value !== 'false';

// The member's own link page (spec 0051), a page of the workspace since 25 October 2026. It answered at
// `/w/$slug/settings/account/profile?view=link-page` until then: three levels inside configuration, behind a query
// parameter, for the surface a member opens most (the owner). That address still works and comes here. Team pages
// (spec 0070) and a member's page opened from them are views of it (`?team`, `?member=`), not routes of their own:
// a route's loader and chunk list sit in the first load, which has no room for two more.
export const Route = createFileRoute('/w/$slug/link-page')({
  // The page opens on what it is for, sharing itself; `?edit` is the builder (27 October 2026). It is in the
  // address so Back leaves the editor, and a link can open it straight into one.
  validateSearch: (search: Record<string, unknown>): LinkPageSearch => {
    const member = search['member'];
    return {
      ...(isOn(search['edit']) ? { edit: true as const } : {}),
      ...(isOn(search['team']) ? { team: true as const } : {}),
      ...(typeof member === 'string' && UUID.test(member) ? { member } : {}),
    };
  },
  loaderDeps: ({ search }) => ({ team: search.team === true, member: search.member }),
  loader: async ({ context, params, deps }) => {
    // Team pages read their own list when they open: nothing to read here.
    if (deps.team) return { profile: undefined, team: true };
    try {
      return {
        profile:
          deps.member === undefined
            ? await context.data.profile.get(params.slug)
            : await context.data.profile.getFor(params.slug, deps.member),
        team: false,
      };
    } catch (error) {
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) {
        return { profile: undefined, team: false };
      }
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <LinkPagePending />
    </LoadingNow>
  ),
  errorComponent: LinkPageError,
  component: LinkPageRoute,
});

function LinkPageRoute() {
  const { profile, team } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  const { edit, member } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (team) return <TeamPagesScreen data={data} slug={slug} />;
  if (profile === undefined) return <SettingsMissing backTo="home" />;
  return (
    <LinkPageLoader
      // Another person's page is another store: a fresh loader, never the last page's blocks for a moment.
      key={member ?? 'own'}
      data={data}
      slug={slug}
      profile={profile}
      {...(member === undefined ? {} : { member })}
      isEditing={edit === true}
      onEditing={(isEditing) =>
        void navigate({
          search: { ...(member === undefined ? {} : { member }), ...(isEditing ? { edit: true } : {}) },
        })
      }
    />
  );
}

function LinkPageError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={linkPageStrings.title}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
