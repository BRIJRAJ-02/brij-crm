import { isDataError, type BusinessPageStoreRoot, type HospitalityStore } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useMemo } from 'react';
import { BusinessPageScreen } from '../features/hospitality/BusinessPageScreen.tsx';
import { pageStrings } from '../features/hospitality/business-page-strings.ts';
import { useShownBusiness } from '../features/hospitality/shown-business.ts';
import { strings } from '../features/hospitality/strings.ts';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

/** What the page opens on: the store, the hospitality store for the switcher's choice, and the business it read. */
interface PageData {
  readonly store: BusinessPageStoreRoot;
  readonly hospitality: HospitalityStore;
  /** The business the loader saw chosen (spec 0065 H7): undefined is the first. */
  readonly property: string | undefined;
}

// Settings › Business › Page (spec 0066, B4 lite): the business's public page, for `hospitality.manage`. The store
// loads with the page; the screen says when no app is installed or the person may not manage it. Each business has its
// own page (spec 0065 H7, AC-6592): the page follows the switcher, and its store is bound to the business on screen.
export const Route = createFileRoute('/w/$slug/settings/business/page')({
  loader: async ({ context, params }): Promise<PageData> => {
    const [store, hospitality] = await Promise.all([context.data.businessPage.load(), context.data.hospitality.load()]);
    // The businesses come first, so the page read is of the one the switcher chose.
    await hospitality.readProperties(params.slug).catch(() => undefined);
    return { store, hospitality, property: hospitality.current(params.slug) };
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={pageStrings.title} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: BusinessPageError,
  component: BusinessPageRoute,
});

function BusinessPageRoute() {
  const { store, hospitality, property: fromLoader } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  const property = useShownBusiness(hospitality, slug, fromLoader);
  const bound = useMemo(() => store.at(property), [store, property]);
  // A business of its own starts the editor afresh: no typed text or open dialog carries over to another's page.
  return <BusinessPageScreen key={property ?? ''} store={bound} slug={slug} toasts={toasts} />;
}

function BusinessPageError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={pageStrings.title}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
