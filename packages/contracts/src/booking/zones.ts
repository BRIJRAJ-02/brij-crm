// A time zone as a person says it (QA Q78): "Kolkata time (GMT+5:30)", never the raw id "Asia/Calcutta". Plain
// TypeScript on Intl alone, so the public booking page (which loads no date library) and the server's emails say a
// zone the same way. `@crm/contracts/zones`.

/** Zones some browsers still name by their old spelling (Chrome's Asia/Calcutta), by their current name. */
const RENAMED: Readonly<Record<string, string>> = Object.freeze({
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
});

/** A zone by its current name, for an old spelling some browsers still answer ("Asia/Calcutta" is "Asia/Kolkata"). */
export const currentZone = (zone: string): string => RENAMED[zone] ?? zone;

/** Whether a zone names a place: "Asia/Dubai" does, "UTC" and "Etc/GMT+4" don't. */
const hasCity = (zone: string): boolean => zone.includes('/') && !zone.startsWith('Etc/');

/**
 * The zone's offset as GMT says it at an instant: "GMT+4", "GMT+5:30", "GMT"; empty for a zone Intl doesn't know.
 * No offset is always "GMT": some engines' Intl says "GMT+0", so the pages and the emails could otherwise differ.
 */
export function offsetLabel(zone: string, at: number): string {
  try {
    const label =
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date(at))
        .find((part) => part.type === 'timeZoneName')?.value ?? '';
    return label === 'GMT+0' || label === 'GMT-0' || label === 'UTC' ? 'GMT' : label;
  } catch {
    return '';
  }
}

/** "Asia/Dubai" as a person names it, without its offset: "Dubai time"; a zone with no city keeps its name ("UTC"). */
export function zoneName(zone: string): string {
  if (!hasCity(zone)) return zone.replaceAll('_', ' ');
  const city = currentZone(zone).split('/').pop()?.replaceAll('_', ' ') ?? zone;
  return `${city} time`;
}

/** "Asia/Dubai" as a person says it at an instant: "Dubai time (GMT+4)"; a zone with no city keeps its name. */
export function zoneDisplay(zone: string, at: number): string {
  const name = zoneName(zone);
  if (!hasCity(zone)) return name;
  const offset = offsetLabel(zone, at);
  return offset === '' ? name : `${name} (${offset})`;
}
