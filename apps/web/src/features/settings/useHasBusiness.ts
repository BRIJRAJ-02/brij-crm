// What the workspace's apps open in the navigation (spec 0065, 0066 B1): Settings › Business only while Appointments or
// Table seating is on. Read from the Apps page's own copy in the data layer, so a switch there moves the
// navigation at once.
import type { AppsView, DataLayer, HospitalityHeld, HospitalityStore, Permission } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { useEffect, useState } from 'react';

/** The permissions the Business entries need: someone holding none of them never reads the apps. */
const NAV_PERMISSIONS: readonly Permission[] = ['hospitality.manage', 'services.manage', 'services.calendar'];

const LOADING = { status: 'loading' } as const;

/** Nothing held yet (the store still loading, or nobody asked): loading, which reads as no Business group. */
const NOT_HELD: HospitalityHeld<AppsView> = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  retain: () => () => undefined,
  retry: () => undefined,
};

/** Whether Settings shows Business (`settingsNav`'s options); not until the workspace's apps are read. */
export function useAppsNav(
  data: DataLayer,
  slug: string,
  permissions: readonly Permission[] | undefined,
): { readonly hasBusiness: boolean } {
  const isAsked = NAV_PERMISSIONS.some((permission) => permissions?.includes(permission) === true);
  const [store, setStore] = useState<HospitalityStore | undefined>(undefined);
  useEffect(() => {
    if (!isAsked) return undefined;
    let isLive = true;
    data.hospitality.load().then(
      (loaded) => {
        if (isLive) setStore(loaded);
      },
      // The store's code failed to load: no Business group, as for a workspace with neither app.
      () => undefined,
    );
    return () => {
      isLive = false;
    };
  }, [data, isAsked]);
  const state = useHospitality(isAsked && store !== undefined ? store.apps(slug) : NOT_HELD);
  if (state.status !== 'ready') return { hasBusiness: false };
  return {
    hasBusiness: state.value.apps.some(
      (each) => each.installed && (each.app === 'appointments' || each.app === 'table_seating'),
    ),
  };
}
