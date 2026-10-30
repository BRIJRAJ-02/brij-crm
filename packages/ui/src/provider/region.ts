// The country and currency a value starts in. Its own module, apart from
// context.ts, so the region table reaches only the editors that read it: every
// page loads context.ts, the hosted form and the booking page among them.
import { regionDefaults } from '../lib/region-defaults.ts';
import { useFormatSettings } from './context.ts';

/**
 * The country and currency a value starts in when its attribute names none:
 * the workspace's (FormatScope), else the language's region's (en-IN is IN
 * and INR), else the US's. A new Currency attribute and a new phone number
 * start here instead of always in USD and the US.
 */
export function useRegionDefaults(): { readonly country: string; readonly currency: string } {
  const { locale, country, currency } = useFormatSettings();
  return regionDefaults(locale, { country, currency });
}
