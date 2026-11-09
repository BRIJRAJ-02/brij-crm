// The business a hospitality page shows (spec 0065 H7, AC-6517): the switcher's choice the moment it changes, so the
// page remounts at once into the chosen business's loading state rather than showing the old one while the loader
// runs again. Undefined is the first business (which no call names).
import type { HospitalityStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';

/**
 * The business to show: the device's choice once the businesses are read, else what the loader saw. A page keys its
 * screen by it and binds its store to it (`store.at(business)`), so every press lands on the business on screen.
 */
export function useShownBusiness(
  hospitality: HospitalityStore,
  slug: string,
  fromLoader: string | undefined,
): string | undefined {
  const choice = useHospitality(hospitality.choice(slug));
  return choice.status === 'ready' ? choice.value : fromLoader;
}
