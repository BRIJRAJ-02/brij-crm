import { MenuPage } from './MenuPage.tsx';
import { oliveMenus } from '../BookingsFlow/menu-seed.ts';

/** Olive Kitchen's menu as a guest at Table 3 sees it: switch menus, search, filter, open a dish, add to the selection. */
export function MenuPageDemo() {
  const { menus, dishes, addOns } = oliveMenus();
  return <div className="tf-demo tf-demo--canvas"><MenuPage venue="Olive Kitchen" line="7 Apollo Bunder, Colaba" menus={menus} dishes={dishes} addOns={addOns} table="3" now={20 * 60} onBookTable={() => undefined} /></div>;
}
