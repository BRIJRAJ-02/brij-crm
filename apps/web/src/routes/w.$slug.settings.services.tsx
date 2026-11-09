import { isDataError, type HospitalityStore, type ServicesStoreRoot } from '@crm/data';
import { useMemo } from 'react';
import { useShownBusiness } from '../features/hospitality/shown-business.ts';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ServicesScreen } from '../features/services/ServicesScreen.tsx';
import { strings } from '../features/services/strings.ts';
import { SettingsFailed, SettingsPage } from '../features/settings/SettingsPage.tsx';

// Settings › Workspace › Services (spec 0066 B1, AC-6613): the catalogue, for `services.manage` while Appointments is
// installed. The store loads with the page; the screen draws its own refusal (no app, no permission).
export const Route = createFileRoute('/w/$slug/settings/services')({
  loader: async ({
    context,
    params,
  }): Promise<{
    readonly store: ServicesStoreRoot;
    readonly hospitality: HospitalityStore;
    readonly property?: string;
  }> => {
    // The businesses come first, so the catalogue held is the chosen one's (spec 0065 H7); a switch reads this again.
    const hospitality = await context.data.hospitality.load();
    await hospitality.readProperties(params.slug).catch(() => undefined);
    const store = await context.data.services.load();
    store.catalogue(params.slug).retain();
    const property = hospitality.current(params.slug);
    return { store, hospitality, ...(property === undefined ? {} : { property }) };
  },
  pendingComponent: () => (
    <LoadingNow>
      <SettingsPage title={strings.servicesTitle} isLoading>
        {null}
      </SettingsPage>
    </LoadingNow>
  ),
  errorComponent: ServicesError,
  component: ServicesRoute,
});

function ServicesRoute() {
  const { store, hospitality, property: fromLoader } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { toasts } = Route.useRouteContext();
  // The chosen business's catalogue (spec 0065 H7): a switch remounts the screen at once on its copy, and the store it
  // holds is bound to it, so a press never reaches another business.
  const property = useShownBusiness(hospitality, slug, fromLoader);
  const bound = useMemo(() => store.at(property), [store, property]);
  return <ServicesScreen key={property ?? ''} store={bound} hospitality={hospitality} slug={slug} toasts={toasts} />;
}

function ServicesError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <SettingsFailed
      title={strings.servicesTitle}
      heading={strings.failed}
      text={isDataError(error) ? error.message : strings.failed}
      onRetry={() => void router.invalidate()}
    />
  );
}
