// The workspace's businesses and the one chosen on this device (spec 0065 H7, AC-6517), for the places that offer a
// switch outside the hospitality pages: the sidebar's switcher and ⌘K. The Hospitality store loads on first use.
import type { DataLayer, HospitalityHeld, HospitalityStore, PropertySummary } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { useEffect, useState } from 'react';

const LOADING = { status: 'loading' } as const;

/** Nothing held yet (the store still loading): loading, which offers no switch. */
const NOT_HELD: HospitalityHeld<never> = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  retain: () => () => undefined,
  retry: () => undefined,
};

/** The businesses as a switch offers them: from two up only, with the one in use. */
export interface HeldBusinesses {
  readonly store: HospitalityStore;
  readonly properties: readonly PropertySummary[];
  /** The business in use: the device's choice, else the first. */
  readonly current: string | undefined;
  /** The choice as the store holds it: undefined is the first, and while the list loads. */
  readonly chosen: string | undefined;
}

/**
 * The businesses a switch offers, or undefined while they load, when the reader can't read them (no business app),
 * and while there is only one: a workspace with one business never sees a switch (AC-6516).
 */
export function useHeldBusinesses(data: DataLayer, slug: string): HeldBusinesses | undefined {
  const [store, setStore] = useState<HospitalityStore | undefined>(undefined);
  useEffect(() => {
    let isLive = true;
    data.hospitality.load().then(
      (loaded) => {
        if (isLive) setStore(loaded);
      },
      // The store's code failed to load: no switch, as with one business.
      () => undefined,
    );
    return () => {
      isLive = false;
    };
  }, [data]);
  const listed = useHospitality(store === undefined ? NOT_HELD : store.properties(slug));
  const choice = useHospitality<string | undefined>(store === undefined ? NOT_HELD : store.choice(slug));
  if (store === undefined || listed.status !== 'ready' || listed.value.properties.length < 2) return undefined;
  const { properties } = listed.value;
  const chosen = choice.status === 'ready' ? choice.value : undefined;
  return { store, properties, current: chosen ?? properties[0]?.id, chosen };
}
