// The business a hospitality page shows (spec 0065 H7, AC-6517): the switcher's choice the moment it changes, so the
// page remounts at once into the chosen business's loading state rather than showing the old one while the loader
// runs again. Undefined is the first business (which no call names).
import type { HospitalityStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

/**
 * The business to show: the device's choice once the businesses are read, else what the loader saw. A page keys its
 * screen by it and binds its store to it (`store.at(business)`), so every press lands on the business on screen. When
 * it moves away from what the loader read, the page's loader runs again for what it shows beside the business's own
 * copy (its name, its places' hours), whichever switch moved it: the sidebar, ⌘K, Settings › Business or a link.
 */
export function useShownBusiness(
  hospitality: HospitalityStore,
  slug: string,
  fromLoader: string | undefined,
): string | undefined {
  const choice = useHospitality(hospitality.choice(slug));
  const shown = choice.status === 'ready' ? choice.value : fromLoader;
  const router = useRouter();
  useEffect(() => {
    if (shown !== fromLoader) void router.invalidate();
  }, [shown, fromLoader, router]);
  return shown;
}
