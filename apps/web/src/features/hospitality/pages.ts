// The Hospitality apps' own pages (spec 0065, AC-6510), for their routes' loaders: which app each belongs to, and
// whether it is installed. No React, so a loader in the first load can import it.
import type { DataLayer, HospitalityApp } from '@crm/data';

/** One of the Hospitality pages. */
export type HospitalityPage = 'menus' | 'qr' | 'reservations' | 'service';

/** The app each page belongs to. */
const APP_OF: Readonly<Record<HospitalityPage, HospitalityApp>> = {
  menus: 'menu',
  qr: 'menu_qr',
  reservations: 'table_seating',
  service: 'table_seating',
};

/** Whether the page's app is installed in the workspace (the Apps page's read; false when it can't be read). */
export async function isPageInstalled(data: DataLayer, slug: string, page: HospitalityPage): Promise<boolean> {
  const store = await data.hospitality.load();
  const view = await store.readApps(slug).catch(() => undefined);
  return view?.apps.some((each) => each.app === APP_OF[page] && each.installed) === true;
}
