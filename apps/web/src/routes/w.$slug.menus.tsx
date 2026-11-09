import { isDataError, type HospitalityStore, type MenuStoreRoot, type PlaceHours } from '@crm/data';
import { useMemo } from 'react';
import { EmptyState, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AppOffScreen } from '../features/hospitality/AppOffScreen.tsx';
import { useShownBusiness } from '../features/hospitality/shown-business.ts';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { MenusPending } from '../features/menus/MenusPending.tsx';
import { MenusScreen } from '../features/menus/MenusScreen.tsx';
import { menusSearch } from '../features/menus/search.ts';
import { strings } from '../features/menus/strings.ts';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

/** What the Menus screen opens on: the store with the draft read, and the business for the preview's header. */
interface MenusData {
  readonly isInstalled: boolean;
  readonly store?: MenuStoreRoot;
  readonly hospitality?: HospitalityStore;
  /** The business the loader read (spec 0065 H7): undefined is the first. */
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
      hospitality,
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
  const { isInstalled, store, hospitality, business, property } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (!isInstalled || store === undefined || hospitality === undefined) {
    return <AppOffScreen slug={slug} page="menus" />;
  }
  return <ShownMenus store={store} hospitality={hospitality} fromLoader={property} business={business} />;
}

/**
 * The chosen business's Menus (spec 0065 H7): a switch remounts the screen at once on that business's draft (loading
 * until it arrives), and the store it holds is bound to it, so a press never reaches another business.
 */
function ShownMenus({
  store,
  hospitality,
  fromLoader,
  business,
}: {
  readonly store: MenuStoreRoot;
  readonly hospitality: HospitalityStore;
  readonly fromLoader: string | undefined;
  readonly business: MenusData['business'];
}) {
  const { slug } = Route.useParams();
  const view = Route.useSearch();
  const { toasts } = Route.useRouteContext();
  const property = useShownBusiness(hospitality, slug, fromLoader);
  const bound = useMemo(() => store.at(property), [store, property]);
  // The preview's header is the loader's business until its answer for the new one lands.
  const shown = property === fromLoader ? business : { name: '', hours: {} };
  return <MenusScreen key={property ?? ''} store={bound} slug={slug} toasts={toasts} business={shown} view={view} />;
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
