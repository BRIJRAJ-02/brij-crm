import { isDataError, type MenuStore, type PlaceHours } from '@crm/data';
import { EmptyState, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AppOffScreen } from '../features/hospitality/AppOffScreen.tsx';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { MenusPending } from '../features/menus/MenusPending.tsx';
import { MenusScreen } from '../features/menus/MenusScreen.tsx';
import { menusSearch } from '../features/menus/search.ts';
import { strings } from '../features/menus/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

/** What the Menus screen opens on: the store with the draft read, and the business for the preview's header. */
interface MenusData {
  readonly isInstalled: boolean;
  readonly store?: MenuStore;
  /** The business shown (spec 0065 H7): undefined is the first. A switch reads the page again. */
  readonly property?: string | undefined;
  readonly business: {
    readonly name: string;
    readonly phone?: string;
    readonly hours: Readonly<Record<string, PlaceHours>>;
  };
}

// Menus, the Menu app's editor (spec 0065, H1): shown only while Menu is on and the reader's role reaches it. The loader reads
// the draft (and, for those who set the apps up, the business: its name, its phone for Settings, and each place's
// hours for the preview).
export const Route = createFileRoute('/w/$slug/menus')({
  validateSearch: menusSearch,
  loader: async ({ context, params }): Promise<MenusData> => {
    const isInstalled = await isPageInstalled(context.data, params.slug, 'menus');
    const empty = { name: '', hours: {} };
    if (!isInstalled) return { isInstalled, business: empty };
    const [store, hospitality] = await Promise.all([context.data.menu.load(), context.data.hospitality.load()]);
    // The businesses come first, so the draft read is of the one the switcher chose (spec 0065 H7).
    await hospitality.readProperties(params.slug).catch(() => undefined);
    try {
      await store.readDraft(params.slug);
    } catch (error) {
      // Someone whose role doesn't reach the page meets it as one that isn't there, never a locked one.
      if (isDataError(error) && error.code === 'FORBIDDEN') return { isInstalled: false, business: empty };
      throw error;
    }
    const view = await hospitality.readBusiness(params.slug).catch(() => undefined);
    return {
      isInstalled,
      store,
      property: store.property(params.slug),
      business: {
        name: view?.profile?.name ?? '',
        ...(view?.profile?.phone === undefined ? {} : { phone: view.profile.phone }),
        hours: Object.fromEntries((view?.places ?? []).map((place) => [place.id, place.hours])),
      },
    };
  },
  pendingComponent: MenusPending,
  errorComponent: MenusError,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled, store, business, property } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const view = Route.useSearch();
  const { toasts } = Route.useRouteContext();
  if (!isInstalled || store === undefined) return <AppOffScreen slug={slug} page="menus" />;
  // A business of its own starts the screen afresh: no open drawer or chosen place carries over (spec 0065 H7).
  return <MenusScreen key={property ?? ''} store={store} slug={slug} toasts={toasts} business={business} view={view} />;
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
