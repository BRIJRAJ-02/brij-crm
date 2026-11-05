import { isDataError, type MenuStore, type PlaceHours } from '@crm/data';
import { EmptyState, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { MenusScreen } from '../features/menus/MenusScreen.tsx';
import { menusSearch } from '../features/menus/search.ts';
import { strings } from '../features/menus/strings.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

/** What the Menus screen opens on: the store with the draft read, and the business for the preview's header. */
interface MenusData {
  readonly isInstalled: boolean;
  readonly store?: MenuStore;
  readonly business: {
    readonly name: string;
    readonly phone?: string;
    readonly hours: Readonly<Record<string, PlaceHours>>;
  };
}

// Menus, the Menu app's editor (spec 0065, H1): shown only while Menu is installed, else not found. The loader reads
// the draft (and, for those who set the apps up, the business: its name, its phone for Settings, and each place's
// hours for the preview).
export const Route = createFileRoute('/w/$slug/menus')({
  validateSearch: menusSearch,
  loader: async ({ context, params }): Promise<MenusData> => {
    const isInstalled = await isPageInstalled(context.data, params.slug, 'menus');
    const empty = { name: '', hours: {} };
    if (!isInstalled) return { isInstalled, business: empty };
    const [store, hospitality] = await Promise.all([context.data.menu.load(), context.data.hospitality.load()]);
    await store.readDraft(params.slug);
    const view = await hospitality.readBusiness(params.slug).catch(() => undefined);
    return {
      isInstalled,
      store,
      business: {
        name: view?.profile?.name ?? '',
        ...(view?.profile?.phone === undefined ? {} : { phone: view.profile.phone }),
        hours: Object.fromEntries((view?.places ?? []).map((place) => [place.id, place.hours])),
      },
    };
  },
  pendingComponent: () => <WorkspacePage currentPage="menus" page={pendingPage()} />,
  errorComponent: MenusError,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled, store, business } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const view = Route.useSearch();
  const { toasts } = Route.useRouteContext();
  if (!isInstalled || store === undefined) return <ComingScreen slug={slug} page="menus" isInstalled={false} />;
  return <MenusScreen store={store} slug={slug} toasts={toasts} business={business} view={view} />;
}

function MenusError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      currentPage="menus"
      page={{
        topBar: <TopBar title={strings.title} />,
        body: (
          <EmptyState tone="error" title={strings.failed} onRetry={() => void router.invalidate()}>
            {isDataError(error) ? error.message : strings.failed}
          </EmptyState>
        ),
      }}
    />
  );
}
