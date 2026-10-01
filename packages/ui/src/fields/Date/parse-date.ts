import { DateValue } from '@crm/contracts/values';

/** Reads a typed day: ISO (`2026-10-08`), or the language's numeric order (`08.10.2026` in German, `10/8/2026` in US English). */
export function parseLocaleDate(text: string, locale: string): string | undefined {
  const trimmed = text.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return DateValue.safeParse(trimmed).success ? trimmed : undefined;
  const parts = trimmed.split(/\D+/).filter((part) => part !== '');
  if (parts.length !== 3) return undefined;
  const order = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' })
    .formatToParts(Date.UTC(2026, 9, 8))
    .map((part) => part.type)
    .filter((type) => type === 'day' || type === 'month' || type === 'year');
  const value = Object.fromEntries(order.map((type, index) => [type, Number(parts[index])]));
  const year = (value.year ?? 0) < 100 ? 2000 + (value.year ?? 0) : (value.year ?? 0);
  const iso = `${String(year).padStart(4, '0')}-${String(value.month ?? 0).padStart(2, '0')}-${String(value.day ?? 0).padStart(2, '0')}`;
  return DateValue.safeParse(iso).success ? iso : undefined;
}
