// Menu QR's zones (after checklabs' Tables page): a place's areas as the zones its tables sit in, the tables grouped
// by zone (A to Z, Unzoned last, each in reading order), and each zone's colour, picked from its name, so a zone
// wears the same colour on its chip wherever it shows (checklabs' zoneColor).
import type { Hue } from '@crm/ui';

/** The zone key of tables in no zone. */
export const UNZONED = 'none';

/** The chip that shows every zone. */
export const ALL_ZONES = 'all';

/** The colours a zone may wear: the data hues but grey, which stays for Unzoned. */
const ZONE_HUES: readonly Hue[] = ['green', 'sky', 'orange', 'purple', 'red', 'lime', 'blue', 'yellow'];

/** A zone's colour from its name (case and spaces aside): the same name, the same colour, on every page. */
export function zoneHue(name: string): Hue {
  const key = name.trim().toLowerCase();
  let hash = 0;
  for (const char of key) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0;
  return ZONE_HUES[Math.abs(hash) % ZONE_HUES.length] ?? 'gray';
}

/** Labels in reading order: T2 before T10 (checklabs' numeric aware sort). */
export const byLabel = (a: { readonly label: string }, b: { readonly label: string }): number =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });

/** One zone and its tables. */
export interface ZoneGroup<T> {
  /** The zone's key: its area id (or its name while the floor loads), or `UNZONED`. */
  readonly id: string;
  readonly name: string;
  /** Its colour; Unzoned has none. */
  readonly hue?: Hue;
  readonly tables: readonly T[];
}

/**
 * The tables grouped by zone, A to Z with Unzoned last, each zone's tables in reading order. `zoneOf` names a
 * table's zone key (undefined for none), `nameOf` a key's name (undefined when that zone is gone: Unzoned).
 */
export function zoneGroups<T extends { readonly label: string }>(
  tables: readonly T[],
  zoneOf: (table: T) => string | undefined,
  nameOf: (zone: string) => string | undefined,
  unzoned: string,
): readonly ZoneGroup<T>[] {
  const keyOf = (table: T) => {
    const zone = zoneOf(table);
    return zone === undefined || nameOf(zone) === undefined ? UNZONED : zone;
  };
  return [...new Set(tables.map(keyOf))]
    .map((id): ZoneGroup<T> => {
      const name = id === UNZONED ? unzoned : (nameOf(id) ?? unzoned);
      return {
        id,
        name,
        ...(id === UNZONED ? {} : { hue: zoneHue(name) }),
        tables: tables.filter((table) => keyOf(table) === id).sort(byLabel),
      };
    })
    .sort((a, b) =>
      a.id === UNZONED ? 1 : b.id === UNZONED ? -1 : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}
