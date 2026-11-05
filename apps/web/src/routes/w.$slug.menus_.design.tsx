import { isDataError, type MenuStore } from '@crm/data';
import { EmptyState, TopBar } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ComingScreen } from '../features/hospitality/ComingScreen.tsx';
import { isPageInstalled } from '../features/hospitality/pages.ts';
import { DesignScreen } from '../features/menus/DesignScreen.tsx';
import { strings } from '../features/menus/strings.ts';
import { pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

/** What the Design page opens on. */
interface DesignData {
  readonly isInstalled: boolean;
  readonly store?: MenuStore;
  readonly businessName: string;
}

// The Design page (spec 0065, AC-6570 as amended): shown only while Menu is installed, else not found. The loader reads
// the draft, which holds the look, and the business's name for the phone's header, for those who may read it.
export const Route = createFileRoute('/w/$slug/menus_/design')({
  loader: async ({ context, params }): Promise<DesignData> => {
    const isInstalled = await isPageInstalled(context.data, params.slug, 'menus');
    if (!isInstalled) return { isInstalled, businessName: '' };
    const [store, hospitality] = await Promise.all([context.data.menu.load(), context.data.hospitality.load()]);
    await store.readDraft(params.slug);
    const view = await hospitality.readBusiness(params.slug).catch(() => undefined);
    return { isInstalled, store, businessName: view?.profile?.name ?? '' };
  },
  pendingComponent: () => <WorkspacePage currentPage="menus" page={pendingPage()} />,
  errorComponent: DesignError,
  component: PageRoute,
});

function PageRoute() {
  const { isInstalled, store, businessName } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  if (!isInstalled || store === undefined) return <ComingScreen slug={slug} page="menus" isInstalled={false} />;
  return <DesignScreen store={store} slug={slug} toasts={toasts} businessName={businessName} />;
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
