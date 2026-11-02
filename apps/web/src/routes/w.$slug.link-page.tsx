import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { LinkPageLoader } from '../features/link-page/LinkPageLoader.tsx';
import { LinkPagePending } from '../features/link-page/LinkPagePending.tsx';
import { SettingsFailed, SettingsMissing } from '../features/settings/SettingsPage.tsx';
import { strings as linkPageStrings } from '../features/link-page/strings.ts';
import { strings } from '../features/settings/workspace-strings.ts';

// The member's own link page (spec 0051), a page of the workspace since 25 October 2026. It answered at
// `/w/$slug/settings/account/profile?view=link-page` until then: three levels inside configuration, behind a query
// parameter, for the surface a member opens most (the owner). That address still works and comes here.
export const Route = createFileRoute('/w/$slug/link-page')({
  // The page opens on what it is for, sharing itself; `?edit` is the builder (27 October 2026). It is in the
  // address so Back leaves the editor, and a link can open it straight into one.
  // `?page` names which of the person's link pages (spec 0064, AC-6414), so the switcher's pick is an address Back
  // returns from and a link can open; left out, their main page.
  validateSearch: (search: Record<string, unknown>): { readonly edit?: true; readonly page?: string } => ({
    ...(search['edit'] === undefined || search['edit'] === false || search['edit'] === 'false' ? {} : { edit: true }),
    ...(typeof search['page'] === 'string' && PAGE_ID.test(search['page']) ? { page: search['page'] } : {}),
  }),
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: async ({ context, params, deps }) => {
    const { data } = context;
    const read = async (page: string | undefined) => {
      data.linkPage.pick(params.slug, page);
      const [profile, pages] = await Promise.all([
        data.profile.get(params.slug, page),
        // The switcher's tiles; none before the first handle is claimed, and a failed read is no switcher.
        data.linkPage.pages.list(params.slug).catch(() => []),
      ]);
      return { profile, pages };
    };
    try {
      return await read(deps.page);
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') {
        // A page deleted in another tab, or never theirs: their main page instead.
        if (deps.page !== undefined) return read(undefined).catch(() => ({ profile: undefined, pages: [] }));
        return { profile: undefined, pages: [] };
      }
      throw error;
    }
  },
  // Every other screen's link page calls (Home's card, Settings) are for the main page again.
  onLeave: ({ context, params }) => {
    context.data.linkPage.pick(params.slug, undefined);
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
  const { profile, pages } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { data } = Route.useRouteContext();
  const { edit, page } = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  if (profile === undefined) return <SettingsMissing backTo="home" />;
  const at = (search: { readonly edit?: true; readonly page?: string }) => void navigate({ search });
  return (
    <LinkPageLoader
      data={data}
      slug={slug}
      profile={profile}
      pages={pages}
      isEditing={edit === true}
      onEditing={(isEditing) => at({ ...(page === undefined ? {} : { page }), ...(isEditing ? { edit: true } : {}) })}
      onPick={(picked) => at({ page: picked })}
      onPagesChanged={(open) => {
        // A page made, deleted or made main: the list and the profile are read again, on the page to open.
        if (open === undefined || open === page) void router.invalidate();
        else at({ page: open });
      }}
    />
  );
}

/** A link page id in the address: a UUID, else the main page. */
const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
