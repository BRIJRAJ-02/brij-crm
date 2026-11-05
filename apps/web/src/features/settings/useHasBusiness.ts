// Whether Settings › Business shows (spec 0065, 0066 B1): only while Appointments or Table seating is installed. Read
// from the Apps page's own copy in the data layer, so an install or a removal there moves the navigation at once.
import type { AppsView, DataLayer, HospitalityHeld, HospitalityStore, Permission } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { useEffect, useState } from 'react';

/** The permissions any Business entry needs: someone holding none of them never reads the apps. */
const BUSINESS_PERMISSIONS: readonly Permission[] = ['hospitality.manage', 'services.manage', 'services.calendar'];

const LOADING = { status: 'loading' } as const;

/** Nothing held yet (the store still loading, or nobody asked): loading, which reads as no Business group. */
const NOT_HELD: HospitalityHeld<AppsView> = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  retain: () => () => undefined,
  retry: () => undefined,
};

/** True once the workspace's apps are read and Appointments or Table seating is installed. */
export function useHasBusiness(data: DataLayer, slug: string, permissions: readonly Permission[] | undefined): boolean {
  const isAsked = BUSINESS_PERMISSIONS.some((permission) => permissions?.includes(permission) === true);
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
  return (
    state.status === 'ready' &&
    state.value.apps.some((each) => each.installed && (each.app === 'appointments' || each.app === 'table_seating'))
  );
}
