import { isDataError, type HospitalityStore, type MenuStoreRoot } from '@crm/data';
import { useMemo } from 'react';
import { EmptyState, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AppOffScreen } from '../features/hospitality/AppOffScreen.tsx';
import { useShownBusiness } from '../features/hospitality/shown-business.ts';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { DesignScreen } from '../features/menus/DesignScreen.tsx';
import { strings } from '../features/menus/strings.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

/** What the Design page opens on. */
interface DesignData {
  readonly isInstalled: boolean;
  readonly store?: MenuStoreRoot;
  /** For the switch guard: unsaved look changes ask before another business shows (spec 0065 H7). */
  readonly hospitality?: HospitalityStore;
  /** The business shown: undefined is the first. A switch reads the page again. */
  readonly property?: string | undefined;
  readonly businessName: string;
  readonly hasBusiness?: boolean;
}

// The Design page (spec 0065, AC-6570 as amended): shown only while Menu is installed, else not found. The loader reads
// the draft, which holds the look, and the business's name for the phone's header, for those who may read it.
export const Route = createFileRoute('/w/$slug/menus_/design')({
  loader: async ({ context, params }): Promise<DesignData> => {
    const isInstalled = await isPageInstalled(context.data, params.slug, 'menus');
    if (!isInstalled) return { isInstalled, businessName: '' };
    const [store, hospitality] = await Promise.all([context.data.menu.load(), context.data.hospitality.load()]);
    // The businesses come first, so the draft read is of the one the switcher chose (spec 0065 H7).
    await hospitality.readProperties(params.slug).catch(() => undefined);
    await store.readDraft(params.slug);
    const view = await hospitality.readBusiness(params.slug).catch(() => undefined);
    return {
      isInstalled,
      store,
      hospitality,
      property: store.property(params.slug),
      businessName: view?.profile?.name ?? '',
      // A reader who can't read the business answers nothing here, and can't save anyway.
      ...(view === undefined ? {} : { hasBusiness: view.profile !== undefined }),
    };
  },
  pendingComponent: () => <WorkspacePage currentPage="menus" page={pendingPage()} />,
  errorComponent: DesignError,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled, store, hospitality, property, businessName, hasBusiness } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (!isInstalled || store === undefined || hospitality === undefined) {
    return <AppOffScreen slug={slug} page="menus" />;
  }
  return (
    <ShownDesign
      store={store}
      hospitality={hospitality}
      fromLoader={property}
      businessName={businessName}
      {...(hasBusiness === undefined ? {} : { hasBusiness })}
    />
  );
}

/**
 * The chosen business's Design page (spec 0065 H7): a switch remounts it at once on that business's look, and the store
 * it holds is bound to it, so a save or a cover upload never reaches another business.
 */
function ShownDesign({
  store,
  hospitality,
  fromLoader,
  businessName,
  hasBusiness,
}: {
  readonly store: MenuStoreRoot;
  readonly hospitality: HospitalityStore;
  readonly fromLoader: string | undefined;
  readonly businessName: string;
  readonly hasBusiness?: boolean;
}) {
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  const property = useShownBusiness(hospitality, slug, fromLoader);
  const bound = useMemo(() => store.at(property), [store, property]);
  return (
    <DesignScreen
      key={property ?? ''}
      store={bound}
      hospitality={hospitality}
      slug={slug}
      toasts={toasts}
      businessName={property === fromLoader ? businessName : ''}
      {...(hasBusiness === undefined ? {} : { hasBusiness })}
    />
  );
}

function DesignError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <WorkspacePage
      currentPage="menus"
      page={{
        topBar: <TopBar title={strings.designTitle} />,
        body: (
          <EmptyState tone="error" title={strings.failed} onRetry={() => void router.invalidate()}>
            {isDataError(error) ? error.message : strings.failed}
          </EmptyState>
        ),
      }}
    />
  );
}
