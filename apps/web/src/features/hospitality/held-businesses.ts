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
export function useHeldBusinesses(
  data: DataLayer,
  slug: string,
  /** False holds nothing and loads nothing: a workspace with no business app (⌘K's guess, from the sidebar). */
  isWanted = true,
): HeldBusinesses | undefined {
  const [store, setStore] = useState<HospitalityStore | undefined>(undefined);
  useEffect(() => {
    if (!isWanted) return undefined;
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
  }, [data, isWanted]);
  const listed = useHospitality(store === undefined ? NOT_HELD : store.properties(slug));
  const choice = useHospitality<string | undefined>(store === undefined ? NOT_HELD : store.choice(slug));
  if (store === undefined || listed.status !== 'ready' || listed.value.properties.length < 2) return undefined;
  const { properties } = listed.value;
  const chosen = choice.status === 'ready' ? choice.value : undefined;
  return { store, properties, current: chosen ?? properties[0]?.id, chosen };
}

/** The other businesses a screen can copy to, and the shown one's currency (AC-6591); none while there is one. */
export interface OtherBusinesses {
  readonly others: readonly PropertySummary[];
  readonly currency: string | undefined;
}

/**
 * The businesses other than `shown` (undefined is the first), for Duplicate to another business (spec 0065 H7,
 * AC-6591): empty without the suite's store, while the list loads, and with one business.
 */
export function useOtherBusinesses(
  store: HospitalityStore | undefined,
  slug: string,
  shown: string | undefined,
): OtherBusinesses {
  const listed = useHospitality(store === undefined ? NOT_HELD : store.properties(slug));
  if (listed.status !== 'ready' || listed.value.properties.length < 2) return { others: [], currency: undefined };
  const { properties } = listed.value;
  const here = properties.find((each) => each.id === shown) ?? properties[0];
  return { others: properties.filter((each) => each.id !== here?.id), currency: here?.currency };
}
