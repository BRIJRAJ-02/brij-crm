// What Menu QR's codes wear (spec 0065, H2), read for the routes' loaders: the brand kit's accent on the modules and
// its logo in the middle, from the data layer's brand store. No React, so a loader can import it. A kit that won't
// read leaves the plain black code: the codes never wait on the brand.
import type { DataLayer } from '@crm/data';

/** What the codes wear: the brand's accent on the modules and its logo in the middle, when the workspace has them. */
export interface QrLook {
  readonly colour?: string;
  readonly logoSrc?: string;
}

/** The look the workspace's codes wear, or the plain code. */
export async function qrLookOf(data: DataLayer, slug: string): Promise<QrLook> {
  try {
    const brand = await data.brand.load();
    const kit = await brand.readKit(slug);
    const logoSrc = kit.logo === undefined ? undefined : brand.logoSrc(slug, kit.logo.version);
    return {
      ...(kit.accent === undefined ? {} : { colour: kit.accent }),
      ...(logoSrc === undefined ? {} : { logoSrc }),
    };
  } catch {
    return {};
  }
}

/** At most this many tables a print address names (a place's own limit); past it the sheet prints them all. */
const PRINT_TABLES_MAX = 300;

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * The print sheet's address for a place: every table, or only `tables` (the picked ones, else the zone shown), in
 * the place's order (checklabs prints the selection, else the filter).
 */
export const qrPrintHref = (slug: string, placeId: string, tables?: readonly string[]): string =>
  `/w/${slug}/qr/print?${new URLSearchParams({
    place: placeId,
    ...(tables === undefined || tables.length === 0 || tables.length > PRINT_TABLES_MAX
      ? {}
      : { tables: tables.join(',') }),
  }).toString()}`;

/** The QR codes page's address. */
export const qrPageHref = (slug: string): string => `/w/${slug}/qr`;

/** The print sheet's search as the route reads it (`?place=<id>&tables=<id>,<id>`): anything else is dropped. */
export function qrPrintSearch(search: Record<string, unknown>): {
  readonly place?: string;
  readonly tables?: string;
} {
  const tables =
    typeof search.tables === 'string' &&
    search.tables.split(',').length <= PRINT_TABLES_MAX &&
    search.tables.split(',').every((id) => UUID.test(id))
      ? search.tables
      : undefined;
  return {
    ...(typeof search.place === 'string' && UUID.test(search.place) ? { place: search.place } : {}),
    ...(tables === undefined ? {} : { tables }),
  };
}

/** The table ids a print address names, or undefined for every table. */
export const printedTables = (tables: string | undefined): ReadonlySet<string> | undefined =>
  tables === undefined ? undefined : new Set(tables.toLowerCase().split(','));
