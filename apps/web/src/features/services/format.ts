// How the catalogue words a service's lengths and prices (spec 0066 B1): "30 min", "1 h 15 min", "£25", "from £25",
// "Free", "On request", and a service's span over its options ("30 min – 1 h", "from £25"). Pure.
import type { CatalogueService, PriceTypeName, ServiceVariantView } from '@crm/data';
import { formatPrice } from '@crm/data/services';
import { strings } from './strings.ts';

/** The lengths a variant may take: every 5 minutes to 2 hours, then every 15 to 10 hours. */
export const LENGTH_CHOICES: readonly number[] = [
  ...Array.from({ length: 24 }, (_, index) => (index + 1) * 5),
  ...Array.from({ length: 32 }, (_, index) => 120 + (index + 1) * 15),
];

/** The buffers a service may take: none, then 5 to 120 minutes. */
export const BUFFER_CHOICES: readonly number[] = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120];

/** A length in words. */
export const lengthWords = (minutes: number) => (minutes === 0 ? strings.noTime : strings.minutes(minutes));

/** One variant's price in words. */
export function priceWords(
  variant: Pick<ServiceVariantView, 'priceMinor' | 'priceType'>,
  currency: string | undefined,
  locale: string,
): string {
  const type: PriceTypeName = variant.priceType;
  if (type === 'free') return strings.priceType.free;
  if (type === 'on_request') return strings.priceType.on_request;
  const amount =
    currency === undefined ? String(variant.priceMinor) : formatPrice(variant.priceMinor, currency, locale);
  return type === 'from' ? `from ${amount}` : amount;
}

/** A service's lengths over its options: one length, or the shortest to the longest. */
export function serviceLength(service: Pick<CatalogueService, 'variants'>): string {
  const lengths = service.variants.map((variant) => variant.minutes);
  if (lengths.length === 0) return '';
  const least = Math.min(...lengths);
  const most = Math.max(...lengths);
  return least === most ? lengthWords(least) : `${lengthWords(least)} – ${lengthWords(most)}`;
}

/** A service's price over its options: one price, or "from" the cheapest priced one. */
export function servicePrice(
  service: Pick<CatalogueService, 'variants'>,
  currency: string | undefined,
  locale: string,
): string {
  const [first] = service.variants;
  if (first === undefined) return '';
  if (service.variants.length === 1) return priceWords(first, currency, locale);
  const priced = service.variants.filter((variant) => variant.priceType === 'fixed' || variant.priceType === 'from');
  if (priced.length === 0) return priceWords(first, currency, locale);
  const least = priced.reduce((low, variant) => (variant.priceMinor < low.priceMinor ? variant : low));
  return priceWords({ priceMinor: least.priceMinor, priceType: 'from' }, currency, locale);
}
