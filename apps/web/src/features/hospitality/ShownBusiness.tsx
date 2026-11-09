// Brief
// Purpose: say which business a settings page shows (spec 0065 H7, AC-6517), where the sidebar's switcher isn't drawn.
// Main task: read the business's name beside the title.
// Leaves out: switching here (the sidebar, ⌘K and Settings › Business switch), and anything while there is only one.
import type { HospitalityStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { strings } from './strings.ts';

/** Props for ShownBusiness. */
export interface ShownBusinessProps {
  readonly hospitality: HospitalityStore;
  readonly slug: string;
}

/** "For Harbour Café" beside the title, from two businesses up; nothing with one. */
export function ShownBusiness({ hospitality, slug }: ShownBusinessProps) {
  const listed = useHospitality(hospitality.properties(slug));
  const choice = useHospitality(hospitality.choice(slug));
  if (listed.status !== 'ready' || listed.value.properties.length < 2) return null;
  const chosen = choice.status === 'ready' ? choice.value : undefined;
  const business = listed.value.properties.find((each) => each.id === chosen) ?? listed.value.properties[0];
  if (business?.name === undefined) return null;
  return strings.forBusiness(business.name);
}
