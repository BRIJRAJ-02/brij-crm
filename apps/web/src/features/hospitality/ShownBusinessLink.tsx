// Brief
// Purpose: say which business a settings page shows (spec 0065 H7, AC-6517), where the sidebar's switcher isn't drawn.
// Main task: read the business's name beside the title, and reach Settings › Business to switch.
// Leaves out: switching here (Settings › Business lists every business), and anything while there is only one.
import type { HospitalityStore } from '@crm/data';
import { useHospitality } from '@crm/data/react';
import { Link } from '@crm/ui';
import { businessSettingsHref } from '../settings/nav.ts';
import { strings } from './strings.ts';

/** Props for ShownBusinessLink. */
export interface ShownBusinessLinkProps {
  readonly hospitality: HospitalityStore;
  readonly slug: string;
}

/** "For Harbour Café", linking to Settings › Business, from two businesses up; nothing with one. */
export function ShownBusinessLink({ hospitality, slug }: ShownBusinessLinkProps) {
  const listed = useHospitality(hospitality.properties(slug));
  const choice = useHospitality(hospitality.choice(slug));
  if (listed.status !== 'ready' || listed.value.properties.length < 2) return null;
  const chosen = choice.status === 'ready' ? choice.value : undefined;
  const business = listed.value.properties.find((each) => each.id === chosen) ?? listed.value.properties[0];
  if (business?.name === undefined) return null;
  return <Link href={businessSettingsHref(slug)}>{strings.forBusiness(business.name)}</Link>;
}
